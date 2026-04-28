import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFirestoreGame } from './useFirestoreGame';
import { normalizeHistory } from '../utils/coordinateNormalization';
import { getBiggestGroup } from '../game/gameEngine';
import { getDisplayRatingFromProfile, normalizeSkillProfile } from '../game/skillRating';
import {
  finalizeRankedResult,
  leaveOnlineGame,
  submitGameMove,
  submitGameTimeout
} from '../services/firebaseActions';

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
    // If user is not in this game, mark it as invalid (exists = false will trigger redirect)
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
        const response = await finalizeRankedResult({ gameId });
        const result = response?.data?.result || data.result;
        if (result?.newR1 != null && result?.newR2 != null) {
          setRatings({ 1: result.newR1, 2: result.newR2 });
        }
        setFinalResult(result);
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
      setIsWriting(true);
      try {
        await submitGameMove({ gameId, row, col });
      } catch (e) {
        setLocalError(e?.message || 'game.move_failed');
      } finally {
        setIsWriting(false);
      }
    },
    [data, user, myPlayerNumber, isWriting, gameId]
  );

  const onTimeout = useCallback(async () => {
    if (!data || !myPlayerNumber) return;
    if (data.status !== 'active') return;
    if (data.currentPlayer !== myPlayerNumber) return;
    if (isWriting) return;
    setIsWriting(true);
    try {
      await submitGameTimeout({ gameId });
    } catch (e) {
      setLocalError(e?.message || 'game.timeout_failed');
    } finally {
      setIsWriting(false);
    }
  }, [data, myPlayerNumber, isWriting, gameId]);

  const leaveGame = useCallback(async () => {
    if (!data || !user || !gameId) return;
    try {
      await leaveOnlineGame({ gameId });
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
