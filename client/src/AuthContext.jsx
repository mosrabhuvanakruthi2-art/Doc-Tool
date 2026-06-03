import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children, msRedirectToken, msRedirectError }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(sessionStorage.getItem('docs_token') || '');
  const [loading, setLoading] = useState(true);
  const [redirectError, setRedirectError] = useState(msRedirectError || null);

  const verify = useCallback(async (t) => {
    if (!t) { setUser(null); setLoading(false); return; }
    try {
      const res = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        sessionStorage.removeItem('docs_token');
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
      sessionStorage.setItem('docs_token', msRedirectToken);
      setToken(msRedirectToken);
      verify(msRedirectToken);
    } else {
      verify(token);
    }
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    sessionStorage.setItem('docs_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const loginWithMicrosoft = async (accessToken) => {
    const res = await fetch('/api/auth/microsoft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Microsoft login failed');
    sessionStorage.setItem('docs_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    sessionStorage.removeItem('docs_token');
    setToken('');
    setUser(null);
  };

  const hasPermission = (tab) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.[tab] !== false;
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginWithMicrosoft, logout, hasPermission, redirectError, clearRedirectError: () => setRedirectError(null) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
