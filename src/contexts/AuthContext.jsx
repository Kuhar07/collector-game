import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { ensurePlayerProfile } from '../services/firebaseActions';

const AuthContext = createContext(null);

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
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
          await ensurePlayerProfile();
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
