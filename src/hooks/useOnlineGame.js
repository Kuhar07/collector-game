import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFirestoreGame } from './useFirestoreGame';
import { normalizeHistory } from '../utils/coordinateNormalization';
import {
  computeGameResult,
  getBiggestGroup,
  isValidPlacement,
  isValidElimination,
  applyPlace,
  applyEliminate,
  computeEloDelta,
  LOCAL_MAX_TIMEOUTS
} from '../game/gameEngine';
import { getDisplayRatingFromProfile, normalizeSkillProfile } from '../game/skillRating';

function historyXYToArray(arr) {
  return arr.map(([r, c]) => ({ r, c }));
}

export function useOnlineGame(gameId) {
  const { user } = useAuth();
  const { data, exists, error } = useFirestoreGame(gameId);
  const [isWriting, setIsWriting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [ratings, setRatings] = useState({ 1: 1000, 2: 1000 });
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
      1: normalizeHistory(data.placementHistory.p1),
      2: normalizeHistory(data.placementHistory.p2)
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
          1: getDisplayRatingFromProfile(normalizeSkillProfile(s1.data() || {})),
          2: getDisplayRatingFromProfile(normalizeSkillProfile(s2.data() || {}))
        });
      })
      .catch(() => { });
  }, [data]);

  useEffect(() => {
    if (!data || !data.result || !user || !myPlayerNumber) return;
    if (eloHandledRef.current) return;

    if (data.mode === 'casual') {
      eloHandledRef.current = true;
      setFinalResult(data.result);
      return;
    }

    if (data.result.delta1 != null && data.result.delta2 != null) {
      eloHandledRef.current = true;
      setRatings({ 1: data.result.newR1, 2: data.result.newR2 });
      setFinalResult(data.result);
      return;
    }

    if (myPlayerNumber !== 1) {
      return;
    }

    eloHandledRef.current = true;
    (async () => {
      try {
        const p1ref = doc(db, 'players', data.player1uid);
        const p2ref = doc(db, 'players', data.player2uid);
        const [snap1, snap2] = await Promise.all([getDoc(p1ref), getDoc(p2ref)]);
        const p1 = normalizeSkillProfile(snap1.data() || {});
        const p2 = normalizeSkillProfile(snap2.data() || {});
        const scoreP1 = data.result.winner === 1 ? 1 : data.result.winner === 2 ? 0 : 0.5;
        const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeEloDelta(
          p1,
          p2,
          scoreP1
        );

        await updateDoc(p1ref, {
          mu: profile1.mu,
          sigma: profile1.sigma,
          rating: newR1,
          games: (snap1.data()?.games || 0) + 1,
          wins: scoreP1 === 1 ? (snap1.data()?.wins || 0) + 1 : snap1.data()?.wins || 0,
          losses: scoreP1 === 0 ? (snap1.data()?.losses || 0) + 1 : snap1.data()?.losses || 0,
          draws: scoreP1 === 0.5 ? (snap1.data()?.draws || 0) + 1 : snap1.data()?.draws || 0,
          updatedAt: serverTimestamp()
        });

        await updateDoc(p2ref, {
          mu: profile2.mu,
          sigma: profile2.sigma,
          rating: newR2,
          games: (snap2.data()?.games || 0) + 1,
          wins: scoreP1 === 0 ? (snap2.data()?.wins || 0) + 1 : snap2.data()?.wins || 0,
          losses: scoreP1 === 1 ? (snap2.data()?.losses || 0) + 1 : snap2.data()?.losses || 0,
          draws: scoreP1 === 0.5 ? (snap2.data()?.draws || 0) + 1 : snap2.data()?.draws || 0,
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
        console.error('Rating update error:', e);
        setFinalResult(data.result);
      }
    })();
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
    const gameRef = doc(db, 'games', gameId);
    try {
      const liveSnap = await getDoc(gameRef);
      if (!liveSnap.exists()) return;
      const liveData = liveSnap.data();

      // If game already ended/left, do not apply additional leave penalties.
      if (liveData.status !== 'active') {
        return;
      }

      if (liveData.mode === 'ranked') {
        const opponentUid =
          user.uid === liveData.player1uid ? liveData.player2uid : liveData.player1uid;
        const [mySnap, oppSnap] = await Promise.all([
          getDoc(doc(db, 'players', user.uid)),
          getDoc(doc(db, 'players', opponentUid))
        ]);
        const me = normalizeSkillProfile(mySnap.data() || {});
        const opp = normalizeSkillProfile(oppSnap.data() || {});
        const scoreP1 = user.uid === liveData.player1uid ? 0 : 1;
        const { profile1, profile2 } = computeEloDelta(me, opp, scoreP1);
        const myProfile = user.uid === liveData.player1uid ? profile1 : profile2;
        await updateDoc(doc(db, 'players', user.uid), {
          mu: myProfile.mu,
          sigma: myProfile.sigma,
          rating: myProfile.rating,
          games: (mySnap.data()?.games || 0) + 1,
          losses: (mySnap.data()?.losses || 0) + 1,
          updatedAt: serverTimestamp()
        });
      }

      await updateDoc(gameRef, { status: 'left', leftBy: user.uid });
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
