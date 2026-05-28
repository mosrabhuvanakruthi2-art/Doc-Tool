import { useState, useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import FeatureTable from './components/FeatureTable';
import CompatibilityTable from './components/CompatibilityTable';
import CloudInfoPage from './components/CloudInfoPage';
import DocumentPage from './components/DocumentPage';
import AdminPage from './components/AdminPage';
import AdminLogin from './components/AdminLogin';
import ToastContainer from './components/Toast';
import CfLoader from './components/CfLoader';
import { useAuth } from './AuthContext';

function DocsLogin() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-header">
          <img src="/cloudfuze-logo.png" alt="CloudFuze" className="admin-login-logo" />
          <h2>Migration Docs</h2>
          <p>Sign in to access documentation</p>
        </div>
        <form onSubmit={handleSubmit} className="admin-login-form">
          {error && <div className="admin-login-error">{error}</div>}
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="admin-login-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminRoute({ darkMode, setDarkMode }) {
  const [token, setToken] = useState(sessionStorage.getItem('admin_token') || '');
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) { setChecking(false); setVerified(false); return; }
    fetch('/api/admin/verify', { headers: { Authorization: 'Bearer ' + token } })
      .then((res) => {
        if (res.ok) { setVerified(true); }
        else { sessionStorage.removeItem('admin_token'); setToken(''); setVerified(false); }
      })
      .catch(() => { setVerified(false); })
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogout = () => { sessionStorage.removeItem('admin_token'); setToken(''); setVerified(false); };

  if (checking) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card" style={{ textAlign: 'center', padding: 48 }}>Verifying session...</div>
      </div>
    );
  }
  if (!verified) return <AdminLogin onLogin={(t) => setToken(t)} />;

  return (
    <>
      <Header darkMode={darkMode} onToggleDark={() => setDarkMode(!darkMode)} isAdmin={true} onLogout={handleLogout} />
      <div className="app-body">
        <AdminPage />
      </div>
    </>
  );
}

function MainContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || '';
  const matrixSlug = searchParams.get('matrix') || '';
  const infoSlug = searchParams.get('info') || '';
  const docSlug = searchParams.get('doc') || '';

  useEffect(() => {
    const navEntries = performance.getEntriesByType('navigation');
    const isReload = navEntries.length > 0 && navEntries[0].type === 'reload';
    if (isReload && searchParams.toString()) {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
  }, []);

  if (view === 'compatibility' && matrixSlug) return <CompatibilityTable matrixSlug={matrixSlug} />;
  if (view === 'cloudinfo' && infoSlug) return <CloudInfoPage slug={infoSlug} />;
  if (view === 'documents' && docSlug) return <DocumentPage slug={docSlug} />;
  return <FeatureTable />;
}

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const { user, loading: authLoading, logout } = useAuth();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  if (authLoading) {
    return <div className="app"><CfLoader /></div>;
  }

  return (
    <div className={'app ' + (darkMode ? 'dark' : '')}>
      <ToastContainer />
      <Routes>
        <Route path="/admin" element={<AdminRoute darkMode={darkMode} setDarkMode={setDarkMode} />} />
        <Route
          path="/"
          element={
            user ? (
              <>
                <Header darkMode={darkMode} onToggleDark={() => setDarkMode(!darkMode)} isAdmin={false} onLogout={logout} user={user} />
                <div className="app-body">
                  <Sidebar />
                  <main className="main-content">
                    <MainContent />
                  </main>
                </div>
              </>
            ) : (
              <DocsLogin />
            )
          }
        />
      </Routes>
    </div>
  );
}

export default App;
