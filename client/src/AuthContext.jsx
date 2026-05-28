import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(sessionStorage.getItem('docs_token') || '');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { verify(token); }, [token, verify]);

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
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
