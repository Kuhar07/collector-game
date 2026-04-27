const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const QUEUE_COLLECTION = 'matchmakingQueue';
const GAMES_COLLECTION = 'games';
const DEFAULT_MU = 1500;
const DEFAULT_SIGMA = 500;
const DEFAULT_DISPLAY_RATING = 1000;
const OPEN_SKILL_BETA = 250;
const DISPLAY_SCALE = 1000 / Math.LN2;
const DISPLAY_DIVISOR = 2485;
const MIN_SIGMA = 1;
const EPSILON = 1e-12;

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

function erf(x) {
    const sign = Math.sign(x) || 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absX);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
    return sign * y;
}

function standardNormalPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function standardNormalCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

function softplus(x) {
    if (x > 0) return x + Math.log1p(Math.exp(-x));
    return Math.log1p(Math.exp(x));
}

function conservativeSkillFromDisplayRating(displayRating) {
    const normalizedDisplay = Math.max(0, Number(displayRating) || 0);
    const scaled = (normalizedDisplay * Math.LN2) / 1000;
    if (scaled === 0) return Number.NEGATIVE_INFINITY;
    return DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
}

function displayRatingFromConservativeSkill(conservativeSkill) {
    const value = Number(conservativeSkill);
    if (!Number.isFinite(value)) return DEFAULT_DISPLAY_RATING;
    return Math.max(0, DISPLAY_SCALE * softplus(value / DISPLAY_DIVISOR));
}

function normalizeSkillProfile(profile = {}) {
    const mu = Number(profile.mu);
    const sigma = Number(profile.sigma);
    if (Number.isFinite(mu) && Number.isFinite(sigma)) {
        const clampedSigma = Math.max(MIN_SIGMA, sigma);
        return {
            mu,
            sigma: clampedSigma,
            rating: Math.round(displayRatingFromConservativeSkill(mu - 3 * clampedSigma))
        };
    }

    const legacyRating = Number(profile.rating);
    if (Number.isFinite(legacyRating)) {
        const clampedRating = Math.max(0, legacyRating);
        const conservativeSkill = conservativeSkillFromDisplayRating(clampedRating);
        return {
            mu: conservativeSkill + 3 * DEFAULT_SIGMA,
            sigma: DEFAULT_SIGMA,
            rating: Math.round(clampedRating)
        };
    }

    return {
        mu: DEFAULT_MU,
        sigma: DEFAULT_SIGMA,
        rating: DEFAULT_DISPLAY_RATING
    };
}

