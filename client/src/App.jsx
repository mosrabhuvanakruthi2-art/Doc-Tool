import { useState, useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { startMicrosoftLogin } from './msalOauth';
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
import DocumentAccessRequest from './components/DocumentAccessRequest';
import { useAuth } from './AuthContext';

const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || '';
const MS_CONFIGURED = AZURE_CLIENT_ID && !AZURE_CLIENT_ID.includes('your-azure');

function DocsLogin() {
  const { redirectError, clearRedirectError } = useAuth();
  const [error, setError] = useState('');

  const handleMicrosoftLogin = () => {
    if (!MS_CONFIGURED) {
      setError('Microsoft login is not configured. Contact administrator.');
      return;
    }
    startMicrosoftLogin();
  };

  return (
    <div className="ms-login-page">
      <div className="ms-login-card">
        <div className="ms-login-header">
          <img src="/cloudfuze-logo.png" alt="CloudFuze" className="ms-login-logo" />
          <h1 className="ms-login-title">Migration Docs</h1>
        </div>

        <div className="ms-login-body">
          <h2 className="ms-login-heading">Sign in to your account</h2>
          <p className="ms-login-sub">Use your CloudFuze Microsoft account</p>

          {(error || redirectError) && (
            <div className="ms-login-error" onClick={clearRedirectError}>
              {error || redirectError}
            </div>
          )}

          <button className="ms-btn" onClick={handleMicrosoftLogin}>
            <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </button>
        </div>

        <div className="ms-login-footer">
          © 2026 CloudFuze · Migration Documentation
        </div>
      </div>
    </div>
  );
}

function AdminRoute({ darkMode, setDarkMode }) {
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    if (!token) { setChecking(false); setVerified(false); return; }
    fetch('/api/admin/verify', { headers: { Authorization: 'Bearer ' + token } })
      .then((res) => {
        if (res.ok) { setVerified(true); }
        else { localStorage.removeItem('admin_token'); setToken(''); setVerified(false); }
      })
      .catch(() => { setVerified(false); })
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogout = () => { localStorage.removeItem('admin_token'); setToken(''); setVerified(false); };

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
  const { hasPermission } = useAuth();
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
  if (view === 'documents') {
    if (!hasPermission('documents')) return <DocumentAccessRequest />;
    if (docSlug) return <DocumentPage slug={docSlug} />;
  }
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
