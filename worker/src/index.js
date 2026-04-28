import { importX509, jwtVerify } from 'jose';

const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIREBASE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const DEFAULT_MU = 1500;
const DEFAULT_SIGMA = 500;
const DEFAULT_DISPLAY_RATING = 1000;
const OPEN_SKILL_BETA = 250;
const DISPLAY_SCALE = 1000 / Math.LN2;
const DISPLAY_DIVISOR = 2485;
const MIN_SIGMA = 1;
const EPSILON = 1e-12;
const MATCHMAKING_STALE_MS_BY_MODE = {
  ranked: 25 * 1000,
  casual: 30 * 1000
};
const MATCHMAKING_STALE_MS = 30 * 1000;

const RANKED_BAND_INITIAL = 100;
const RANKED_BAND_STEP = 100;
const RANKED_BAND_INTERVAL_MS = 5 * 1000;
const RANKED_BAND_MAX = 800;

function ratingBandForMode(mode, waitMs) {
  if (mode !== 'ranked') return Number.POSITIVE_INFINITY;
  const intervals = Math.floor(Math.max(0, waitMs) / RANKED_BAND_INTERVAL_MS);
  return Math.min(RANKED_BAND_MAX, RANKED_BAND_INITIAL + RANKED_BAND_STEP * intervals);
}

let certCache = null;
let certCacheExpiresAt = 0;
let googleTokenCache = null;
let googleTokenExpiresAt = 0;
let pkcs8KeyPromise = null;

function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function errorResponse(message, status = 400) {
  return corsResponse({ error: message }, status);
}

function base64UrlEncode(bytes) {
  let str = '';
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonToBase64Url(json) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(json)));
}

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

function normalizeMode(mode) {
  return mode === 'ranked' ? 'ranked' : 'casual';
}

function matchmakingCollection(mode) {
  return mode === 'ranked' ? 'matchmakingQueue_ranked' : 'matchmakingQueue_casual';
}
function buildPlayerName(entry) {
  return entry.displayName || entry.email || 'Player';
}

function createInitialState(size) {
  const state = [];
  for (let i = 0; i < size; i += 1) {
    const row = [];
    for (let j = 0; j < size; j += 1) {
      row.push({ player: null, eliminated: false });
    }
    state.push(row);
  }
  return state;
}

function normalizeGameState(gameStateJSON, size) {
  if (!gameStateJSON) return createInitialState(size);
  try {
    const parsed = JSON.parse(gameStateJSON);
    if (!Array.isArray(parsed) || !parsed.length) {
      return createInitialState(size);
    }
    return parsed;
  } catch (_) {
    return createInitialState(size);
  }
}

function deepCopyState(state) {
  return (state || []).map((row) => row.map((cell) => ({ ...cell })));
}

function hasAdjacentFree(state, size, row, col) {
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      if (i === 0 && j === 0) continue;
      const r = row + i;
      const c = col + j;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const cell = state[r][c];
      if (cell.player === null && !cell.eliminated) return true;
    }
  }
  return false;
}

function isValidPlacement(state, size, row, col) {
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated) return false;
  return hasAdjacentFree(state, size, row, col);
}

function isValidElimination(state, lastPlaces, row, col) {
  if (!lastPlaces) return false;
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated) return false;
  const dr = Math.abs(row - lastPlaces.row);
  const dc = Math.abs(col - lastPlaces.col);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return false;
  return true;
}

function applyPlace(state, player, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].player = player;
  return nextState;
}

function applyEliminate(state, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].eliminated = true;
  return nextState;
}

function dfs(state, size, r, c, player, visited) {
  if (r < 0 || r >= size || c < 0 || c >= size) return 0;
  if (visited[r][c]) return 0;
  if (state[r][c].player !== player) return 0;
  visited[r][c] = true;
  let count = 1;
  for (const [dr, dc] of [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ]) {
    count += dfs(state, size, r + dr, c + dc, player, visited);
  }
  return count;
}

function getBiggestGroup(state, size, player) {
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  let best = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (state[i][j].player === player && !visited[i][j]) {
        best = Math.max(best, dfs(state, size, i, j, player, visited));
      }
    }
  }
  return best;
}

function hasAnyValidMove(state, size) {
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (state[i][j].player === null && !state[i][j].eliminated) {
        if (hasAdjacentFree(state, size, i, j)) return true;
      }
    }
  }
  return false;
}