function computeSkillDelta(profileA, profileB, scoreA) {
    const a = normalizeSkillProfile(profileA);
    const b = normalizeSkillProfile(profileB);

    if (scoreA === 0.5) {
        return {
            delta1: 0,
            delta2: 0,
            newR1: a.rating,
            newR2: b.rating,
            profile1: a,
            profile2: b
        };
    }

    const firstIsWinner = scoreA === 1;
    const winner = firstIsWinner ? a : b;
    const loser = firstIsWinner ? b : a;
    const winnerSigmaSq = winner.sigma ** 2;
    const loserSigmaSq = loser.sigma ** 2;
    const c = Math.sqrt(2 * OPEN_SKILL_BETA ** 2 + winnerSigmaSq + loserSigmaSq);
    const t = (winner.mu - loser.mu) / c;
    const p = Math.max(standardNormalCdf(t), EPSILON);
    const pdf = standardNormalPdf(t);
    const gamma = 1 / c;
    const v = (pdf * (t + pdf / p)) / p;

    const winnerMu = winner.mu + (winnerSigmaSq / c) * (pdf / p);
    const loserMu = loser.mu - (loserSigmaSq / c) * (pdf / p);
    const winnerSigma = Math.sqrt(Math.max(winnerSigmaSq * (1 - winnerSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));
    const loserSigma = Math.sqrt(Math.max(loserSigmaSq * (1 - loserSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));

    const winnerProfile = {
        mu: winnerMu,
        sigma: winnerSigma,
        rating: Math.round(displayRatingFromConservativeSkill(winnerMu - 3 * winnerSigma))
    };
    const loserProfile = {
        mu: loserMu,
        sigma: loserSigma,
        rating: Math.round(displayRatingFromConservativeSkill(loserMu - 3 * loserSigma))
    };

    const profile1 = firstIsWinner ? winnerProfile : loserProfile;
    const profile2 = firstIsWinner ? loserProfile : winnerProfile;

    return {
        delta1: profile1.rating - a.rating,
        delta2: profile2.rating - b.rating,
        newR1: profile1.rating,
        newR2: profile2.rating,
        profile1,
        profile2
    };
}

function getDisplayRatingFromProfile(profile = {}) {
    return normalizeSkillProfile(profile).rating;
}

function sampleWithoutReplacement(items, count) {
    const pool = items.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.max(0, count));
}

async function tryMatch(uid, mode) {
    const selfRef = db.collection(QUEUE_COLLECTION).doc(uid);
    const queueSnapshot = await db
        .collection(QUEUE_COLLECTION)
        .where('mode', '==', mode)
        .where('status', '==', 'searching')
        .get();

    const candidates = queueSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((entry) => entry.uid !== uid);

    const poolSize = Math.min(Math.ceil(candidates.length / 10), 1000);
    const sampledCandidates = sampleWithoutReplacement(candidates, poolSize);
    const selfSnap = await selfRef.get();
    if (!selfSnap.exists) return null;
    const selfData = normalizeSkillProfile(selfSnap.data());
    const selfDisplayRating = getDisplayRatingFromProfile(selfData);

    const scoredCandidates = sampledCandidates
        .map((candidate) => ({
            candidate,
            profile: normalizeSkillProfile(candidate),
            displayRating: getDisplayRatingFromProfile(candidate)
        }))
        .sort((a, b) => {
            const aDiff = Math.abs(a.displayRating - selfDisplayRating);
            const bDiff = Math.abs(b.displayRating - selfDisplayRating);
            if (aDiff !== bDiff) return aDiff - bDiff;
            const tie = (a.candidate.joinedAtMs || 0) - (b.candidate.joinedAtMs || 0);
            return tie !== 0 ? tie : a.candidate.uid.localeCompare(b.candidate.uid);
        });

    if (scoredCandidates.length === 0) return null;

    const closestDiff = Math.abs(scoredCandidates[0].displayRating - selfDisplayRating);
    const tiedCandidates = scoredCandidates.filter(
        (entry) => Math.abs(entry.displayRating - selfDisplayRating) === closestDiff
    );
    const chosenCandidate = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
    const candidateRef = db.collection(QUEUE_COLLECTION).doc(chosenCandidate.candidate.uid);
    const gameRef = db.collection(GAMES_COLLECTION).doc();

    try {
        const result = await db.runTransaction(async (tx) => {
            const [liveSelfSnap, liveCandidateSnap] = await Promise.all([
                tx.get(selfRef),
                tx.get(candidateRef)
            ]);

            if (!liveSelfSnap.exists || !liveCandidateSnap.exists) return null;

            const liveSelf = liveSelfSnap.data();
            const liveCandidate = liveCandidateSnap.data();

            if (liveSelf.status !== 'searching' || liveCandidate.status !== 'searching') {
                return null;
            }
            if (liveSelf.mode !== mode || liveCandidate.mode !== mode) return null;

            const liveSelfRating = getDisplayRatingFromProfile(liveSelf);
            const liveCandidateRating = getDisplayRatingFromProfile(liveCandidate);
            if (Math.abs(liveSelfRating - liveCandidateRating) !== closestDiff) {
                return null;
            }

            const selfEntry = { uid, ...liveSelf, ...selfData };
            const opponentEntry = {
                uid: chosenCandidate.candidate.uid,
                ...liveCandidate,
                ...chosenCandidate.profile
            };

            tx.set(gameRef, buildGamePayload({ mode, selfEntry, opponentEntry }));
            tx.update(selfRef, {
                status: 'matched',
                gameId: gameRef.id,
                matchedWith: chosenCandidate.candidate.uid,
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
        // Ignore transaction races and continue searching on the next retry.
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
            mu: DEFAULT_MU,
            sigma: DEFAULT_SIGMA,
            rating: DEFAULT_DISPLAY_RATING,
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

        const p1Raw = p1Snap.exists ? p1Snap.data() : {};
        const p2Raw = p2Snap.exists ? p2Snap.data() : {};
        const p1 = normalizeSkillProfile(p1Raw);
        const p2 = normalizeSkillProfile(p2Raw);
        const scoreP1 = game.result.winner === 1 ? 1 : game.result.winner === 2 ? 0 : 0.5;
        const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);

        tx.set(
            p1Ref,
            {
                displayName: p1Raw.displayName || game.player1name,
                email: p1Raw.email || '',
                mu: profile1.mu,
                sigma: profile1.sigma,
                rating: newR1,
                games: (p1Raw.games || 0) + 1,
                wins: scoreP1 === 1 ? (p1Raw.wins || 0) + 1 : p1Raw.wins || 0,
                losses: scoreP1 === 0 ? (p1Raw.losses || 0) + 1 : p1Raw.losses || 0,
                draws: scoreP1 === 0.5 ? (p1Raw.draws || 0) + 1 : p1Raw.draws || 0,
                updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        tx.set(
            p2Ref,
            {
                displayName: p2Raw.displayName || game.player2name,
                email: p2Raw.email || '',
                mu: profile2.mu,
                sigma: profile2.sigma,
                rating: newR2,
                games: (p2Raw.games || 0) + 1,
                wins: scoreP1 === 0 ? (p2Raw.wins || 0) + 1 : p2Raw.wins || 0,
                losses: scoreP1 === 1 ? (p2Raw.losses || 0) + 1 : p2Raw.losses || 0,
                draws: scoreP1 === 0.5 ? (p2Raw.draws || 0) + 1 : p2Raw.draws || 0,
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
