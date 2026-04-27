import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import {
  DEFAULT_DISPLAY_RATING,
  DEFAULT_MU,
  DEFAULT_SIGMA,
  normalizeSkillProfile
} from '../game/skillRating';

const AuthContext = createContext(null);

async function ensurePlayerProfile(user) {
  const ref = doc(db, 'players', user.uid);
  const snap = await getDoc(ref);
  const existing = snap.data() || {};
  const normalized = normalizeSkillProfile(existing);

  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || user.email,
      email: user.email,
      mu: DEFAULT_MU,
      sigma: DEFAULT_SIGMA,
      rating: DEFAULT_DISPLAY_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updatedAt: serverTimestamp()
    });
    return;
  }

  if (existing.mu == null || existing.sigma == null || existing.rating == null) {
    await setDoc(
      ref,
      {
        displayName: existing.displayName || user.displayName || user.email,
        email: existing.email || user.email,
        ...normalized,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getRedirectResult(auth).catch((e) => {
      if (e?.code !== 'auth/no-auth-event') console.warn('Redirect result error:', e);
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        try {
          await ensurePlayerProfile(u);
        } catch (e) {
          console.warn('Profile init failed:', e);
        }
      }
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (
        e?.code === 'auth/popup-blocked' ||
        e?.code === 'auth/operation-not-supported-in-this-environment' ||
        e?.code === 'auth/popup-closed-by-user'
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (e2) {
          setError(e2.message);
        }
      } else {
        setError(e.message);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
