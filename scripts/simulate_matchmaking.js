// In-process simulation of the matchmaker algorithm.
// Mirrors the rules implemented in worker/src/index.js for `/matchmaking/run`,
// `/matchmaking/heartbeat`, and the lower-UID deterministic pairing rule.
// Run with: node scripts/simulate_matchmaking.js

const RANKED_BAND_INITIAL = 100;
const RANKED_BAND_STEP = 100;
const RANKED_BAND_INTERVAL_MS = 5 * 1000;
const RANKED_BAND_MAX = 800;
const STALE_MS_BY_MODE = { ranked: 25_000, casual: 30_000 };
const HEARTBEAT_MS = 10_000;
const POLL_MS = 3_000;

function ratingBand(mode, waitMs) {
  if (mode !== 'ranked') return Number.POSITIVE_INFINITY;
  const intervals = Math.floor(Math.max(0, waitMs) / RANKED_BAND_INTERVAL_MS);
  return Math.min(RANKED_BAND_MAX, RANKED_BAND_INITIAL + RANKED_BAND_STEP * intervals);
}

function makeWorld() {
  return {
    now: 0,
    queues: { casual: new Map(), ranked: new Map() },
    games: [],
    log: []
  };
}

function enqueue(world, { uid, mode, gridSize = 6, timerEnabled = false, rating = 1000 }) {
  world.queues[mode].set(uid, {
    uid,
    mode,
    status: 'searching',
    gridSize,
    timerEnabled,
    rating,
    gameId: null,
    matchedWith: null,
    joinedAtMs: world.now,
    updatedAtMs: world.now
  });
}

function heartbeat(world, uid, mode) {
  const entry = world.queues[mode].get(uid);
  if (!entry || entry.status !== 'searching') return;
  entry.updatedAtMs = world.now;
}

function pruneStale(world) {
  for (const mode of ['casual', 'ranked']) {
    const ttl = STALE_MS_BY_MODE[mode];
    for (const [uid, entry] of world.queues[mode]) {
      if (entry.status !== 'searching') continue;
      if (world.now - entry.updatedAtMs > ttl) {
        entry.status = 'stale';
        world.log.push(`t=${world.now}ms ${uid} pruned as stale (${mode})`);
      }
    }
  }
}

function compatibleForCasual(self, other) {
  return self.gridSize === other.gridSize && !!self.timerEnabled === !!other.timerEnabled;
}

// Mirrors worker run handler: returns { gameId } if a match was created, else null.
function runMatchmakerFor(world, uid, mode) {
  pruneStale(world);
  const self = world.queues[mode].get(uid);
  if (!self || self.status !== 'searching') return null;

  const candidates = [];
  for (const [otherUid, entry] of world.queues[mode]) {
    if (otherUid === uid) continue;
    if (entry.status !== 'searching' || entry.gameId || entry.matchedWith) continue;
    if (world.now - entry.updatedAtMs > STALE_MS_BY_MODE[mode]) continue;
    if (mode === 'casual' && !compatibleForCasual(self, entry)) continue;
    const selfBand = ratingBand(mode, world.now - self.joinedAtMs);
    const candBand = ratingBand(mode, world.now - entry.joinedAtMs);
    const allowed = Math.min(selfBand, candBand);
    if (Math.abs(self.rating - entry.rating) > allowed) continue;
    candidates.push(entry);
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.rating - self.rating);
    const dbb = Math.abs(b.rating - self.rating);
    if (da !== dbb) return da - dbb;
    return (a.joinedAtMs - b.joinedAtMs) || a.uid.localeCompare(b.uid);
  });
  const chosen = candidates[0];

  // Lower-UID rule: only the smaller UID actually creates the match.
  if (uid >= chosen.uid) return null;

  const gameId = `game_${world.games.length + 1}`;
  self.status = 'matched';
  self.gameId = gameId;
  self.matchedWith = chosen.uid;
  chosen.status = 'matched';
  chosen.gameId = gameId;
  chosen.matchedWith = uid;
  world.games.push({
    gameId,
    mode,
    p1: self.joinedAtMs <= chosen.joinedAtMs ? uid : chosen.uid,
    p2: self.joinedAtMs <= chosen.joinedAtMs ? chosen.uid : uid,
    gridSize: self.gridSize,
    timerEnabled: !!self.timerEnabled,
    createdAtMs: world.now
  });
  world.log.push(`t=${world.now}ms MATCH ${gameId} ${uid}↔${chosen.uid} (${mode})`);
  return { gameId };
}

