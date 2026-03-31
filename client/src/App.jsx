import { useState, useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import FeatureTable from './components/FeatureTable';
import CompatibilityTable from './components/CompatibilityTable';
import CloudInfoPage from './components/CloudInfoPage';
import AdminPage from './components/AdminPage';
import AdminLogin from './components/AdminLogin';
import ToastContainer from './components/Toast';

function AdminRoute({ darkMode, setDarkMode }) {
  const [token, setToken] = useState(sessionStorage.getItem('admin_token') || '');
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      setVerified(false);
      return;
    }
    fetch('/api/admin/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.ok) {
          setVerified(true);
        } else {
          sessionStorage.removeItem('admin_token');
          setToken('');
          setVerified(false);
        }
      })
      .catch(() => {
        setVerified(false);
      })
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    setToken('');
    setVerified(false);
  };

  if (checking) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card" style={{ textAlign: 'center', padding: 48 }}>
          Verifying session...
        </div>
      </div>
    );
  }

  if (!verified) {
    return <AdminLogin onLogin={(t) => setToken(t)} />;
  }

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

  useEffect(() => {
    const navEntries = performance.getEntriesByType('navigation');
    const isReload = navEntries.length > 0 && navEntries[0].type === 'reload';
    if (isReload && searchParams.toString()) {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === 'compatibility' && matrixSlug) {
    return <CompatibilityTable matrixSlug={matrixSlug} />;
  }

  if (view === 'cloudinfo' && infoSlug) {
    return <CloudInfoPage slug={infoSlug} />;
  }

  return <FeatureTable />;
}

function App() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <ToastContainer />
      <Routes>
        <Route
          path="/admin"
          element={<AdminRoute darkMode={darkMode} setDarkMode={setDarkMode} />}
        />
        <Route
          path="/"
          element={
            <>
              <Header darkMode={darkMode} onToggleDark={() => setDarkMode(!darkMode)} isAdmin={false} />
              <div className="app-body">
                <Sidebar />
                <main className="main-content">
                  <MainContent />
                </main>
              </div>
            </>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
