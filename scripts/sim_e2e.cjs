#!/usr/bin/env node
// End-to-end simulation of matchmaking + game flow against live Firestore.
// Mirrors the deployed worker (worker/src/index.js) semantics:
//   - split queue collections matchmakingQueue_casual / _ranked
//   - players.state machine (idle/searching/playing/idle)
//   - game state machine: place -> eliminate -> next turn -> finished
//   - lower-UID deterministic pairing
//   - rating-band widening for ranked
//   - gridSize+timer compatibility filter for casual
//
// Usage: node scripts/sim_e2e.cjs [/path/to/serviceAccount.json]
//
// All synthetic docs are tagged uid prefix "simE2E_" and removed in the
// `finally` block, even if a step fails.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIM_PREFIX = 'simE2E_';
const QUEUE_CASUAL = 'matchmakingQueue_casual';
const QUEUE_RANKED = 'matchmakingQueue_ranked';
const PLAYERS = 'players';
const GAMES = 'games';

const RANKED_BAND_INITIAL = 100;
const RANKED_BAND_STEP = 100;
const RANKED_BAND_INTERVAL_MS = 5 * 1000;
const RANKED_BAND_MAX = 800;
const STALE_MS_BY_MODE = { ranked: 25_000, casual: 30_000 };
const DEFAULT_DISPLAY_RATING = 1000;
const DEFAULT_MU = 1500;
const DEFAULT_SIGMA = 500;

let pass = 0, fail = 0;
const trackedDocs = []; // { collection, id }

function track(collection, id) { trackedDocs.push({ collection, id }); }

function assert(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function header(name) { console.log(`\n── ${name} ──`); }

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

// ─── Firestore REST helpers ───
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) fields[k] = fsValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fsFieldsFromObject(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = fsValue(v);
  }
  return fields;
}

function fsValueToJs(value) {
  if (value == null) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map(fsValueToJs);
  }
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue?.fields || {})) out[k] = fsValueToJs(v);
    return out;
  }
  return null;
}

function fieldsToJs(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fsValueToJs(v);
  return out;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    sub: sa.client_email
  };
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const sig = sign.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const assertion = `${signingInput}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
  });
  if (!res.ok) throw new Error(`Failed to get access token: ${await res.text()}`);
  return (await res.json()).access_token;
}

function makeFs(projectId, token) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function getDoc(collection, id) {
    const r = await fetch(`${baseUrl}/${collection}/${id}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`get ${collection}/${id} -> ${r.status}: ${await r.text()}`);
    const body = await r.json();
    return { name: body.name, updateTime: body.updateTime, data: fieldsToJs(body.fields || {}) };
  }
  async function setDoc(collection, id, data) {
    const r = await fetch(`${baseUrl}/${collection}/${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ fields: fsFieldsFromObject(data) })
    });
    if (!r.ok) throw new Error(`set ${collection}/${id} -> ${r.status}: ${await r.text()}`);
    return await r.json();
  }
  async function deleteDoc(collection, id) {
    const r = await fetch(`${baseUrl}/${collection}/${id}`, { method: 'DELETE', headers });
    if (!r.ok && r.status !== 404) throw new Error(`del ${collection}/${id} -> ${r.status}: ${await r.text()}`);
    return { ok: true };
  }
  async function runQuery(structuredQuery) {
    const r = await fetch(`${baseUrl}:runQuery`, {
      method: 'POST', headers, body: JSON.stringify({ structuredQuery })
    });
    if (!r.ok) throw new Error(`runQuery -> ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    return rows.map(row => row.document).filter(Boolean).map(doc => ({
      id: doc.name.split('/').pop(),
      updateTime: doc.updateTime,
      data: fieldsToJs(doc.fields || {})
    }));
  }
  return { getDoc, setDoc, deleteDoc, runQuery };
}

