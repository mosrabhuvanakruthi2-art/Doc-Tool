import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

function getInitials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return 'U';
}

function Header({ darkMode, onToggleDark, isAdmin, onLogout, user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const section = searchParams.get('section') || 'inscope';

  const handleSectionToggle = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', value);
    setSearchParams(params);
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
              <button className={`toggle-btn ${section === 'inscope' ? 'active' : ''}`} onClick={() => handleSectionToggle('inscope')}>Inscope</button>
              <button className={`toggle-btn ${section === 'outscope' ? 'active' : ''}`} onClick={() => handleSectionToggle('outscope')}>Outscope</button>
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

        {isAdmin && <Link to="/" className="header-nav-link">View Docs</Link>}

        <span className="header-title">Migration Docs</span>

        {onLogout && user && (
          <div className="user-menu" ref={dropdownRef}>
            <button className="user-avatar-btn" onClick={() => setDropdownOpen(v => !v)}>
              <span className="user-avatar">{getInitials(user.name, user.email)}</span>
            </button>
            {dropdownOpen && (
              <div className="user-dropdown">
                <div className="user-dropdown-info">
                  <span className="user-dropdown-name">{user.name || 'User'}</span>
                  <span className="user-dropdown-email">{user.email}</span>
                </div>
                <div className="user-dropdown-divider" />
                <button className="user-dropdown-logout" onClick={() => { setDropdownOpen(false); onLogout(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Log out
                </button>
              </div>
            )}
          </div>
        )}

        {onLogout && !user && (
          <button className="header-logout-btn" onClick={onLogout}>Logout</button>
        )}
      </div>
    </header>
  );
}

export default Header;