// Advance time and run polling/heartbeat events for active players.
function simulate(world, totalMs, options = {}) {
  const polledByMode = options.polledByMode || { casual: new Set(), ranked: new Set() };
  const heartbeatsBy = options.heartbeatsBy || { casual: new Set(), ranked: new Set() };
  let lastPoll = world.now;
  let lastBeat = world.now;
  const end = world.now + totalMs;
  while (world.now < end) {
    const next = Math.min(end, lastPoll + POLL_MS, lastBeat + HEARTBEAT_MS);
    world.now = next;
    if (next === lastPoll + POLL_MS) {
      lastPoll = next;
      for (const mode of ['casual', 'ranked']) {
        // Each polling player calls /matchmaking/run.
        for (const uid of polledByMode[mode]) {
          runMatchmakerFor(world, uid, mode);
        }
      }
    }
    if (next === lastBeat + HEARTBEAT_MS) {
      lastBeat = next;
      for (const mode of ['casual', 'ranked']) {
        for (const uid of heartbeatsBy[mode]) {
          heartbeat(world, uid, mode);
        }
      }
    }
  }
}

// ────────────── Test harness ──────────────
let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function header(name) {
  console.log(`\n── ${name} ──`);
}

// 1. Casual: only same-config players match.
function testCasualConfigFilter() {
  header('Casual: gridSize + timerEnabled compatibility filter');
  const w = makeWorld();
  enqueue(w, { uid: 'A', mode: 'casual', gridSize: 6, timerEnabled: false, rating: 1000 });
  enqueue(w, { uid: 'B', mode: 'casual', gridSize: 8, timerEnabled: false, rating: 1000 });
  enqueue(w, { uid: 'C', mode: 'casual', gridSize: 6, timerEnabled: true, rating: 1000 });
  enqueue(w, { uid: 'D', mode: 'casual', gridSize: 6, timerEnabled: false, rating: 1000 });
  // Everyone polls.
  simulate(w, 5_000, {
    polledByMode: { casual: new Set(['A', 'B', 'C', 'D']), ranked: new Set() },
    heartbeatsBy: { casual: new Set(['A', 'B', 'C', 'D']), ranked: new Set() }
  });
  assert('exactly one game created', w.games.length === 1, JSON.stringify(w.games));
  if (w.games[0]) {
    const pair = new Set([w.games[0].p1, w.games[0].p2]);
    assert('matched pair is A & D (only same gridSize+timer)', pair.has('A') && pair.has('D'), [...pair].join(','));
    assert('B remains searching (different gridSize)', w.queues.casual.get('B').status === 'searching');
    assert('C remains searching (different timer flag)', w.queues.casual.get('C').status === 'searching');
  }
}

// 2. Ranked: rating band rejects huge gap initially, allows it after waiting.
function testRankedBandWidens() {
  header('Ranked: rating-band widening over time');
  const w = makeWorld();
  enqueue(w, { uid: 'lowA', mode: 'ranked', gridSize: 8, timerEnabled: true, rating: 800 });
  enqueue(w, { uid: 'highB', mode: 'ranked', gridSize: 8, timerEnabled: true, rating: 1300 });
  // Both heartbeat & poll.
  const opts = {
    polledByMode: { casual: new Set(), ranked: new Set(['lowA', 'highB']) },
    heartbeatsBy: { casual: new Set(), ranked: new Set(['lowA', 'highB']) }
  };
  // After ~3s, both bands are still 100; gap is 500 — should NOT match.
  simulate(w, 3_500, opts);
  assert('no early match while band < gap', w.games.length === 0, JSON.stringify(w.games));
  // After ~12s (band ≈ 200 each → min 200 — still no match)
  simulate(w, 8_500, opts);
  assert('still no match at ~12s (band 200, gap 500)', w.games.length === 0);
  // After ~25s total (band ≈ 500 — match should now be allowed)
  simulate(w, 13_500, opts);
  assert('match created once band ≥ gap', w.games.length === 1, JSON.stringify(w.games));
}