function computeGameResult(state, size) {
  if (hasAnyValidMove(state, size)) return null;
  const score1 = getBiggestGroup(state, size, 1);
  const score2 = getBiggestGroup(state, size, 2);
  return {
    winner: score1 === score2 ? 0 : score1 > score2 ? 1 : 2,
    score1,
    score2
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

function historyToArray(history) {
  if (Array.isArray(history)) {
    return history
      .map((point) => {
        if (Array.isArray(point) && point.length === 2) {
          return { r: point[0], c: point[1] };
        }
        if (point && Number.isInteger(point.r) && Number.isInteger(point.c)) {
          return { r: point.r, c: point.c };
        }
        if (point && Number.isInteger(point.row) && Number.isInteger(point.col)) {
          return { r: point.row, c: point.col };
        }
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

function getQueueEntryAgeMs(entry) {
  const data = entry?.data || {};
  const timestamp = Number(data.updatedAtMs || data.joinedAtMs || Date.parse(data.updatedAt || data.joinedAt || '') || 0);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function isFreshQueueEntry(entry) {
  const mode = normalizeMode(entry?.data?.mode);
  const staleMs = MATCHMAKING_STALE_MS_BY_MODE[mode] || MATCHMAKING_STALE_MS;
  return getQueueEntryAgeMs(entry) <= staleMs;
}

function docPath(collectionName, id) {
  return `/${collectionName}/${id}`;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => firestoreValue(item))
      }
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val !== undefined) fields[key] = firestoreValue(val);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreFieldsFromObject(obj = {}) {
  const fields = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined) fields[key] = firestoreValue(value);
  });
  return fields;
}

function firestoreObjectFromFields(fields = {}) {
  const result = {};
  Object.entries(fields).forEach(([key, value]) => {
    result[key] = firestoreValueToJs(value);
  });
  return result;
}

function firestoreValueToJs(value) {
  if (value == null) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map((entry) => firestoreValueToJs(entry));
  }
  if ('mapValue' in value) {
    return firestoreObjectFromFields(value.mapValue?.fields || {});
  }
  return null;
}

async function getGoogleAccessToken(env) {
  if (googleTokenCache && Date.now() < googleTokenExpiresAt - 60_000) {
    return googleTokenCache;
  }

  const privateKey = env.FIREBASE_PRIVATE_KEY;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) {
    throw new Error('Missing Cloudflare worker secrets for Firebase service account.');
  }

  const assertion = await createServiceAccountJwt(env, clientEmail, privateKey);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain Google access token: ${response.status}`);
  }

  const data = await response.json();
  googleTokenCache = data.access_token;
  googleTokenExpiresAt = Date.now() + (Number(data.expires_in || 0) * 1000);
  return googleTokenCache;
}

async function createServiceAccountJwt(env, clientEmail, privateKeyPem) {
  if (!pkcs8KeyPromise) {
    const pkcs8 = pemToArrayBuffer(privateKeyPem);
    pkcs8KeyPromise = crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
    sub: clientEmail
  };

  const encoder = new TextEncoder();
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const key = await pkcs8KeyPromise;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function firestoreFetch(env, path, options = {}) {
  const accessToken = await getGoogleAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return response;
}

async function getDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to read document ${collectionName}/${id}: ${response.status}`);
  }
  const data = await response.json();
  return {
    name: data.name,
    id: data.name?.split('/').pop(),
    updateTime: data.updateTime,
    createTime: data.createTime,
    data: firestoreObjectFromFields(data.fields || {})
  };
}

