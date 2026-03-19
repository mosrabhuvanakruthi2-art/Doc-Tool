import { Link, useSearchParams } from 'react-router-dom';

function Header({ darkMode, onToggleDark, isAdmin, onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section') || 'inscope';

  const handleSectionToggle = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', value);
    setSearchParams(params);
  };

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="logo">
          <img src="/cloudfuze-logo.png" alt="CloudFuze" className="logo-img" />
        </Link>
      </div>

      {!isAdmin && (
        <div className="header-center">
          {!searchParams.get('view') && searchParams.get('product') && (
            <div className="section-toggle">
              <button
                className={`toggle-btn ${section === 'inscope' ? 'active' : ''}`}
                onClick={() => handleSectionToggle('inscope')}
              >
                Inscope
              </button>
              <button
                className={`toggle-btn ${section === 'outscope' ? 'active' : ''}`}
                onClick={() => handleSectionToggle('outscope')}
              >
                Outscope
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="header-center">
          <span className="admin-badge">Admin Panel</span>
        </div>
      )}

      <div className="header-right">
        <button className="dark-mode-btn" onClick={onToggleDark} title="Toggle dark mode">
          {darkMode ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
            </svg>
          )}
        </button>
        {isAdmin && (
          <Link to="/" className="header-nav-link">View Docs</Link>
        )}
        {isAdmin && onLogout && (
          <button className="header-logout-btn" onClick={onLogout}>Logout</button>
        )}
        <span className="header-title">Migration Docs</span>
      </div>
    </header>
  );
}

export default Header;
