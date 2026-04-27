const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const QUEUE_COLLECTION = 'matchmakingQueue';
const GAMES_COLLECTION = 'games';
const DEFAULT_RATING = 1200;
const ELO_K_FACTOR = 32;

function assertAuth(request) {
    if (!request.auth || !request.auth.uid) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    return request.auth.uid;
}

function normalizeMode(mode) {
    return mode === 'ranked' ? 'ranked' : 'casual';
}

function buildPlayerName(entry) {
    return entry.displayName || entry.email || 'Player';
}

function buildGamePayload({ mode, selfEntry, opponentEntry }) {
    const selfJoined = selfEntry.joinedAtMs || 0;
    const opponentJoined = opponentEntry.joinedAtMs || 0;
    const selfIsP1 =
        selfJoined < opponentJoined ||
        (selfJoined === opponentJoined && selfEntry.uid < opponentEntry.uid);

    const p1 = selfIsP1 ? selfEntry : opponentEntry;
    const p2 = selfIsP1 ? opponentEntry : selfEntry;

    const isRanked = mode === 'ranked';
    const gridSize = isRanked ? 8 : selfEntry.gridSize || 6;
    const timerEnabled = isRanked ? true : !!selfEntry.timerEnabled;

    return {
        gameCode: null,
        mode,
        source: 'matchmaking',
        status: 'active',
        player1uid: p1.uid,
        player1name: buildPlayerName(p1),
        player2uid: p2.uid,
        player2name: buildPlayerName(p2),
        gridSize,
        timerEnabled,
        currentPlayer: 1,
        phase: 'place',
        lastPlaces: null,
        gameStateJSON: null,
        placementHistory: { p1: [], p2: [] },
        timeouts: { p1: 0, p2: 0 },
        result: null,
        createdAt: FieldValue.serverTimestamp()
    };
}

function computeEloDelta(r1, r2, scoreP1) {
    const expected1 = 1 / (1 + 10 ** ((r2 - r1) / 400));
    const expected2 = 1 - expected1;
    const delta1 = Math.round(ELO_K_FACTOR * (scoreP1 - expected1));
    const delta2 = -delta1;

    const newR1 = Math.max(100, r1 + delta1);
    const newR2 = Math.max(100, r2 + delta2);

    return { delta1, delta2, newR1, newR2 };
}