async function writeDocument(env, collectionName, id, data, updateTime) {
  const query = updateTime ? `?currentDocument.updateTime=${encodeURIComponent(updateTime)}` : '';
  const response = await firestoreFetch(env, `${docPath(collectionName, id)}${query}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: firestoreFieldsFromObject(data) })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to write document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  const body = await response.json();
  return {
    name: body.name,
    id: body.name?.split('/').pop(),
    updateTime: body.updateTime,
    data: firestoreObjectFromFields(body.fields || {})
  };
}

async function deleteDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id), {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to delete document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  return { ok: true };
}

async function ensurePlayerDoc(env, authUser) {
  const playerRef = await getDocument(env, 'players', authUser.uid);
  const current = playerRef?.data || {};
  const next = {
    displayName: current.displayName || authUser.name || authUser.email || 'Player',
    email: current.email || authUser.email || '',
    mu: Number.isFinite(Number(current.mu)) ? Number(current.mu) : DEFAULT_MU,
    sigma: Number.isFinite(Number(current.sigma)) ? Math.max(MIN_SIGMA, Number(current.sigma)) : DEFAULT_SIGMA,
    rating: Number.isFinite(Number(current.rating)) ? Number(current.rating) : DEFAULT_DISPLAY_RATING,
    games: Number(current.games || 0),
    wins: Number(current.wins || 0),
    losses: Number(current.losses || 0),
    draws: Number(current.draws || 0),
    state: current.state || 'idle',
    updatedAt: new Date().toISOString()
  };
  const write = await writeDocument(env, 'players', authUser.uid, next);
  return write.data;
}

async function setPlayerState(env, uid, newState) {
  const player = await getDocument(env, 'players', uid);
  const next = {
    ...(player?.data || {}),
    state: newState,
    updatedAt: new Date().toISOString()
  };
  // Write unconditionally to ensure state is updated even if updateTime changed.
  return await writeDocument(env, 'players', uid, next);
}

async function verifyFirebaseIdToken(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new Error('Missing Authorization bearer token.');

  const { payload } = await jwtVerify(token, async (header) => {
    if (!header.kid) throw new Error('Firebase token missing key id.');
    const certs = await getFirebaseCerts();
    const pem = certs[header.kid];
    if (!pem) throw new Error('Firebase cert not found for token kid.');
    return importX509(pem, 'RS256');
  }, {
    audience: env.FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
  });

  if (!isAllowedEmail(payload.email || '')) throw new Error('Only @gmail.com accounts can use this app.');

  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || '',
    name: payload.name || payload.email || ''
  };
}

async function getFirebaseCerts() {
  if (certCache && Date.now() < certCacheExpiresAt) return certCache;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new Error('Failed to fetch Firebase public certificates.');
  certCache = await response.json();
  certCacheExpiresAt = Date.now() + 60 * 60 * 1000;
  return certCache;
}

function getRequestJson(request) {
  return request.json().catch(() => ({}));
}

async function queryQueueDocs(env, mode, extraFilters = {}) {
  const collectionId = matchmakingCollection(mode);
  const filters = [
    { fieldFilter: { field: { fieldPath: 'mode' }, op: 'EQUAL', value: { stringValue: mode } } },
    { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'searching' } } }
  ];
  if (Number.isFinite(Number(extraFilters.gridSize))) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'gridSize' },
        op: 'EQUAL',
        value: { integerValue: String(Number(extraFilters.gridSize)) }
      }
    });
  }
  if (typeof extraFilters.timerEnabled === 'boolean') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'timerEnabled' },
        op: 'EQUAL',
        value: { booleanValue: extraFilters.timerEnabled }
      }
    });
  }
  const response = await firestoreFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { compositeFilter: { op: 'AND', filters } }
      }
    })
  });
  if (!response.ok) throw new Error('Failed to query matchmaking queue.');
  const rows = await response.json();
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((doc) => ({
      id: doc.name?.split('/').pop(),
      updateTime: doc.updateTime,
      data: firestoreObjectFromFields(doc.fields || {})
    }));
}

async function handleProfileEnsure(env, authUser) {
  const profile = await ensurePlayerDoc(env, authUser);
  return corsResponse({ ok: true, profile });
}

async function handleRoomAction(env, authUser, body) {
  const action = String(body.action || '');
  const displayName = authUser.name || authUser.email || 'Player';
  const code = String(body.code || '').toUpperCase().trim();

  if (action === 'create') {
    if (!code || code.length !== 6) return errorResponse('Room code is required.', 400);
    const gameId = `game_${code}`;
    await writeDocument(env, 'games', gameId, {
      gameCode: code,
      mode: 'casual',
      source: 'room',
      status: 'waiting',
      player1uid: authUser.uid,
      player1name: displayName,
      player2uid: null,
      player2name: null,
      gridSize: Number(body.gridSize) || 6,
      timerEnabled: !!body.timerEnabled,
      currentPlayer: 1,
      phase: 'place',
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now()
    });
    return corsResponse({ ok: true, gameId });
  }

  if (action === 'join') {
    if (!code || code.length !== 6) return errorResponse('Room code is required.', 400);
    const gameId = `game_${code}`;
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Room not found.', 404);
    const current = game.data;
    if (current.status !== 'waiting' || current.mode !== 'casual' || current.source !== 'room') {
      return errorResponse('Room is not available.', 412);
    }
    if (current.player1uid === authUser.uid || current.player2uid === authUser.uid) {
      return corsResponse({ ok: true, gameId });
    }
    if (current.player2uid) return errorResponse('Room is already full.', 412);
    await writeDocument(env, 'games', gameId, {
      ...current,
      player2uid: authUser.uid,
      player2name: displayName,
      status: 'active'
    }, game.updateTime);
    return corsResponse({ ok: true, gameId });
  }

  if (action === 'cancel') {
    if (!code || code.length !== 6) return errorResponse('Room code is required.', 400);
    const gameId = `game_${code}`;
    const game = await getDocument(env, 'games', gameId);
    if (!game) return corsResponse({ ok: true });
    const current = game.data;
    if (current.player1uid !== authUser.uid) {
      return errorResponse('Only the room owner can cancel it.', 403);
    }
    await writeDocument(env, 'games', gameId, { ...current, status: 'cancelled' }, game.updateTime);
    return corsResponse({ ok: true });
  }

  return errorResponse('Unknown room action.', 400);
}

async function handleMatchmakingAction(env, authUser, body) {
  const action = String(body.action || '');
  const mode = normalizeMode(body.mode);
  const queueCollection = matchmakingCollection(mode);

  if (action === 'enqueue') {
    // Check if player is already in a game or searching
    const existingQueue = await getDocument(env, queueCollection, authUser.uid);
    if (existingQueue && existingQueue.data.status === 'searching') {
      return errorResponse('Already searching for a match', 400);
    }

    const profile = await ensurePlayerDoc(env, authUser);
    // Only allow enqueue if player is idle or finished
    if (profile.state !== 'idle' && profile.state !== 'finished') {
      return errorResponse(`Cannot enqueue while in state: ${profile.state}`, 400);
    }

    const queueData = {
      uid: authUser.uid,
      mode,
      status: 'searching',
      displayName: authUser.name || authUser.email || '',
      email: authUser.email || '',
      gridSize: mode === 'ranked' ? 8 : Number(body.gridSize) || 6,
      timerEnabled: mode === 'ranked' ? true : !!body.timerEnabled,
      mu: profile.mu,
      sigma: profile.sigma,
      rating: profile.rating,
      gameId: null,
      matchedWith: null,
      queueToken: crypto.randomUUID(),
      joinedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString(),
      joinedAt: new Date().toISOString()
    };
    await writeDocument(env, queueCollection, authUser.uid, queueData);
    await setPlayerState(env, authUser.uid, 'searching');
    return corsResponse({ ok: true });
  }

  if (action === 'cancel') {
    let queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue) {
      await setPlayerState(env, authUser.uid, 'idle');
      return corsResponse({ ok: true });
    }
    await deleteDocument(env, queueCollection, authUser.uid);
    await setPlayerState(env, authUser.uid, 'idle');
    return corsResponse({ ok: true });
  }

  if (action === 'heartbeat') {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue) return corsResponse({ ok: true, alive: false });
    if (queue.data.status !== 'searching') {
      return corsResponse({ ok: true, alive: false, status: queue.data.status, gameId: queue.data.gameId || null });
    }
    await writeDocument(env, queueCollection, authUser.uid, {
      ...queue.data,
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString()
    }, queue.updateTime);
    return corsResponse({ ok: true, alive: true });
  }

  if (action === 'run') {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue) return corsResponse({ ok: true, gameId: null });
    const self = queue.data;
    if (self.status !== 'searching') return corsResponse({ ok: true, gameId: null });

    const candidates = await queryQueueDocs(
      env,
      mode,
      mode === 'casual'
        ? { gridSize: Number(self.gridSize) || 6, timerEnabled: !!self.timerEnabled }
        : {}
    );
    const others = candidates.filter((entry) => entry.id !== authUser.uid);
    if (!others.length) return corsResponse({ ok: true, gameId: null });

    const now = Date.now();
    const selfDisplayRating = Number(self.rating || DEFAULT_DISPLAY_RATING);
    const selfJoinedAtMs = Number(self.joinedAtMs) || now;
    const selfBand = ratingBandForMode(mode, now - selfJoinedAtMs);

    const liveCandidates = [];
    for (const entry of others) {
      if (!isFreshQueueEntry(entry)) {
        await writeDocument(env, queueCollection, entry.id, {
          ...entry.data,
          status: 'stale',
          updatedAtMs: now,
          updatedAt: new Date().toISOString()
        });
        continue;
      }
      if (entry.data?.status !== 'searching' || entry.data?.matchedWith || entry.data?.gameId) {
        continue;
      }
      const candRating = Number(entry.data.rating || DEFAULT_DISPLAY_RATING);
      const candJoinedAtMs = Number(entry.data.joinedAtMs) || now;
      const candBand = ratingBandForMode(mode, now - candJoinedAtMs);
      const allowedDiff = Math.min(selfBand, candBand);
      if (Math.abs(candRating - selfDisplayRating) > allowedDiff) continue;
      liveCandidates.push(entry);
    }

    const scored = liveCandidates
      .map((candidate) => ({
        candidate,
        displayRating: Number(candidate.data.rating || DEFAULT_DISPLAY_RATING)
      }))
      .sort((a, b) => {
        const aDiff = Math.abs(a.displayRating - selfDisplayRating);
        const bDiff = Math.abs(b.displayRating - selfDisplayRating);
        if (aDiff !== bDiff) return aDiff - bDiff;
        return (a.candidate.data.joinedAtMs || 0) - (b.candidate.data.joinedAtMs || 0);
      });

    if (!scored.length) return corsResponse({ ok: true, gameId: null });
    const closestDiff = Math.abs(scored[0].displayRating - selfDisplayRating);
    const tied = scored.filter((entry) => Math.abs(entry.displayRating - selfDisplayRating) === closestDiff);
    const chosen = tied[Math.floor(Math.random() * tied.length)];

    // Deterministic pairing: only the lexicographically smaller UID creates the match.
    // The other player observes their queue doc flip to `matched` via Firestore listener.
    if (authUser.uid >= chosen.candidate.id) {
      return corsResponse({ ok: true, gameId: null, debug: { reason: 'defer_to_lower_uid' } });
    }

    const candidateQueue = await getDocument(env, queueCollection, chosen.candidate.id);
    if (!candidateQueue) return corsResponse({ ok: true, gameId: null });

    const liveSelf = await getDocument(env, queueCollection, authUser.uid);
    if (!liveSelf || liveSelf.data.status !== 'searching') return corsResponse({ ok: true, gameId: null });
    const selfProfileDoc = await getDocument(env, 'players', authUser.uid);
    if (!selfProfileDoc || selfProfileDoc.data?.state !== 'searching') return corsResponse({ ok: true, gameId: null });
    const liveCandidate = candidateQueue.data;
    const candidateProfileDoc = await getDocument(env, 'players', chosen.candidate.id);
    if (!candidateProfileDoc || candidateProfileDoc.data?.state !== 'searching') {
      return corsResponse({ ok: true, gameId: null });
    }
    if (liveCandidate.status !== 'searching' || liveCandidate.mode !== mode || liveCandidate.gameId || liveCandidate.matchedWith) {
      return corsResponse({ ok: true, gameId: null });
    }

    const selfJoined = liveSelf.data.joinedAtMs || 0;
    const opponentJoined = liveCandidate.joinedAtMs || 0;
    const selfIsP1 = selfJoined < opponentJoined || (selfJoined === opponentJoined && authUser.uid < chosen.candidate.id);
    const p1 = selfIsP1 ? liveSelf.data : liveCandidate;
    const p2 = selfIsP1 ? liveCandidate : liveSelf.data;

    const gameId = `game_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await writeDocument(env, 'games', gameId, {
      gameCode: null,
      mode,
      source: 'matchmaking',
      status: 'active',
      player1uid: selfIsP1 ? authUser.uid : chosen.candidate.id,
      player1name: buildPlayerName(p1),
      player2uid: selfIsP1 ? chosen.candidate.id : authUser.uid,
      player2name: buildPlayerName(p2),
      gridSize: mode === 'ranked' ? 8 : Number(self.gridSize) || 6,
      timerEnabled: mode === 'ranked' ? true : !!self.timerEnabled,
      currentPlayer: 1,
      phase: 'place',
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: new Date().toISOString()
    });

    // Stronger guards: verify neither queue entry already references a game
    if ((liveSelf.data && liveSelf.data.gameId) || (liveCandidate && liveCandidate.gameId)) {
      // Another process raced and assigned a game; mark created game cancelled and abort
      try {
        await writeDocument(env, 'games', gameId, { ...{ status: 'cancelled', createdAt: new Date().toISOString() } });
      } catch (e) {
        // best-effort rollback — ignore failures
      }
      return corsResponse({ ok: true, gameId: null, debug: { reason: 'race_game_already_assigned' } });
    }

    // Try to update both queue rows; if either update fails, roll back the created game to avoid orphaned matches
    try {
      await writeDocument(env, queueCollection, authUser.uid, {
        ...liveSelf.data,
        status: 'matched',
        gameId,
        matchedWith: chosen.candidate.id,
        matchedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        updatedAt: new Date().toISOString()
      }, liveSelf.updateTime);

      await writeDocument(env, queueCollection, chosen.candidate.id, {
        ...liveCandidate,
        status: 'matched',
        gameId,
        matchedWith: authUser.uid,
        matchedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        updatedAt: new Date().toISOString()
      }, candidateQueue.updateTime);

      // Update both players' state to 'playing' so clients see the active game state
      await setPlayerState(env, authUser.uid, 'playing');
      await setPlayerState(env, chosen.candidate.id, 'playing');

      return corsResponse({ ok: true, gameId, debug: { chosenId: chosen.candidate.id, selfJoinedAtMs: selfJoined, opponentJoinedAtMs: opponentJoined } });
    } catch (err) {
      // Rollback: mark game cancelled so frontend won't pick it up as active
      try {
        await writeDocument(env, 'games', gameId, { ...{ status: 'cancelled', cancelledReason: 'queue_update_failed', cancelledAt: new Date().toISOString() } });
      } catch (e) {
        // ignore
      }
      return corsResponse({ ok: true, gameId: null, debug: { reason: 'queue_update_failed', error: err?.message } });
    }
  }

  return errorResponse('Unknown matchmaking action.', 400);
}