// ─── Game logic helpers (mirror worker) ───
function createInitialState(size) {
  const state = [];
  for (let i = 0; i < size; i++) {
    const row = [];
    for (let j = 0; j < size; j++) row.push({ player: null, eliminated: false });
    state.push(row);
  }
  return state;
}
function deepCopyState(s) { return s.map(r => r.map(c => ({ ...c }))); }
function hasAdjacentFree(state, size, row, col) {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    if (i === 0 && j === 0) continue;
    const r = row + i, c = col + j;
    if (r < 0 || r >= size || c < 0 || c >= size) continue;
    const cell = state[r][c];
    if (cell.player === null && !cell.eliminated) return true;
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
  const next = deepCopyState(state);
  next[row][col].player = player;
  return next;
}
function applyEliminate(state, row, col) {
  const next = deepCopyState(state);
  next[row][col].eliminated = true;
  return next;
}
function dfs(state, size, r, c, player, visited) {
  if (r < 0 || r >= size || c < 0 || c >= size) return 0;
  if (visited[r][c]) return 0;
  if (state[r][c].player !== player) return 0;
  visited[r][c] = true;
  let count = 1;
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    count += dfs(state, size, r + dr, c + dc, player, visited);
  }
  return count;
}
function biggestGroup(state, size, player) {
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  let best = 0;
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    if (state[i][j].player === player && !visited[i][j]) {
      best = Math.max(best, dfs(state, size, i, j, player, visited));
    }
  }
  return best;
}
function hasAnyValidMove(state, size) {
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    if (state[i][j].player === null && !state[i][j].eliminated && hasAdjacentFree(state, size, i, j)) return true;
  }
  return false;
}
function computeGameResult(state, size) {
  if (hasAnyValidMove(state, size)) return null;
  const score1 = biggestGroup(state, size, 1);
  const score2 = biggestGroup(state, size, 2);
  return { winner: score1 === score2 ? 0 : score1 > score2 ? 1 : 2, score1, score2 };
}

// ─── Matchmaker (mirrors worker handleMatchmakingAction 'run') ───
function ratingBandForMode(mode, waitMs) {
  if (mode !== 'ranked') return Number.POSITIVE_INFINITY;
  const intervals = Math.floor(Math.max(0, waitMs) / RANKED_BAND_INTERVAL_MS);
  return Math.min(RANKED_BAND_MAX, RANKED_BAND_INITIAL + RANKED_BAND_STEP * intervals);
}

async function tryMatch(fs, uid, mode) {
  const queueCollection = mode === 'ranked' ? QUEUE_RANKED : QUEUE_CASUAL;
  const self = await fs.getDoc(queueCollection, uid);
  if (!self || self.data.status !== 'searching') return null;

  const filters = [
    { fieldFilter: { field: { fieldPath: 'mode' }, op: 'EQUAL', value: { stringValue: mode } } },
    { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'searching' } } }
  ];
  if (mode === 'casual') {
    filters.push({ fieldFilter: { field: { fieldPath: 'gridSize' }, op: 'EQUAL', value: { integerValue: String(self.data.gridSize) } } });
    filters.push({ fieldFilter: { field: { fieldPath: 'timerEnabled' }, op: 'EQUAL', value: { booleanValue: !!self.data.timerEnabled } } });
  }
  const candidates = await fs.runQuery({
    from: [{ collectionId: queueCollection }],
    where: { compositeFilter: { op: 'AND', filters } }
  });

  const others = candidates.filter(e => e.id !== uid);
  if (!others.length) return null;

  const now = Date.now();
  const selfRating = Number(self.data.rating || DEFAULT_DISPLAY_RATING);
  const selfJoinedAt = Number(self.data.joinedAtMs) || now;
  const selfBand = ratingBandForMode(mode, now - selfJoinedAt);

  const live = [];
  for (const e of others) {
    const updatedAt = Number(e.data.updatedAtMs || e.data.joinedAtMs || 0);
    const ttl = STALE_MS_BY_MODE[mode] || STALE_MS_BY_MODE.casual;
    if (now - updatedAt > ttl) continue;
    if (e.data.status !== 'searching' || e.data.matchedWith || e.data.gameId) continue;
    const cRating = Number(e.data.rating || DEFAULT_DISPLAY_RATING);
    const cJoined = Number(e.data.joinedAtMs) || now;
    const cBand = ratingBandForMode(mode, now - cJoined);
    if (Math.abs(cRating - selfRating) > Math.min(selfBand, cBand)) continue;
    live.push(e);
  }
  if (!live.length) return null;

  live.sort((a, b) => {
    const da = Math.abs(Number(a.data.rating || DEFAULT_DISPLAY_RATING) - selfRating);
    const db = Math.abs(Number(b.data.rating || DEFAULT_DISPLAY_RATING) - selfRating);
    if (da !== db) return da - db;
    return (Number(a.data.joinedAtMs) || 0) - (Number(b.data.joinedAtMs) || 0);
  });
  const chosen = live[0];

  // Lower-UID rule
  if (uid >= chosen.id) return { deferredToLowerUid: chosen.id };

  const selfJoined = Number(self.data.joinedAtMs) || 0;
  const oppJoined = Number(chosen.data.joinedAtMs) || 0;
  const selfIsP1 = selfJoined < oppJoined || (selfJoined === oppJoined && uid < chosen.id);
  const p1Data = selfIsP1 ? self.data : chosen.data;
  const p2Data = selfIsP1 ? chosen.data : self.data;
  const p1Uid = selfIsP1 ? uid : chosen.id;
  const p2Uid = selfIsP1 ? chosen.id : uid;

  const gameId = `game_${crypto.randomUUID().slice(0, 8).toUpperCase()}_SIM`;
  await fs.setDoc(GAMES, gameId, {
    gameCode: null,
    mode,
    source: 'matchmaking',
    status: 'active',
    player1uid: p1Uid,
    player1name: p1Data.displayName || 'Player',
    player2uid: p2Uid,
    player2name: p2Data.displayName || 'Player',
    gridSize: mode === 'ranked' ? 8 : Number(self.data.gridSize) || 6,
    timerEnabled: mode === 'ranked' ? true : !!self.data.timerEnabled,
    currentPlayer: 1,
    phase: 'place',
    lastPlaces: null,
    gameStateJSON: null,
    placementHistory: { p1: [], p2: [] },
    timeouts: { p1: 0, p2: 0 },
    result: null,
    createdAt: new Date().toISOString()
  });
  track(GAMES, gameId);

  await fs.setDoc(queueCollection, uid, {
    ...self.data, status: 'matched', gameId, matchedWith: chosen.id,
    matchedAt: new Date().toISOString(), updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
  });
  await fs.setDoc(queueCollection, chosen.id, {
    ...chosen.data, status: 'matched', gameId, matchedWith: uid,
    matchedAt: new Date().toISOString(), updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
  });
  await setPlayerState(fs, uid, 'playing');
  await setPlayerState(fs, chosen.id, 'playing');
  return { gameId, p1Uid, p2Uid };
}

