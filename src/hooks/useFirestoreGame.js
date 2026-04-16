import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export function useFirestoreGame(gameId) {
  const [data, setData] = useState(null);
  const [exists, setExists] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!gameId) return undefined;
    setData(null);
    setExists(null);
    setError(null);
    const unsub = onSnapshot(
      doc(db, 'games', gameId),
      (snap) => {
        if (!snap.exists()) {
          setExists(false);
          setData(null);
          return;
        }
        setExists(true);
        setData(snap.data());
      },
      (err) => setError(err)
    );
    return unsub;
  }, [gameId]);

  return { data, exists, error };
}