async function finalizeMatchCleanup(env, game) {
  if (!game) return;
  const mode = normalizeMode(game.mode);
  const queueCollection = matchmakingCollection(mode);
  const uids = [game.player1uid, game.player2uid].filter(Boolean);
  await Promise.all(uids.map(async (uid) => {
    try { await deleteDocument(env, queueCollection, uid); } catch (_) {}
    try { await setPlayerState(env, uid, 'idle'); } catch (_) {}
  }));
}

async function handleGameValidate(env, authUser, body) {
  const gameId = String(body.gameId || '');
  if (!gameId) return errorResponse('gameId is required.', 400);
  const game = await getDocument(env, 'games', gameId);
  if (!game) return corsResponse({ ok: true, valid: false });
  const current = game.data;
  const isParticipant = current.player1uid === authUser.uid || current.player2uid === authUser.uid;
  const active = current.status === 'active';
  return corsResponse({ ok: true, valid: Boolean(isParticipant && active) });
}

async function handleGameAction(env, authUser, body) {
  const action = String(body.action || '');
  const gameId = String(body.gameId || '');
  if (!gameId) return errorResponse('gameId is required.', 400);

  if (action === 'join') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can join.', 403);
    }
    // Set player state to playing
    await setPlayerState(env, authUser.uid, 'playing');
    return corsResponse({ ok: true });
  }

  if (action === 'move') {
    const row = Number(body.row);
    const col = Number(body.col);
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can play.', 403);
    }

    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    if (current.currentPlayer !== playerNumber) return errorResponse('Not your turn.', 412);

    const size = Number(current.gridSize) || 6;
    const state = normalizeGameState(current.gameStateJSON, size);
    const history = current.placementHistory || { p1: [], p2: [] };

    if (current.phase === 'place') {
      if (!isValidPlacement(state, size, row, col)) {
        return errorResponse('Invalid placement.', 400);
      }
      const nextState = applyPlace(state, playerNumber, row, col);
      const nextHistory = {
        p1: historyToArray(history.p1),
        p2: historyToArray(history.p2)
      };
      nextHistory[`p${playerNumber}`].push({ r: row, c: col });
      await writeDocument(env, 'games', gameId, {
        ...current,
        phase: 'eliminate',
        lastPlaces: { row, col },
        gameStateJSON: JSON.stringify(nextState),
        placementHistory: nextHistory,
        timeouts: { ...(current.timeouts || { p1: 0, p2: 0 }), [`p${playerNumber}`]: 0 }
      });
      return corsResponse({ ok: true });
    }

    if (current.phase === 'eliminate') {
      if (!isValidElimination(state, current.lastPlaces, row, col)) {
        return errorResponse('Invalid elimination.', 400);
      }
      const nextState = applyEliminate(state, row, col);
      const nextHistory = {
        p1: historyToArray(history.p1),
        p2: historyToArray(history.p2)
      };
      const result = computeGameResult(nextState, size);
      const update = {
        ...current,
        gameStateJSON: JSON.stringify(nextState),
        placementHistory: nextHistory,
        lastPlaces: null
      };
      if (result) {
        update.status = 'finished';
        update.result = result;
      } else {
        update.currentPlayer = playerNumber === 1 ? 2 : 1;
        update.phase = 'place';
      }
      await writeDocument(env, 'games', gameId, update);
      if (result) await finalizeMatchCleanup(env, update);
      return corsResponse({ ok: true });
    }

    return errorResponse('Invalid game phase.', 412);
  }

  if (action === 'timeout') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can time out.', 403);
    }
    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    if (current.currentPlayer !== playerNumber) return errorResponse('Not your turn.', 412);

    const size = Number(current.gridSize) || 6;
    const state = normalizeGameState(current.gameStateJSON, size);
    const timeouts = current.timeouts || { p1: 0, p2: 0 };
    const myKey = `p${playerNumber}`;
    const isFullSkip = current.phase === 'place';
    const newCount = isFullSkip ? (timeouts[myKey] || 0) + 1 : timeouts[myKey] || 0;

    if (newCount >= 3) {
      const s1 = getBiggestGroup(state, size, 1);
      const s2 = getBiggestGroup(state, size, 2);
      const winner = playerNumber === 1 ? 2 : 1;
      const finishedGame = {
        ...current,
        status: 'finished',
        result: { winner, score1: s1, score2: s2, timeout: true, loser: playerNumber },
        timeouts: { ...timeouts, [myKey]: newCount }
      };
      await writeDocument(env, 'games', gameId, finishedGame);
      await finalizeMatchCleanup(env, finishedGame);
      return corsResponse({ ok: true });
    }

    await writeDocument(env, 'games', gameId, {
      ...current,
      currentPlayer: playerNumber === 1 ? 2 : 1,
      phase: 'place',
      lastPlaces: null,
      timeouts: { ...timeouts, [myKey]: newCount }
    });
    return corsResponse({ ok: true });
  }

  if (action === 'leave') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return corsResponse({ ok: true });
    const current = game.data;
    if (current.status !== 'active') return corsResponse({ ok: true });
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can leave.', 403);
    }

    if (current.mode === 'ranked') {
      const opponentUid = authUser.uid === current.player1uid ? current.player2uid : current.player1uid;
      const [myProfileDoc, oppProfileDoc] = await Promise.all([
        getDocument(env, 'players', authUser.uid),
        getDocument(env, 'players', opponentUid)
      ]);
      const myProfile = normalizeSkillProfile(myProfileDoc?.data || {});
      const oppProfile = normalizeSkillProfile(oppProfileDoc?.data || {});
      const scoreP1 = authUser.uid === current.player1uid ? 0 : 1;
      const { profile1, profile2 } = computeSkillDelta(myProfile, oppProfile, scoreP1);
      const myNextProfile = authUser.uid === current.player1uid ? profile1 : profile2;
      await writeDocument(env, 'players', authUser.uid, {
        ...(myProfileDoc?.data || {}),
        mu: myNextProfile.mu,
        sigma: myNextProfile.sigma,
        rating: myNextProfile.rating,
        games: Number((myProfileDoc?.data || {}).games || 0) + 1,
        losses: Number((myProfileDoc?.data || {}).losses || 0) + 1,
        updatedAt: new Date().toISOString()
      }, myProfileDoc?.updateTime);
    }

    const leftGame = {
      ...current,
      status: 'left',
      leftBy: authUser.uid
    };
    await writeDocument(env, 'games', gameId, leftGame);
    await finalizeMatchCleanup(env, leftGame);
    return corsResponse({ ok: true });
  }

  return errorResponse('Unknown game action.', 400);
}