// ─── Helpers to set up synthetic players ───
async function setPlayerState(fs, uid, state) {
  const existing = await fs.getDoc(PLAYERS, uid);
  const data = existing?.data || {};
  await fs.setDoc(PLAYERS, uid, { ...data, state, updatedAt: new Date().toISOString() });
}

async function ensureSimPlayer(fs, uid, displayName, rating = DEFAULT_DISPLAY_RATING) {
  await fs.setDoc(PLAYERS, uid, {
    displayName,
    email: `${uid}@gmail.com`,
    mu: DEFAULT_MU,
    sigma: DEFAULT_SIGMA,
    rating,
    games: 0, wins: 0, losses: 0, draws: 0,
    state: 'idle',
    updatedAt: new Date().toISOString()
  });
  track(PLAYERS, uid);
}

async function enqueue(fs, uid, mode, { gridSize = 6, timerEnabled = false, rating = DEFAULT_DISPLAY_RATING } = {}) {
  const queueCollection = mode === 'ranked' ? QUEUE_RANKED : QUEUE_CASUAL;
  const now = Date.now();
  await fs.setDoc(queueCollection, uid, {
    uid, mode, status: 'searching',
    displayName: `Sim ${uid.slice(-4)}`,
    email: `${uid}@gmail.com`,
    gridSize: mode === 'ranked' ? 8 : gridSize,
    timerEnabled: mode === 'ranked' ? true : !!timerEnabled,
    mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, rating,
    gameId: null, matchedWith: null,
    queueToken: crypto.randomUUID(),
    joinedAtMs: now, updatedAtMs: now,
    joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  track(queueCollection, uid);
  await setPlayerState(fs, uid, 'searching');
}

// ─── Game-play simulator (drives game to completion) ───
async function playGameToCompletion(fs, gameId, maxTurns = 200) {
  for (let i = 0; i < maxTurns; i++) {
    const game = await fs.getDoc(GAMES, gameId);
    if (!game) throw new Error(`Game ${gameId} not found.`);
    const g = game.data;
    if (g.status !== 'active') return g;

    const size = Number(g.gridSize) || 6;
    let state;
    if (!g.gameStateJSON) state = createInitialState(size);
    else state = JSON.parse(g.gameStateJSON);

    const player = g.currentPlayer;
    const phase = g.phase;
    const history = g.placementHistory || { p1: [], p2: [] };

    if (phase === 'place') {
      // Find first valid placement.
      let placed = null;
      outer: for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (isValidPlacement(state, size, r, c)) { placed = { r, c }; break outer; }
        }
      }
      if (!placed) {
        // No valid placements — game should have been finished. Close out.
        const result = computeGameResult(state, size);
        await fs.setDoc(GAMES, gameId, { ...g, status: 'finished', result: result || { winner: 0, score1: 0, score2: 0 } });
        return { ...g, status: 'finished', result };
      }
      const next = applyPlace(state, player, placed.r, placed.c);
      const nextHistory = { p1: [...(history.p1 || [])], p2: [...(history.p2 || [])] };
      nextHistory[`p${player}`].push({ r: placed.r, c: placed.c });
      await fs.setDoc(GAMES, gameId, {
        ...g,
        phase: 'eliminate',
        lastPlaces: { row: placed.r, col: placed.c },
        gameStateJSON: JSON.stringify(next),
        placementHistory: nextHistory,
        timeouts: { ...(g.timeouts || { p1: 0, p2: 0 }), [`p${player}`]: 0 }
      });
      continue;
    }

    if (phase === 'eliminate') {
      // Find first valid elimination adjacent to lastPlaces.
      const lp = g.lastPlaces;
      let elim = null;
      if (lp) {
        for (let dr = -1; dr <= 1 && !elim; dr++) for (let dc = -1; dc <= 1 && !elim; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = lp.row + dr, c = lp.col + dc;
          if (isValidElimination(state, lp, r, c)) elim = { r, c };
        }
      }
      if (!elim) {
        // No valid elim — board passes turn (treat as no-op; switch player).
        await fs.setDoc(GAMES, gameId, {
          ...g, currentPlayer: player === 1 ? 2 : 1, phase: 'place', lastPlaces: null
        });
        continue;
      }
      const next = applyEliminate(state, elim.r, elim.c);
      const result = computeGameResult(next, size);
      const update = {
        ...g,
        gameStateJSON: JSON.stringify(next),
        lastPlaces: null
      };
      if (result) {
        update.status = 'finished';
        update.result = result;
      } else {
        update.currentPlayer = player === 1 ? 2 : 1;
        update.phase = 'place';
      }
      await fs.setDoc(GAMES, gameId, update);
      if (result) return update;
      continue;
    }

    throw new Error(`Unexpected phase: ${phase}`);
  }
  throw new Error(`Game did not finish in ${maxTurns} turns`);
}