// 3. Lower-UID determinism: both poll, only one game created.
function testLowerUidDeterminism() {
  header('Lower-UID rule: no duplicate games when both poll');
  const w = makeWorld();
  enqueue(w, { uid: 'aaaa', mode: 'casual', rating: 1000 });
  enqueue(w, { uid: 'zzzz', mode: 'casual', rating: 1000 });
  // Both poll on the same tick repeatedly.
  simulate(w, 6_000, {
    polledByMode: { casual: new Set(['aaaa', 'zzzz']), ranked: new Set() },
    heartbeatsBy: { casual: new Set(['aaaa', 'zzzz']), ranked: new Set() }
  });
  assert('exactly one game even though both polled', w.games.length === 1, JSON.stringify(w.games));
  if (w.games[0]) {
    assert('p1 by joinedAtMs (both joined at t=0; tiebreak by uid)', w.games[0].p1 === 'aaaa');
  }
}

// 4. Stale TTL: a player who stops heartbeating expires; survivors don't match into a ghost.
function testStaleEviction() {
  header('Stale TTL: non-heartbeating entries expire and are skipped');
  const w = makeWorld();
  enqueue(w, { uid: 'live', mode: 'casual', rating: 1000 });
  enqueue(w, { uid: 'dead', mode: 'casual', rating: 1000 });
  // Only `live` heartbeats. `dead` never calls heartbeat, so updatedAtMs stays at t=0.
  simulate(w, 35_000, {
    polledByMode: { casual: new Set(['live']), ranked: new Set() },
    heartbeatsBy: { casual: new Set(['live']), ranked: new Set() }
  });
  assert('dead entry pruned to stale', w.queues.casual.get('dead').status === 'stale');
  assert('no game created with stale opponent', w.games.length === 0, JSON.stringify(w.games));
  assert('live entry still searching', w.queues.casual.get('live').status === 'searching');
}

// 5. Heartbeat keeps a long waiter alive past the old 90s TTL window.
function testHeartbeatKeepsAlive() {
  header('Heartbeat: keeps a long waiter alive past 30s TTL');
  const w = makeWorld();
  enqueue(w, { uid: 'patient', mode: 'casual', rating: 1000 });
  simulate(w, 120_000, {
    polledByMode: { casual: new Set(['patient']), ranked: new Set() },
    heartbeatsBy: { casual: new Set(['patient']), ranked: new Set() }
  });
  assert('patient still searching after 120s with heartbeat', w.queues.casual.get('patient').status === 'searching');
}

// 6. Ranked band caps at 800.
function testRankedBandCap() {
  header('Ranked: band caps at ±800');
  const w = makeWorld();
  enqueue(w, { uid: 'aa', mode: 'ranked', gridSize: 8, timerEnabled: true, rating: 600 });
  enqueue(w, { uid: 'zz', mode: 'ranked', gridSize: 8, timerEnabled: true, rating: 2200 }); // gap 1600
  simulate(w, 120_000, {
    polledByMode: { casual: new Set(), ranked: new Set(['aa', 'zz']) },
    heartbeatsBy: { casual: new Set(), ranked: new Set(['aa', 'zz']) }
  });
  assert('no match — gap exceeds max band', w.games.length === 0, JSON.stringify(w.games));
  assert('both still searching', w.queues.ranked.get('aa').status === 'searching' && w.queues.ranked.get('zz').status === 'searching');
}

// 7. Three players: ensure two pair, the leftover keeps searching.
function testThreePlayersOnePairs() {
  header('Three casual players (compat): one pair, one stays in queue');
  const w = makeWorld();
  enqueue(w, { uid: 'p1', mode: 'casual', rating: 1000 });
  enqueue(w, { uid: 'p2', mode: 'casual', rating: 1000 });
  enqueue(w, { uid: 'p3', mode: 'casual', rating: 1000 });
  simulate(w, 5_000, {
    polledByMode: { casual: new Set(['p1', 'p2', 'p3']), ranked: new Set() },
    heartbeatsBy: { casual: new Set(['p1', 'p2', 'p3']), ranked: new Set() }
  });
  assert('exactly one game from three players', w.games.length === 1, JSON.stringify(w.games));
  const matchedSet = new Set([w.games[0]?.p1, w.games[0]?.p2]);
  const leftovers = ['p1','p2','p3'].filter(p => !matchedSet.has(p));
  assert('one player remains searching', leftovers.length === 1 && w.queues.casual.get(leftovers[0]).status === 'searching');
}

testCasualConfigFilter();
testRankedBandWidens();
testLowerUidDeterminism();
testStaleEviction();
testHeartbeatKeepsAlive();
testRankedBandCap();
testThreePlayersOnePairs();

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
