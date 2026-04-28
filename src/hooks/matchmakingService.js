import {
    doc,
    onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { enqueueForMatch as enqueueForMatchCall, runMatchmaker as runMatchmakerCall, cancelMatchmaking as cancelMatchmakingCall, heartbeatMatchmaking as heartbeatMatchmakingCall } from '../services/firebaseActions';
import { validateGame as validateGameCall } from '../services/firebaseActions';

function queueCollectionForMode(mode) {
    return mode === 'ranked' ? 'matchmakingQueue_ranked' : 'matchmakingQueue_casual';
}

export async function enqueueForMatch({ user, mode, gridSize = 6, timerEnabled = false }) {
    return enqueueForMatchCall({ mode, gridSize, timerEnabled, userId: user?.uid });
}

export function listenForMatch(userId, mode, onChange) {
    return onSnapshot(doc(db, queueCollectionForMode(mode), userId), (snap) => {
        onChange(snap.exists() ? snap.data() : null);
    });
}

export async function tryFindMatch({ userId, mode }) {
    const result = await runMatchmakerCall({ mode, userId });
    return result?.data?.gameId || null;
}

export async function validateGame({ gameId }) {
    const result = await validateGameCall({ gameId });
    return result?.data?.valid || false;
}

export async function cancelMatchmaking(userId, mode) {
    await cancelMatchmakingCall({ userId, mode });
}

export async function heartbeatMatchmaking(mode) {
    return heartbeatMatchmakingCall({ mode });
}