async function handleRankedFinalize(env, authUser, body) {
  const gameId = String(body.gameId || '');
  if (!gameId) return errorResponse('gameId is required.', 400);

  const game = await getDocument(env, 'games', gameId);
  if (!game) return errorResponse('Game not found.', 404);
  const current = game.data;
  if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
    return errorResponse('Only participants can finalize game result.', 403);
  }
  if (current.mode !== 'ranked') return errorResponse('Only ranked games are finalized here.', 412);
  if (current.status !== 'finished' || !current.result) return errorResponse('Game is not finished.', 412);

  if (current.result.delta1 != null && current.result.delta2 != null) {
    return corsResponse({ ok: true, result: current.result });
  }

  const [p1Doc, p2Doc] = await Promise.all([
    getDocument(env, 'players', current.player1uid),
    getDocument(env, 'players', current.player2uid)
  ]);
  const p1Raw = p1Doc?.data || {};
  const p2Raw = p2Doc?.data || {};
  const p1 = normalizeSkillProfile(p1Raw);
  const p2 = normalizeSkillProfile(p2Raw);
  const scoreP1 = current.result.winner === 1 ? 1 : current.result.winner === 2 ? 0 : 0.5;
  const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);

  await writeDocument(env, 'players', current.player1uid, {
    ...p1Raw,
    displayName: p1Raw.displayName || current.player1name,
    email: p1Raw.email || '',
    mu: profile1.mu,
    sigma: profile1.sigma,
    rating: newR1,
    games: Number(p1Raw.games || 0) + 1,
    wins: scoreP1 === 1 ? Number(p1Raw.wins || 0) + 1 : Number(p1Raw.wins || 0),
    losses: scoreP1 === 0 ? Number(p1Raw.losses || 0) + 1 : Number(p1Raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(p1Raw.draws || 0) + 1 : Number(p1Raw.draws || 0),
    updatedAt: new Date().toISOString()
  });

  await writeDocument(env, 'players', current.player2uid, {
    ...p2Raw,
    displayName: p2Raw.displayName || current.player2name,
    email: p2Raw.email || '',
    mu: profile2.mu,
    sigma: profile2.sigma,
    rating: newR2,
    games: Number(p2Raw.games || 0) + 1,
    wins: scoreP1 === 0 ? Number(p2Raw.wins || 0) + 1 : Number(p2Raw.wins || 0),
    losses: scoreP1 === 1 ? Number(p2Raw.losses || 0) + 1 : Number(p2Raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(p2Raw.draws || 0) + 1 : Number(p2Raw.draws || 0),
    updatedAt: new Date().toISOString()
  });

  const result = {
    ...current.result,
    delta1,
    delta2,
    newR1,
    newR2
  };
  await writeDocument(env, 'games', gameId, {
    ...current,
    result
  });

  // Set both players back to idle after game finalized
  await setPlayerState(env, current.player1uid, 'idle');
  await setPlayerState(env, current.player2uid, 'idle');

  return corsResponse({ ok: true, result });
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const url = new URL(request.url);
  const authUser = await verifyFirebaseIdToken(request, env);
  const body = await getRequestJson(request);

  if (url.pathname === '/profile/ensure') {
    return handleProfileEnsure(env, authUser);
  }
  if (url.pathname === '/game/validate') {
    return handleGameValidate(env, authUser, body);
  }
  if (url.pathname === '/profile/state') {
    const player = await getDocument(env, 'players', authUser.uid);
    const state = player?.data?.state || 'idle';
    return corsResponse({ state, playerExists: !!player });
  }
  if (url.pathname === '/room/create' || url.pathname === '/room/join' || url.pathname === '/room/cancel') {
    const action = url.pathname.split('/').pop();
    return handleRoomAction(env, authUser, { ...body, action });
  }
  if (
    url.pathname === '/matchmaking/enqueue' ||
    url.pathname === '/matchmaking/run' ||
    url.pathname === '/matchmaking/cancel' ||
    url.pathname === '/matchmaking/heartbeat'
  ) {
    const action = url.pathname.split('/').pop();
    return handleMatchmakingAction(env, authUser, { ...body, action });
  }
  if (url.pathname === '/game/move' || url.pathname === '/game/timeout' || url.pathname === '/game/leave' || url.pathname === '/game/join') {
    const action = url.pathname.split('/').pop();
    return handleGameAction(env, authUser, { ...body, action });
  }
  if (url.pathname === '/ranked/finalize') {
    return handleRankedFinalize(env, authUser, body);
  }

  return errorResponse('Not found.', 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return errorResponse(error?.message || 'Internal server error.', 500);
    }
  }
};
