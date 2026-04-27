import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'sakupljac_theme';

function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    return savedTheme || getSystemTheme();
  });
  const [followSystem, setFollowSystem] = useState(() => !localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    const body = document.body;
    if (theme === 'dark') {
      body.classList.add('dark');
      body.classList.remove('light');
    } else {
      body.classList.add('light');
      body.classList.remove('dark');
    }
    body.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (followSystem) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, followSystem]);

  useEffect(() => {
    if (!followSystem || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      setThemeState(event.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    setThemeState(mediaQuery.matches ? 'dark' : 'light');

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [followSystem]);

  const setTheme = useCallback((t) => {
    setFollowSystem(false);
    setThemeState(t);
  }, []);
  const toggleTheme = useCallback(() => {
    setFollowSystem(false);
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
