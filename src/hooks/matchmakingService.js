import {
    collection,
    doc,
    getDoc,
    getDocFromServer,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';
import { db } from '../firebase';

const QUEUE_COLLECTION = 'matchmakingQueue';
const DEFAULT_RATING = 1200;
const RANKED_BASE_RANGE = 100;
const RANKED_RANGE_STEP = 50;
const RANKED_RANGE_STEP_MS = 15 * 1000;

function getRankedRange(waitMs) {
    const steps = Math.floor(Math.max(0, waitMs) / RANKED_RANGE_STEP_MS);
    return RANKED_BASE_RANGE + steps * RANKED_RANGE_STEP;
}

function canRankedPlayersMatch(selfData, candidateData, selfRating, candidateRating) {
    const now = Date.now();
    if (!Number.isFinite(selfRating) || !Number.isFinite(candidateRating)) {
        return false;
    }
    const ratingDiff = Math.abs(selfRating - candidateRating);

    const selfWaitMs = now - Number(selfData.joinedAtMs ?? now);
    const candidateWaitMs = now - Number(candidateData.joinedAtMs ?? now);
    const selfRange = getRankedRange(selfWaitMs);
    const candidateRange = getRankedRange(candidateWaitMs);

    return ratingDiff <= selfRange && ratingDiff <= candidateRange;
}

async function loadRankedRatingSnapshot(userId) {
    const playerRef = doc(db, 'players', userId);

    // Prefer server value to avoid stale cache creating bad ranked matches.
    try {
        const snap = await getDocFromServer(playerRef);
        const rating = Number(snap.data()?.rating);
        if (Number.isFinite(rating)) return rating;
    } catch (_) {
        // Fallback to local cache if server read fails (e.g. temporary network issue).
    }

    const cachedSnap = await getDoc(playerRef);
    const cachedRating = Number(cachedSnap.data()?.rating);
    if (Number.isFinite(cachedRating)) return cachedRating;

    if (cachedSnap.exists()) return DEFAULT_RATING;
    return null;
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
        createdAt: serverTimestamp()
    };
}

export async function enqueueForMatch({ user, mode, gridSize = 6, timerEnabled = false }) {
    let ratingSnapshot = DEFAULT_RATING;
    if (mode === 'ranked') {
        ratingSnapshot = await loadRankedRatingSnapshot(user.uid);
        if (ratingSnapshot == null) {
            throw new Error('Ranked profile not ready. Please sign in again and retry.');
        }
    }

    const queueRef = doc(db, QUEUE_COLLECTION, user.uid);
    await setDoc(
        queueRef,
        {
            uid: user.uid,
            mode,
            status: 'searching',
            displayName: user.displayName || '',
            email: user.email || '',
            gridSize,
            timerEnabled,
            ratingSnapshot,
            gameId: null,
            matchedWith: null,
            joinedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
            joinedAt: serverTimestamp()
        },
        { merge: true }
    );

    return queueRef;
}

export function listenForMatch(userId, onChange) {
    return onSnapshot(doc(db, QUEUE_COLLECTION, userId), (snap) => {
        onChange(snap.exists() ? snap.data() : null);
    });
}

export async function tryFindMatch({ userId, mode }) {
    const queueQuery = query(
        collection(db, QUEUE_COLLECTION),
        where('mode', '==', mode),
        where('status', '==', 'searching')
    );

    const snapshot = await getDocs(queueQuery);
    const candidates = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((entry) => entry.uid !== userId)
        .sort((a, b) => {
            const diff = (a.joinedAtMs || 0) - (b.joinedAtMs || 0);
            return diff !== 0 ? diff : a.uid.localeCompare(b.uid);
        });

    const selfRef = doc(db, QUEUE_COLLECTION, userId);
    const selfPlayerRef = doc(db, 'players', userId);

    for (const candidate of candidates) {
        const candidateRef = doc(db, QUEUE_COLLECTION, candidate.uid);
        const candidatePlayerRef = doc(db, 'players', candidate.uid);
        const gameRef = doc(collection(db, 'games'));

        try {
            const result = await runTransaction(db, async (tx) => {
                const [selfSnap, candidateSnap, selfPlayerSnap, candidatePlayerSnap] = await Promise.all([
                    tx.get(selfRef),
                    tx.get(candidateRef),
                    tx.get(selfPlayerRef),
                    tx.get(candidatePlayerRef)
                ]);

                if (!selfSnap.exists() || !candidateSnap.exists()) return null;

                const selfData = selfSnap.data();
                const candidateData = candidateSnap.data();

                if (selfData.status !== 'searching' || candidateData.status !== 'searching') {
                    return null;
                }
                if (selfData.mode !== mode || candidateData.mode !== mode) return null;

                if (mode === 'ranked') {
                    const selfRating = Number(selfPlayerSnap.data()?.rating ?? selfData.ratingSnapshot);
                    const candidateRating = Number(
                        candidatePlayerSnap.data()?.rating ?? candidateData.ratingSnapshot
                    );

                    if (!canRankedPlayersMatch(selfData, candidateData, selfRating, candidateRating)) {
                        return null;
                    }
                }

                const selfEntry = { uid: userId, ...selfData };
                const opponentEntry = { uid: candidate.uid, ...candidateData };

                tx.set(gameRef, buildGamePayload({ mode, selfEntry, opponentEntry }));

                tx.update(selfRef, {
                    status: 'matched',
                    gameId: gameRef.id,
                    matchedWith: candidate.uid,
                    matchedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                tx.update(candidateRef, {
                    status: 'matched',
                    gameId: gameRef.id,
                    matchedWith: userId,
                    matchedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                return gameRef.id;
            });

            if (result) return result;
        } catch (_) {
            // Another client may have matched this candidate first.
        }
    }

    return null;
}

export async function cancelMatchmaking(userId) {
    await updateDoc(doc(db, QUEUE_COLLECTION, userId), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}