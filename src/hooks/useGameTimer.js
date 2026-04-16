import { useEffect, useRef, useState } from 'react';
import { LOCAL_TURN_TIME } from '../game/gameEngine';

export function useGameTimer({ enabled, turnKey, onTimeout }) {
  const [seconds, setSeconds] = useState(LOCAL_TURN_TIME);
  const timerRef = useRef(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled) return undefined;
    setSeconds(LOCAL_TURN_TIME);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          queueMicrotask(() => onTimeoutRef.current && onTimeoutRef.current());
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, turnKey]);

  return seconds;
}
