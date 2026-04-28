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

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

async function ensurePlayerProfile(user) {
  // Only allow gmail accounts to have profiles
  if (!isAllowedEmail(user.email)) {
    throw new Error('Only @gmail.com accounts can create profiles.');
  }

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
    getRedirectResult(auth)
      .then((credential) => {
        if (credential?.user && !isAllowedEmail(credential.user.email)) {
          fbSignOut(auth);
          setError('Only @gmail.com accounts can sign in.');
        }
      })
      .catch((e) => {
        if (e?.code !== 'auth/no-auth-event') console.warn('Redirect result error:', e);
      });

    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(false);
      if (u && !isAllowedEmail(u.email)) {
        setUser(null);
        setError('Only @gmail.com accounts can sign in.');
        try {
          await fbSignOut(auth);
        } catch (e) {
          console.warn('Blocked account sign-out failed:', e);
        }
        return;
      }

      setUser(u);
      setError(null);

      if (u) {
        try {
          await ensurePlayerProfile(u);
        } catch (e) {
          console.warn('Profile init failed:', e);
        }
      }
      try {
        // notify other components that auth state changed so they can close overlays
        window.dispatchEvent(new Event('auth-changed'));
        // If we returned from an auth redirect flow, force a reload to ensure UI state updates
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const redirected = window.sessionStorage.getItem('authRedirect');
          if (redirected) {
            window.sessionStorage.removeItem('authRedirect');
            try {
              window.location.reload();
            } catch (e) {
              console.warn('Reload after redirect failed:', e);
            }
          }
        }
      } catch (e) {
        // ignore in non-browser environments
      }
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      if (!isAllowedEmail(credential.user?.email)) {
        await fbSignOut(auth);
        setError('Only @gmail.com accounts can sign in.');
      }
    } catch (e) {
      if (
        e?.code === 'auth/popup-blocked' ||
        e?.code === 'auth/operation-not-supported-in-this-environment' ||
        e?.code === 'auth/popup-closed-by-user'
      ) {
        try {
          // mark that we're redirecting so we can reload after returning
          try {
            sessionStorage.setItem('authRedirect', '1');
          } catch (err) {
            /* ignore if sessionStorage unavailable */
          }
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
