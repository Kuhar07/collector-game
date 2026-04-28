import { auth } from '../firebase';

const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

async function getAuthHeaders() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function callBackend(path, body) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Backend request failed.');
  }
  return { data };
}

export async function ensurePlayerProfile() {
  return callBackend('/profile/ensure', {});
}

export async function createCasualRoom({ code, gridSize, timerEnabled }) {
  return callBackend('/room/create', { code, gridSize, timerEnabled });
}

export async function joinCasualRoom({ code }) {
  return callBackend('/room/join', { code });
}

export async function cancelCasualRoom({ code }) {
  return callBackend('/room/cancel', { code });
}

export async function submitGameMove({ gameId, row, col }) {
  return callBackend('/game/move', { gameId, row, col });
}

export async function submitGameTimeout({ gameId }) {
  return callBackend('/game/timeout', { gameId });
}

export async function leaveOnlineGame({ gameId }) {
  return callBackend('/game/leave', { gameId });
}

export async function notifyGameJoin({ gameId }) {
  return callBackend('/game/join', { gameId });
}

export async function enqueueForMatch({ mode, gridSize, timerEnabled }) {
  return callBackend('/matchmaking/enqueue', { mode, gridSize, timerEnabled });
}

export async function runMatchmaker({ mode }) {
  return callBackend('/matchmaking/run', { mode });
}

export async function cancelMatchmaking({ userId }) {
  return callBackend('/matchmaking/cancel', { userId });
}

export async function heartbeatMatchmaking({ mode }) {
  return callBackend('/matchmaking/heartbeat', { mode });
}

export async function validateGame({ gameId }) {
  return callBackend('/game/validate', { gameId });
}

export async function finalizeRankedResult({ gameId }) {
  return callBackend('/ranked/finalize', { gameId });
}