// ─── Test cases ───
async function testCasualMatch(fs) {
  header('Casual: matchmaker pairs two compatible players, full game runs to finished');
  const a = `${SIM_PREFIX}aa_${Date.now().toString(36).slice(-6)}`;
  const b = `${SIM_PREFIX}bb_${Date.now().toString(36).slice(-6)}`;
  await ensureSimPlayer(fs, a, 'Sim A', 1000);
  await ensureSimPlayer(fs, b, 'Sim B', 1020);
  await enqueue(fs, a, 'casual', { gridSize: 4, timerEnabled: false, rating: 1000 });
  await enqueue(fs, b, 'casual', { gridSize: 4, timerEnabled: false, rating: 1020 });

  // Run from the higher uid first — it should defer
  const higher = a > b ? a : b;
  const lower = a > b ? b : a;
  const deferred = await tryMatch(fs, higher, 'casual');
  assert('higher-UID poll defers', !!deferred?.deferredToLowerUid, JSON.stringify(deferred));

  // Lower uid creates the match
  const matched = await tryMatch(fs, lower, 'casual');
  assert('match created by lower-UID poll', matched && matched.gameId, JSON.stringify(matched));
  if (!matched?.gameId) return;

  // Verify game doc
  const game = await fs.getDoc(GAMES, matched.gameId);
  assert('game doc exists', !!game);
  assert('status active', game?.data?.status === 'active');
  assert('mode casual', game?.data?.mode === 'casual');
  assert('gridSize 4', Number(game?.data?.gridSize) === 4);
  assert('timer disabled', game?.data?.timerEnabled === false);
  assert('source matchmaking', game?.data?.source === 'matchmaking');
  assert('phase place', game?.data?.phase === 'place');
  assert('p1+p2 set', !!game?.data?.player1uid && !!game?.data?.player2uid);

  // Verify both queue entries flipped to matched
  const qA = await fs.getDoc(QUEUE_CASUAL, a);
  const qB = await fs.getDoc(QUEUE_CASUAL, b);
  assert('A queue matched', qA?.data?.status === 'matched' && qA?.data?.gameId === matched.gameId);
  assert('B queue matched', qB?.data?.status === 'matched' && qB?.data?.gameId === matched.gameId);

  // Verify both player.state == 'playing'
  const pA = await fs.getDoc(PLAYERS, a);
  const pB = await fs.getDoc(PLAYERS, b);
  assert('A state playing', pA?.data?.state === 'playing');
  assert('B state playing', pB?.data?.state === 'playing');

  // Drive game to completion
  const final = await playGameToCompletion(fs, matched.gameId);
  assert('game finished', final.status === 'finished');
  assert('result has winner', final.result && (final.result.winner === 0 || final.result.winner === 1 || final.result.winner === 2));
  assert('result has scores', Number.isFinite(final.result?.score1) && Number.isFinite(final.result?.score2));
}

