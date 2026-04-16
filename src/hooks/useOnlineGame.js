import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFirestoreGame } from './useFirestoreGame';
import {
  computeGameResult,
  getBiggestGroup,
  isValidPlacement,
  isValidElimination,
  applyPlace,
  applyEliminate,
  computeEloDelta,
  ELO_K_FACTOR,
  LOCAL_MAX_TIMEOUTS
} from '../game/gameEngine';

function historyArrayToXY(arr) {
  return (arr || []).map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.r, p.c]));
}

function historyXYToArray(arr) {
  return arr.map(([r, c]) => ({ r, c }));
}

export function useOnlineGame(gameId) {
  const { user } = useAuth();
  const { data, exists, error } = useFirestoreGame(gameId);
  const [isWriting, setIsWriting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [ratings, setRatings] = useState({ 1: 1200, 2: 1200 });
  const [finalResult, setFinalResult] = useState(null);
  const ratingsFetchedRef = useRef(false);
  const eloHandledRef = useRef(false);

  const myPlayerNumber = useMemo(() => {
    if (!user || !data) return null;
    if (data.player1uid === user.uid) return 1;
    if (data.player2uid === user.uid) return 2;
    return null;
  }, [user, data]);

  const state = useMemo(() => {
    if (!data || !data.gameStateJSON) {
      if (!data) return [];
      const size = data.gridSize;
      const s = [];
      for (let i = 0; i < size; i++) {
        const row = [];
        for (let j = 0; j < size; j++) row.push({ player: null, eliminated: false });
        s.push(row);
      }
      return s;
    }
    return JSON.parse(data.gameStateJSON);
  }, [data]);

  const history = useMemo(() => {
    if (!data || !data.placementHistory) return { 1: [], 2: [] };
    return {
      1: historyArrayToXY(data.placementHistory.p1),
      2: historyArrayToXY(data.placementHistory.p2)
    };
  }, [data]);

  const scores = useMemo(() => {
    if (!data || state.length === 0) return { 1: 0, 2: 0 };
    return {
      1: getBiggestGroup(state, data.gridSize, 1),
      2: getBiggestGroup(state, data.gridSize, 2)
    };
  }, [state, data]);

  const turnKey = data
    ? `${data.currentPlayer}-${data.phase}-${(data.placementHistory?.p1?.length || 0) + (data.placementHistory?.p2?.length || 0)}`
    : '';

  useEffect(() => {
    if (!data || data.mode !== 'ranked' || ratingsFetchedRef.current) return;
    if (!data.player1uid || !data.player2uid) return;
    ratingsFetchedRef.current = true;
    Promise.all([
      getDoc(doc(db, 'players', data.player1uid)),
      getDoc(doc(db, 'players', data.player2uid))
    ])
      .then(([s1, s2]) => {
        setRatings({
          1: s1.data()?.rating ?? 1200,
          2: s2.data()?.rating ?? 1200
        });
      })
      .catch(() => {});
  }, [data]);

  useEffect(() => {
    if (!data || !data.result || !user || !myPlayerNumber) return;
    if (eloHandledRef.current) return;

    if (data.mode === 'casual') {
      eloHandledRef.current = true;
      setFinalResult(data.result);
      return;
    }

    if (myPlayerNumber === 1 && data.result.delta1 == null) {
      eloHandledRef.current = true;
      (async () => {
        try {
          const p1ref = doc(db, 'players', data.player1uid);
          const p2ref = doc(db, 'players', data.player2uid);
          const [snap1, snap2] = await Promise.all([getDoc(p1ref), getDoc(p2ref)]);
          const p1 = snap1.data();
          const p2 = snap2.data();
          if (!p1 || !p2) return;
          const r1 = typeof p1.rating === 'number' ? p1.rating : 1200;
          const r2 = typeof p2.rating === 'number' ? p2.rating : 1200;
          const scoreP1 =
            data.result.winner === 1 ? 1 : data.result.winner === 2 ? 0 : 0.5;
          const { delta1, delta2, newR1, newR2 } = computeEloDelta(r1, r2, scoreP1);

          await updateDoc(p1ref, {
            rating: newR1,
            games: (p1.games || 0) + 1,
            wins: scoreP1 === 1 ? (p1.wins || 0) + 1 : p1.wins || 0,
            losses: scoreP1 === 0 ? (p1.losses || 0) + 1 : p1.losses || 0,
            draws: scoreP1 === 0.5 ? (p1.draws || 0) + 1 : p1.draws || 0,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, 'games', gameId), {
            'result.delta1': delta1,
            'result.newR1': newR1,
            'result.delta2': delta2,
            'result.newR2': newR2
          });

          setRatings({ 1: newR1, 2: newR2 });
          setFinalResult({ ...data.result, delta1, delta2, newR1, newR2 });
        } catch (e) {
          console.error('ELO update error:', e);
          setFinalResult(data.result);
        }
      })();
      return;
    }

    if (myPlayerNumber === 2 && data.result.delta2 != null) {
      eloHandledRef.current = true;
      (async () => {
        try {
          const myRef = doc(db, 'players', user.uid);
          const snap = await getDoc(myRef);
          const me = snap.data();
          if (!me) return;
          const scoreP1 =
            data.result.winner === 1 ? 1 : data.result.winner === 2 ? 0 : 0.5;
          const myScore = 1 - scoreP1;
          await updateDoc(myRef, {
            rating: data.result.newR2,
            games: (me.games || 0) + 1,
            wins: myScore === 1 ? (me.wins || 0) + 1 : me.wins || 0,
            losses: myScore === 0 ? (me.losses || 0) + 1 : me.losses || 0,
            draws: myScore === 0.5 ? (me.draws || 0) + 1 : me.draws || 0,
            updatedAt: serverTimestamp()
          });
          setRatings({ 1: data.result.newR1, 2: data.result.newR2 });
          setFinalResult(data.result);
        } catch (e) {
          console.error('Own profile update error:', e);
          setFinalResult(data.result);
        }
      })();
    }
  }, [data, user, myPlayerNumber, gameId]);

  const placeDot = useCallback(
    async (row, col) => {
      if (!data || !user || !myPlayerNumber) return;
      if (data.status !== 'active') return;
      if (data.currentPlayer !== myPlayerNumber) return;
      if (isWriting) return;
      setLocalError('');

      if (data.phase === 'place') {
        if (!isValidPlacement(state, data.gridSize, row, col)) {
          setLocalError('game.invalid_placement');
          return;
        }
        const newState = applyPlace(state, myPlayerNumber, row, col);
        const newHistory = {
          p1: historyXYToArray(history[1]),
          p2: historyXYToArray(history[2])
        };
        newHistory[`p${myPlayerNumber}`].push({ r: row, c: col });

        setIsWriting(true);
        try {
          await updateDoc(doc(db, 'games', gameId), {
            phase: 'eliminate',
            lastPlaces: { row, col },
            gameStateJSON: JSON.stringify(newState),
            placementHistory: newHistory,
            [`timeouts.p${myPlayerNumber}`]: 0
          });
        } finally {
          setIsWriting(false);
        }
        return;
      }

      if (data.phase === 'eliminate') {
        if (!isValidElimination(state, data.lastPlaces, row, col)) {
          setLocalError('game.must_eliminate_adjacent');
          return;
        }
        const newState = applyEliminate(state, row, col);
        const gr = computeGameResult(newState, data.gridSize);
        const nextPlayer = myPlayerNumber === 1 ? 2 : 1;
        const update = {
          currentPlayer: nextPlayer,
          phase: 'place',
          lastPlaces: null,
          gameStateJSON: JSON.stringify(newState),
          placementHistory: {
            p1: historyXYToArray(history[1]),
            p2: historyXYToArray(history[2])
          }
        };
        if (gr) {
          update.result = gr;
          update.status = 'finished';
        }
        setIsWriting(true);
        try {
          await updateDoc(doc(db, 'games', gameId), update);
        } finally {
          setIsWriting(false);
        }
      }
    },
    [data, user, myPlayerNumber, isWriting, state, history, gameId]
  );

  const onTimeout = useCallback(async () => {
    if (!data || !myPlayerNumber) return;
    if (data.status !== 'active') return;
    if (data.currentPlayer !== myPlayerNumber) return;
    if (isWriting) return;

    const timeouts = data.timeouts || { p1: 0, p2: 0 };
    const myKey = `p${myPlayerNumber}`;
    const isFullSkip = data.phase === 'place';
    const newCount = isFullSkip ? (timeouts[myKey] || 0) + 1 : timeouts[myKey] || 0;

    if (newCount >= LOCAL_MAX_TIMEOUTS) {
      const s1 = getBiggestGroup(state, data.gridSize, 1);
      const s2 = getBiggestGroup(state, data.gridSize, 2);
      const winner = myPlayerNumber === 1 ? 2 : 1;
      setIsWriting(true);
      try {
        await updateDoc(doc(db, 'games', gameId), {
          status: 'finished',
          result: { winner, score1: s1, score2: s2, timeout: true, loser: myPlayerNumber },
          [`timeouts.${myKey}`]: newCount
        });
      } finally {
        setIsWriting(false);
      }
      return;
    }

    const nextPlayer = myPlayerNumber === 1 ? 2 : 1;
    setIsWriting(true);
    try {
      await updateDoc(doc(db, 'games', gameId), {
        currentPlayer: nextPlayer,
        phase: 'place',
        lastPlaces: null,
        [`timeouts.${myKey}`]: newCount
      });
    } finally {
      setIsWriting(false);
    }
  }, [data, myPlayerNumber, isWriting, state, gameId]);

  const leaveGame = useCallback(async () => {
    if (!data || !user || !gameId) return;
    const isActive = data.status === 'active';
    const update = { status: 'left', leftBy: user.uid };
    try {
      if (isActive && data.mode === 'ranked') {
        const opponentUid =
          user.uid === data.player1uid ? data.player2uid : data.player1uid;
        const [mySnap, oppSnap] = await Promise.all([
          getDoc(doc(db, 'players', user.uid)),
          getDoc(doc(db, 'players', opponentUid))
        ]);
        const me = mySnap.data();
        const opp = oppSnap.data();
        if (me && opp) {
          const myRating = me.rating ?? 1200;
          const oppRating = opp.rating ?? 1200;
          const expected = 1 / (1 + 10 ** ((oppRating - myRating) / 400));
          const delta = Math.round(ELO_K_FACTOR * (0 - expected));
          const newRating = Math.max(100, myRating + delta);
          await updateDoc(doc(db, 'players', user.uid), {
            rating: newRating,
            games: (me.games || 0) + 1,
            losses: (me.losses || 0) + 1,
            updatedAt: serverTimestamp()
          });
        }
      }
      await updateDoc(doc(db, 'games', gameId), update);
    } catch (e) {
      console.warn('Leave game failed:', e);
    }
  }, [data, user, gameId]);

  return {
    data,
    exists,
    error,
    state,
    history,
    scores,
    myPlayerNumber,
    ratings,
    placeDot,
    onTimeout,
    leaveGame,
    turnKey,
    isWriting,
    localError,
    finalResult
  };
}
