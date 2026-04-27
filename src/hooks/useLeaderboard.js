import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_FIDE_RATING,
  computeEloDelta
} from '../game/gameEngine';
import { normalizeSkillProfile } from '../game/skillRating';

const STORAGE_KEY = 'sakupljac_players_v1';

function normalizeKey(name) {
  return name.trim().toLocaleLowerCase('hr');
}

function loadPlayers() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePlayers(players) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

function createProfile(name) {
  const profile = normalizeSkillProfile();
  return {
    id: normalizeKey(name),
    name: name.trim(),
    mu: profile.mu,
    sigma: profile.sigma,
    rating: DEFAULT_FIDE_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    updatedAt: Date.now()
  };
}

export function useLeaderboard() {
  const [players, setPlayers] = useState(() => loadPlayers());

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setPlayers(loadPlayers());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const ensureProfile = useCallback((name) => {
    const key = normalizeKey(name);
    const cur = loadPlayers();
    if (!cur[key]) cur[key] = createProfile(name);
    else cur[key].name = name.trim();
    savePlayers(cur);
    setPlayers(cur);
    return cur[key];
  }, []);

  const getRating = useCallback((name) => {
    const key = normalizeKey(name);
    const cur = loadPlayers();
    return normalizeSkillProfile(cur[key] || {}).rating;
  }, []);

  const recordGame = useCallback((player1Name, player2Name, scoreP1) => {
    const cur = loadPlayers();
    const k1 = normalizeKey(player1Name);
    const k2 = normalizeKey(player2Name);
    if (!cur[k1]) cur[k1] = createProfile(player1Name);
    if (!cur[k2]) cur[k2] = createProfile(player2Name);
    const p1 = cur[k1];
    const p2 = cur[k2];

    const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeEloDelta(
      p1,
      p2,
      scoreP1
    );
    p1.mu = profile1.mu;
    p1.sigma = profile1.sigma;
    p1.rating = newR1;
    p2.mu = profile2.mu;
    p2.sigma = profile2.sigma;
    p2.rating = newR2;
    p1.games += 1;
    p2.games += 1;
    if (scoreP1 === 1) { p1.wins += 1; p2.losses += 1; }
    else if (scoreP1 === 0) { p1.losses += 1; p2.wins += 1; }
    else { p1.draws += 1; p2.draws += 1; }
    p1.updatedAt = Date.now();
    p2.updatedAt = Date.now();

    savePlayers(cur);
    setPlayers(cur);

    return {
      delta1, delta2,
      rating1: newR1, rating2: newR2
    };
  }, []);

  const sorted = Object.values(players).sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name, 'hr');
  });

  return { players: sorted, ensureProfile, getRating, recordGame };
}
