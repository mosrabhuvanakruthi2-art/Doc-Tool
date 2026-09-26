import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { reportLogout } from './reportDownload';
import { notifyAuthChanged } from './authEvents';

const AuthContext = createContext(null);

export function AuthProvider({ children, msRedirectToken, msRedirectError }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('docs_token') || '');
  const [loading, setLoading] = useState(true);
  const [redirectError, setRedirectError] = useState(msRedirectError || null);
  // True right after a Microsoft sign-in completes in this page load, so the app
  // can send an admin straight to the admin panel (and only on sign-in — an admin
  // who later opens the docs site is left there).
  const [justSignedIn, setJustSignedIn] = useState(!!msRedirectToken);

  const verify = useCallback(async (t) => {
    if (!t) { setUser(null); setLoading(false); return; }
    try {
      const res = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('docs_token');
        notifyAuthChanged();
        setToken('');
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (msRedirectToken) {
      // msRedirectToken is already our JWT (exchanged in main.jsx)
      localStorage.setItem('docs_token', msRedirectToken);
      // Data requested before this point went out without a token; reload it.
      notifyAuthChanged();
      setToken(msRedirectToken);
      verify(msRedirectToken);
    } else {
      verify(token);
    }
  }, []);

  // Sign-in is Microsoft only (the redirect flow handled in main.jsx); there is
  // no password login.
  const logout = () => {
    reportLogout('docs'); // must run before the token is cleared
    localStorage.removeItem('docs_token');
    notifyAuthChanged();
    setToken('');
    setUser(null);
  };

  const hasPermission = (tab) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.[tab] !== false;
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, logout, hasPermission, redirectError, clearRedirectError: () => setRedirectError(null), justSignedIn, clearJustSignedIn: () => setJustSignedIn(false) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