async function testCasualConfigFilter(fs) {
  header('Casual: differing gridSize does NOT match');
  const a = `${SIM_PREFIX}cfA_${Date.now().toString(36).slice(-6)}`;
  const b = `${SIM_PREFIX}cfB_${Date.now().toString(36).slice(-6)}`;
  await ensureSimPlayer(fs, a, 'Cf A');
  await ensureSimPlayer(fs, b, 'Cf B');
  await enqueue(fs, a, 'casual', { gridSize: 4, timerEnabled: false, rating: 1000 });
  await enqueue(fs, b, 'casual', { gridSize: 8, timerEnabled: false, rating: 1000 });

  const lower = a < b ? a : b;
  const result = await tryMatch(fs, lower, 'casual');
  assert('no match when gridSize differs', !result || !result.gameId, JSON.stringify(result));
}

async function testRankedBandRejection(fs) {
  header('Ranked: large rating gap is rejected at t≈0');
  const a = `${SIM_PREFIX}rkA_${Date.now().toString(36).slice(-6)}`;
  const b = `${SIM_PREFIX}rkB_${Date.now().toString(36).slice(-6)}`;
  await ensureSimPlayer(fs, a, 'Rk A', 800);
  await ensureSimPlayer(fs, b, 'Rk B', 1500); // gap 700, initial band 100
  await enqueue(fs, a, 'ranked', { rating: 800 });
  await enqueue(fs, b, 'ranked', { rating: 1500 });

  const lower = a < b ? a : b;
  const result = await tryMatch(fs, lower, 'ranked');
  assert('no immediate ranked match (gap > band)', !result || !result.gameId, JSON.stringify(result));
}

async function testStalePruning(fs) {
  header('Stale: stale opponent (old updatedAtMs) is skipped');
  const a = `${SIM_PREFIX}stA_${Date.now().toString(36).slice(-6)}`;
  const b = `${SIM_PREFIX}stB_${Date.now().toString(36).slice(-6)}`;
  await ensureSimPlayer(fs, a, 'St A');
  await ensureSimPlayer(fs, b, 'St B');
  // a is fresh; b has updatedAtMs > 60s ago (stale)
  await enqueue(fs, a, 'casual', { gridSize: 6, timerEnabled: false });
  await fs.setDoc(QUEUE_CASUAL, b, {
    uid: b, mode: 'casual', status: 'searching',
    displayName: 'Sim St B', email: `${b}@gmail.com`,
    gridSize: 6, timerEnabled: false,
    mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, rating: DEFAULT_DISPLAY_RATING,
    gameId: null, matchedWith: null,
    queueToken: crypto.randomUUID(),
    joinedAtMs: Date.now() - 90_000,
    updatedAtMs: Date.now() - 90_000,
    joinedAt: new Date(Date.now() - 90_000).toISOString(),
    updatedAt: new Date(Date.now() - 90_000).toISOString()
  });
  track(QUEUE_CASUAL, b);
  await setPlayerState(fs, b, 'searching');

  const lower = a < b ? a : b;
  const result = await tryMatch(fs, lower, 'casual');
  assert('no match against stale opponent', !result || !result.gameId, JSON.stringify(result));
}

// ─── Cleanup ───
async function cleanup(fs) {
  console.log('\n── Cleanup ──');
  let removed = 0;
  for (const { collection, id } of trackedDocs) {
    try {
      await fs.deleteDoc(collection, id);
      removed++;
    } catch (e) {
      console.log(`  WARN  failed to delete ${collection}/${id}: ${e.message}`);
    }
  }
  console.log(`  Cleaned up ${removed}/${trackedDocs.length} simulated docs.`);
}

// ─── Main ───
(async () => {
  const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
  if (!fs.existsSync(servicePath)) { console.error('Service account JSON not found:', servicePath); process.exit(1); }
  const sa = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
  const projectId = sa.project_id;
  console.log(`Project: ${projectId}`);
  const token = await getAccessToken(sa);
  const fsApi = makeFs(projectId, token);

  let crashed = null;
  try {
    await testCasualMatch(fsApi);
    await testCasualConfigFilter(fsApi);
    await testRankedBandRejection(fsApi);
    await testStalePruning(fsApi);
  } catch (e) {
    crashed = e;
    console.error('\n!!! Test run crashed:', e?.stack || e);
    fail++;
  } finally {
    await cleanup(fsApi);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Fatal:', e); process.exit(2); });
