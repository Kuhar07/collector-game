import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

/**
 * Hook to fetch and track player's current state on backend
 * States: idle, searching, matched, playing, finished
 */
export function usePlayerState() {
  const { user } = useAuth();
  const [playerState, setPlayerState] = useState('idle');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchState = async () => {
      try {
        setLoading(true);
        const token = await user.getIdToken();
        const response = await fetch(`${BACKEND_URL}/profile/state`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (response.ok) {
          const data = await response.json();
          setPlayerState(data.state || 'idle');
        }
      } catch (error) {
        console.error('Failed to fetch player state:', error);
      } finally {
        setLoading(false);
      }
    };

    // Fetch on mount
    fetchState();

    // Poll every 5 seconds to stay in sync
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, [user]);

  return { playerState, loading };
}

/**
 * Check if player can perform an action based on their current state
 */
export function canPerformAction(playerState, action) {
  const allowed = {
    enqueue: ['idle', 'finished'],
    cancel: ['searching', 'matched'],
    joinGame: ['matched'],
    move: ['playing'],
    leave: ['playing'],
    finalize: ['playing']
  };

  return allowed[action]?.includes(playerState) || false;
}