async function tryMatch(uid, mode) {
    const selfRef = db.collection(QUEUE_COLLECTION).doc(uid);
    const queueSnapshot = await db
        .collection(QUEUE_COLLECTION)
        .where('mode', '==', mode)
        .where('status', '==', 'searching')
        .orderBy('joinedAtMs', 'asc')
        .limit(30)
        .get();

    const candidates = queueSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((entry) => entry.uid !== uid);

    for (const candidate of candidates) {
        const candidateRef = db.collection(QUEUE_COLLECTION).doc(candidate.uid);
        const gameRef = db.collection(GAMES_COLLECTION).doc();

        try {
            const result = await db.runTransaction(async (tx) => {
                const [selfSnap, candidateSnap] = await Promise.all([
                    tx.get(selfRef),
                    tx.get(candidateRef)
                ]);

                if (!selfSnap.exists || !candidateSnap.exists) return null;

                const selfData = selfSnap.data();
                const candidateData = candidateSnap.data();

                if (selfData.status !== 'searching' || candidateData.status !== 'searching') {
                    return null;
                }
                if (selfData.mode !== mode || candidateData.mode !== mode) return null;

                const selfEntry = { uid, ...selfData };
                const opponentEntry = { uid: candidate.uid, ...candidateData };

                tx.set(gameRef, buildGamePayload({ mode, selfEntry, opponentEntry }));
                tx.update(selfRef, {
                    status: 'matched',
                    gameId: gameRef.id,
                    matchedWith: candidate.uid,
                    matchedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
                tx.update(candidateRef, {
                    status: 'matched',
                    gameId: gameRef.id,
                    matchedWith: uid,
                    matchedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });

                return gameRef.id;
            });

            if (result) return result;
        } catch (_) {
            // Ignore transaction races and continue with next candidate.
        }
    }

    return null;
}

exports.enqueueForMatch = onCall(async (request) => {
    const uid = assertAuth(request);
    const mode = normalizeMode(request.data?.mode);
    const isRanked = mode === 'ranked';

    const queueRef = db.collection(QUEUE_COLLECTION).doc(uid);
    await queueRef.set(
        {
            uid,
            mode,
            status: 'searching',
            displayName: request.auth.token?.name || '',
            email: request.auth.token?.email || '',
            gridSize: isRanked ? 8 : Number(request.data?.gridSize) || 6,
            timerEnabled: isRanked ? true : !!request.data?.timerEnabled,
            gameId: null,
            matchedWith: null,
            joinedAtMs: Date.now(),
            updatedAt: FieldValue.serverTimestamp(),
            joinedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
    );

    const gameId = await tryMatch(uid, mode);
    return { ok: true, gameId: gameId || null };
});

exports.runMatchmaker = onCall(async (request) => {
    const uid = assertAuth(request);
    const mode = normalizeMode(request.data?.mode);
    const gameId = await tryMatch(uid, mode);
    return { ok: true, gameId: gameId || null };
});

exports.cancelMatchmaking = onCall(async (request) => {
    const uid = assertAuth(request);
    const queueRef = db.collection(QUEUE_COLLECTION).doc(uid);
    await queueRef.set(
        {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
    );
    return { ok: true };
});

exports.finalizeRankedResult = onCall(async (request) => {
    const uid = assertAuth(request);
    const gameId = request.data?.gameId;
    if (!gameId || typeof gameId !== 'string') {
        throw new HttpsError('invalid-argument', 'gameId is required.');
    }

    const gameRef = db.collection(GAMES_COLLECTION).doc(gameId);

    const result = await db.runTransaction(async (tx) => {
        const gameSnap = await tx.get(gameRef);
        if (!gameSnap.exists) {
            throw new HttpsError('not-found', 'Game not found.');
        }

        const game = gameSnap.data();
        const isParticipant = game.player1uid === uid || game.player2uid === uid;
        if (!isParticipant) {
            throw new HttpsError('permission-denied', 'Only participants can finalize game result.');
        }
        if (game.mode !== 'ranked') {
            throw new HttpsError('failed-precondition', 'Only ranked games are finalized here.');
        }
        if (game.status !== 'finished' || !game.result) {
            throw new HttpsError('failed-precondition', 'Game is not finished.');
        }

        if (game.result.delta1 != null && game.result.delta2 != null) {
            return {
                ...game.result,
                newR1: game.result.newR1,
                newR2: game.result.newR2
            };
        }

        const p1Ref = db.collection('players').doc(game.player1uid);
        const p2Ref = db.collection('players').doc(game.player2uid);
        const [p1Snap, p2Snap] = await Promise.all([tx.get(p1Ref), tx.get(p2Ref)]);

        const p1 = p1Snap.exists ? p1Snap.data() : {};
        const p2 = p2Snap.exists ? p2Snap.data() : {};
        const r1 = typeof p1.rating === 'number' ? p1.rating : DEFAULT_RATING;
        const r2 = typeof p2.rating === 'number' ? p2.rating : DEFAULT_RATING;
        const scoreP1 = game.result.winner === 1 ? 1 : game.result.winner === 2 ? 0 : 0.5;
        const { delta1, delta2, newR1, newR2 } = computeEloDelta(r1, r2, scoreP1);

        tx.set(
            p1Ref,
            {
                displayName: p1.displayName || game.player1name,
                email: p1.email || '',
                rating: newR1,
                games: (p1.games || 0) + 1,
                wins: scoreP1 === 1 ? (p1.wins || 0) + 1 : p1.wins || 0,
                losses: scoreP1 === 0 ? (p1.losses || 0) + 1 : p1.losses || 0,
                draws: scoreP1 === 0.5 ? (p1.draws || 0) + 1 : p1.draws || 0,
                updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        tx.set(
            p2Ref,
            {
                displayName: p2.displayName || game.player2name,
                email: p2.email || '',
                rating: newR2,
                games: (p2.games || 0) + 1,
                wins: scoreP1 === 0 ? (p2.wins || 0) + 1 : p2.wins || 0,
                losses: scoreP1 === 1 ? (p2.losses || 0) + 1 : p2.losses || 0,
                draws: scoreP1 === 0.5 ? (p2.draws || 0) + 1 : p2.draws || 0,
                updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        tx.update(gameRef, {
            'result.delta1': delta1,
            'result.newR1': newR1,
            'result.delta2': delta2,
            'result.newR2': newR2
        });

        return {
            ...game.result,
            delta1,
            delta2,
            newR1,
            newR2
        };
    });

    return { ok: true, result };
});
