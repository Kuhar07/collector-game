// Pure game logic ported from legacy script.js — no DOM, no side effects.

export const DEFAULT_FIDE_RATING = 1200;
export const ELO_K_FACTOR = 32;
export const LOCAL_TURN_TIME = 30;
export const LOCAL_MAX_TIMEOUTS = 3;

export function createInitialState(size) {
  const state = [];
  for (let i = 0; i < size; i++) {
    const row = [];
    for (let j = 0; j < size; j++) row.push({ player: null, eliminated: false });
    state.push(row);
  }
  return state;
}

export function deepCopyState(gs) {
  return gs.map((row) => row.map((cell) => ({ ...cell })));
}

export function hasAdjacentFree(state, size, row, col) {
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
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

export function isValidPlacement(state, size, row, col) {
  const cell = state[row][col];
  if (cell.player !== null || cell.eliminated) return false;
  return hasAdjacentFree(state, size, row, col);
}

export function isValidElimination(state, lastPlaces, row, col) {
  if (!lastPlaces) return false;
  const cell = state[row][col];
  if (cell.player !== null || cell.eliminated) return false;
  const dr = Math.abs(row - lastPlaces.row);
  const dc = Math.abs(col - lastPlaces.col);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return false;
  return true;
}

export function applyPlace(state, player, row, col) {
  const ns = deepCopyState(state);
  ns[row][col].player = player;
  return ns;
}

export function applyEliminate(state, row, col) {
  const ns = deepCopyState(state);
  ns[row][col].eliminated = true;
  return ns;
}

function dfs(state, size, r, c, player, visited) {
  if (r < 0 || r >= size || c < 0 || c >= size) return 0;
  if (visited[r][c]) return 0;
  if (state[r][c].player !== player) return 0;
  visited[r][c] = true;
  let n = 1;
  for (const [dr, dc] of [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ]) {
    n += dfs(state, size, r + dr, c + dc, player, visited);
  }
  return n;
}

export function getBiggestGroup(state, size, player) {
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  let best = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (state[i][j].player === player && !visited[i][j]) {
        best = Math.max(best, dfs(state, size, i, j, player, visited));
      }
    }
  }
  return best;
}

export function hasAnyValidMove(state, size) {
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (state[i][j].player === null && !state[i][j].eliminated) {
        if (hasAdjacentFree(state, size, i, j)) return true;
      }
    }
  }
  return false;
}

export function computeGameResult(state, size) {
  if (hasAnyValidMove(state, size)) return null;
  const s1 = getBiggestGroup(state, size, 1);
  const s2 = getBiggestGroup(state, size, 2);
  return {
    winner: s1 === s2 ? 0 : s1 > s2 ? 1 : 2,
    score1: s1,
    score2: s2
  };
}

export function getExpectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function computeEloDelta(r1, r2, scoreP1) {
  const expected = getExpectedScore(r1, r2);
  const delta1 = Math.round(ELO_K_FACTOR * (scoreP1 - expected));
  const delta2 = -delta1;
  return {
    delta1,
    delta2,
    newR1: Math.max(100, r1 + delta1),
    newR2: Math.max(100, r2 + delta2)
  };
}

export function formatDelta(d) {
  return d >= 0 ? `+${d}` : `${d}`;
}

// ── Connection graph for drawing lines between a player's dots ──────────────
function isOrtho(r1, c1, r2, c2) {
  return (Math.abs(r1 - r2) === 1 && c1 === c2) || (r1 === r2 && Math.abs(c1 - c2) === 1);
}
function isDiag(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) === 1 && Math.abs(c1 - c2) === 1;
}

export function computeConnections(history) {
  const n = history.length;
  if (n < 2) return [];
  const uf = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (uf[x] === x ? x : (uf[x] = find(uf[x])));
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa === pb) return false;
    uf[pa] = pb;
    return true;
  };

  const lines = [];
  for (let i = 1; i < n; i++) {
    const [ri, ci] = history[i];
    let found = false;
    for (let j = i - 1; j >= 0; j--) {
      const [rj, cj] = history[j];
      if (isOrtho(ri, ci, rj, cj)) {
        union(i, j);
        lines.push([i, j]);
        found = true;
        break;
      }
    }
    if (!found) {
      for (let j = i - 1; j >= 0; j--) {
        const [rj, cj] = history[j];
        if (isDiag(ri, ci, rj, cj)) {
          union(i, j);
          lines.push([i, j]);
          break;
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || find(i) === find(j)) continue;
        const [ri, ci] = history[i];
        const [rj, cj] = history[j];
        if (isOrtho(ri, ci, rj, cj)) {
          union(i, j);
          lines.push([i, j]);
          changed = true;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || find(i) === find(j)) continue;
        const [ri, ci] = history[i];
        const [rj, cj] = history[j];
        if (isDiag(ri, ci, rj, cj)) {
          union(i, j);
          lines.push([i, j]);
          changed = true;
        }
      }
    }
  }

  const drawn = new Set();
  const out = [];
  for (const [i, j] of lines) {
    const key = Math.min(i, j) + ',' + Math.max(i, j);
    if (drawn.has(key)) continue;
    drawn.add(key);
    out.push([history[i], history[j]]);
  }
  return out;
}
