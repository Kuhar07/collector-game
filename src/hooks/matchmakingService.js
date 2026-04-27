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
import {
    DEFAULT_DISPLAY_RATING,
    DEFAULT_MU,
    DEFAULT_SIGMA,
    getDisplayRatingFromProfile,
    normalizeSkillProfile
} from '../game/skillRating';

const QUEUE_COLLECTION = 'matchmakingQueue';

function sampleWithoutReplacement(items, count) {
    const pool = items.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.max(0, count));
}

async function loadRankedSkillSnapshot(userId) {
    const playerRef = doc(db, 'players', userId);

    // Prefer server value to avoid stale cache creating bad ranked matches.
    try {
        const snap = await getDocFromServer(playerRef);
        const profile = normalizeSkillProfile(snap.data() || {});
        if (profile) return profile;
    } catch (_) {
        // Fallback to local cache if server read fails (e.g. temporary network issue).
    }

    const cachedSnap = await getDoc(playerRef);
    const cachedProfile = normalizeSkillProfile(cachedSnap.data() || {});
    if (cachedProfile) return cachedProfile;

    if (cachedSnap.exists()) return normalizeSkillProfile({ rating: DEFAULT_DISPLAY_RATING });
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
    let skillSnapshot = normalizeSkillProfile({ mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, rating: DEFAULT_DISPLAY_RATING });
    if (mode === 'ranked') {
        skillSnapshot = await loadRankedSkillSnapshot(user.uid);
        if (skillSnapshot == null) {
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
            mu: skillSnapshot.mu,
            sigma: skillSnapshot.sigma,
            rating: skillSnapshot.rating,
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
        .filter((entry) => entry.uid !== userId);

    const poolSize = Math.min(Math.ceil(candidates.length / 10), 1000);
    const sampledCandidates = sampleWithoutReplacement(candidates, poolSize);

    const selfRef = doc(db, QUEUE_COLLECTION, userId);
    const selfSnap = await getDoc(selfRef);
    if (!selfSnap.exists()) return null;
    const selfData = normalizeSkillProfile(selfSnap.data() || {});
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

    if (scoredCandidates.length === 0) {
        return null;
    }

    const closestDiff = Math.abs(scoredCandidates[0].displayRating - selfDisplayRating);
    const tiedCandidates = scoredCandidates.filter(
        (entry) => Math.abs(entry.displayRating - selfDisplayRating) === closestDiff
    );
    const chosenCandidate = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
    const candidateRef = doc(db, QUEUE_COLLECTION, chosenCandidate.candidate.uid);
    const gameRef = doc(collection(db, 'games'));

    try {
        const result = await runTransaction(db, async (tx) => {
            const [liveSelfSnap, liveCandidateSnap] = await Promise.all([
                tx.get(selfRef),
                tx.get(candidateRef)
            ]);

            if (!liveSelfSnap.exists() || !liveCandidateSnap.exists()) return null;

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

            const selfEntry = { uid: userId, ...liveSelf, ...selfData };
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

    return null;
}

export async function cancelMatchmaking(userId) {
    await updateDoc(doc(db, QUEUE_COLLECTION, userId), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}