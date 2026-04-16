import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import {
  createInitialState,
  isValidPlacement,
  isValidElimination,
  applyPlace,
  applyEliminate,
  computeGameResult,
  getBiggestGroup,
  LOCAL_MAX_TIMEOUTS
} from '../game/gameEngine';
import { useLeaderboard } from '../hooks/useLeaderboard';

const LocalGameContext = createContext(null);

const emptyHistory = () => ({ 1: [], 2: [] });

export function LocalGameProvider({ children }) {
  const leaderboard = useLeaderboard();
  const [config, setConfig] = useState(null); // { player1Name, player2Name, gridSize, timerEnabled }
  const [state, setState] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [phase, setPhase] = useState('place');
  const [lastPlaces, setLastPlaces] = useState(null);
  const [history, setHistory] = useState(emptyHistory());
  const [timeouts, setTimeouts] = useState({ 1: 0, 2: 0 });
  const [turnKey, setTurnKey] = useState(0);
  const [result, setResult] = useState(null); // { winner, score1, score2, message }

  const startGame = useCallback(
    ({ player1Name, player2Name, gridSize, timerEnabled }) => {
      leaderboard.ensureProfile(player1Name);
      leaderboard.ensureProfile(player2Name);
      setConfig({ player1Name, player2Name, gridSize, timerEnabled });
      setState(createInitialState(gridSize));
      setCurrentPlayer(1);
      setPhase('place');
      setLastPlaces(null);
      setHistory(emptyHistory());
      setTimeouts({ 1: 0, 2: 0 });
      setTurnKey((k) => k + 1);
      setResult(null);
    },
    [leaderboard]
  );

  const resetGame = useCallback(() => {
    if (!config) return;
    setState(createInitialState(config.gridSize));
    setCurrentPlayer(1);
    setPhase('place');
    setLastPlaces(null);
    setHistory(emptyHistory());
    setTimeouts({ 1: 0, 2: 0 });
    setTurnKey((k) => k + 1);
    setResult(null);
  }, [config]);

  const clearGame = useCallback(() => {
    setConfig(null);
    setState([]);
    setCurrentPlayer(1);
    setPhase('place');
    setLastPlaces(null);
    setHistory(emptyHistory());
    setTimeouts({ 1: 0, 2: 0 });
    setResult(null);
  }, []);

  const finalize = useCallback(
    (gameResult) => {
      if (!config) return;
      const scoreP1 =
        gameResult.winner === 0 ? 0.5 : gameResult.winner === 1 ? 1 : 0;
      const rat = leaderboard.recordGame(config.player1Name, config.player2Name, scoreP1);
      setResult({ ...gameResult, rating: rat });
    },
    [config, leaderboard]
  );

  const placeDot = useCallback(
    (row, col) => {
      if (!config || result) return;
      if (phase === 'place') {
        if (!isValidPlacement(state, config.gridSize, row, col)) return;
        const ns = applyPlace(state, currentPlayer, row, col);
        setState(ns);
        setHistory((h) => ({
          ...h,
          [currentPlayer]: [...h[currentPlayer], [row, col]]
        }));
        setLastPlaces({ row, col });
        setPhase('eliminate');
        setTimeouts((t) => ({ ...t, [currentPlayer]: 0 }));
        setTurnKey((k) => k + 1);
      } else if (phase === 'eliminate') {
        if (!isValidElimination(state, lastPlaces, row, col)) return;
        const ns = applyEliminate(state, row, col);
        const gr = computeGameResult(ns, config.gridSize);
        setState(ns);
        setLastPlaces(null);
        setPhase('place');
        if (gr) {
          finalize(gr);
        } else {
          setCurrentPlayer((p) => (p === 1 ? 2 : 1));
          setTurnKey((k) => k + 1);
        }
      }
    },
    [config, state, phase, currentPlayer, lastPlaces, result, finalize]
  );

  const onTimeout = useCallback(() => {
    if (!config || result) return;
    const isFullSkip = phase === 'place';
    let nextTimeouts = timeouts;
    if (isFullSkip) {
      const newCount = (timeouts[currentPlayer] || 0) + 1;
      nextTimeouts = { ...timeouts, [currentPlayer]: newCount };
      if (newCount >= LOCAL_MAX_TIMEOUTS) {
        const s1 = getBiggestGroup(state, config.gridSize, 1);
        const s2 = getBiggestGroup(state, config.gridSize, 2);
        const winner = currentPlayer === 1 ? 2 : 1;
        finalize({ winner, score1: s1, score2: s2, timeout: true, loser: currentPlayer });
        setTimeouts(nextTimeouts);
        return;
      }
    }
    setTimeouts(nextTimeouts);
    setCurrentPlayer((p) => (p === 1 ? 2 : 1));
    setPhase('place');
    setLastPlaces(null);
    setTurnKey((k) => k + 1);
  }, [config, state, phase, currentPlayer, timeouts, result, finalize]);

  const scores = useMemo(() => {
    if (!config || state.length === 0) return { 1: 0, 2: 0 };
    return {
      1: getBiggestGroup(state, config.gridSize, 1),
      2: getBiggestGroup(state, config.gridSize, 2)
    };
  }, [state, config]);

  const value = {
    config,
    state,
    currentPlayer,
    phase,
    lastPlaces,
    history,
    scores,
    result,
    turnKey,
    placeDot,
    startGame,
    resetGame,
    clearGame,
    onTimeout,
    isActive: !!config && !result,
    ratings: {
      1: config ? leaderboard.getRating(config.player1Name) : 1200,
      2: config ? leaderboard.getRating(config.player2Name) : 1200
    },
    leaderboard
  };

  return <LocalGameContext.Provider value={value}>{children}</LocalGameContext.Provider>;
}

export function useLocalGame() {
  const ctx = useContext(LocalGameContext);
  if (!ctx) throw new Error('useLocalGame must be used inside LocalGameProvider');
  return ctx;
}
