import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductConfig } from '../ProductConfigContext';

const PRODUCT_ICONS = {
  Message: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Mail: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Content: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  ),
};

const DEFAULT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const COMPAT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const CLOUD_INFO_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const COMPAT_MATRICES_CHANGED = 'docproject:compat-matrices-changed';

function Sidebar() {
  const { productTypes, combinationsByProduct } = useProductConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCombination = searchParams.get('combination') || '';
  const activeMatrix = searchParams.get('matrix') || '';
  const activeView = searchParams.get('view') || '';
  const [expandedProduct, setExpandedProduct] = useState('');
  const [compatExpanded, setCompatExpanded] = useState(false);
  const [cloudInfoExpanded, setCloudInfoExpanded] = useState(false);
  const [compatMatrices, setCompatMatrices] = useState([]);
  const [cloudInfoItems, setCloudInfoItems] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    const loadCompat = () => {
      fetch('/api/compatibility')
        .then((res) => res.json())
        .then((data) => setCompatMatrices(data.matrices || []))
        .catch(() => {});
    };
    const loadCloud = () => {
      fetch('/api/cloud-info')
        .then((res) => res.json())
        .then((data) => setCloudInfoItems(data.items || []))
        .catch(() => {});
    };
    loadCompat();
    loadCloud();
    const onCompatChanged = () => loadCompat();
    window.addEventListener(COMPAT_MATRICES_CHANGED, onCompatChanged);
    const onFocus = () => {
      loadCompat();
      loadCloud();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(COMPAT_MATRICES_CHANGED, onCompatChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleProductClick = (slug) => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    if (expandedProduct === slug) {
      setExpandedProduct('');
      const params = new URLSearchParams(searchParams);
      params.delete('product');
      params.delete('combination');
      setSearchParams(params);
    } else {
      setExpandedProduct(slug);
      setCompatExpanded(false);
      setCloudInfoExpanded(false);
      const params = new URLSearchParams();
      setSearchParams(params);
    }
  };

  const handleCombinationClick = (product, combo) => {
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
    const params = new URLSearchParams(searchParams);
    params.set('product', product);
    params.delete('view');
    params.delete('matrix');
    params.delete('info');
    params.set('combination', combo);
    setSearchParams(params);
  };

  const handleCompatToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    const wasExpanded = compatExpanded;
    setCompatExpanded(prev => !prev);
    setExpandedProduct('');
    setCloudInfoExpanded(false);
    if (wasExpanded) {
      setSearchParams(new URLSearchParams());
    }
  };

  const handleMatrixClick = (slug) => {
    const params = new URLSearchParams();
    params.set('view', 'compatibility');
    params.set('matrix', slug);
    setSearchParams(params);
  };

  const handleCloudInfoToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    const wasExpanded = cloudInfoExpanded;
    setCloudInfoExpanded(prev => !prev);
    setExpandedProduct('');
    setCompatExpanded(false);
    if (wasExpanded) {
      setSearchParams(new URLSearchParams());
    }
  };

  const handleCloudInfoClick = (slug) => {
    const params = new URLSearchParams();
    params.set('view', 'cloudinfo');
    params.set('info', slug);
    setSearchParams(params);
  };

  const handleMouseDown = useCallback((e) => {
    if (collapsed) return;
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startWidth = sidebarRef.current?.offsetWidth || sidebarWidth;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(200, Math.min(400, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth, collapsed]);

  return (
    <div className="sidebar-wrapper">
      {collapsed && (
        <button
          className="sidebar-expand-tab"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      <aside
        className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}
        ref={sidebarRef}
        style={collapsed ? undefined : { width: sidebarWidth }}
      >
        {!collapsed && (
          <>
            {/* Product Types dropdown section */}
            <div className="sidebar-nav-section">
              <div className="sidebar-nav-header">
                <span className="sidebar-nav-label">Product Types</span>
                <button
                  className="sidebar-minimize-btn"
                  onClick={() => setCollapsed(true)}
                  title="Minimize sidebar"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>
              <ul className="sidebar-items">
                {productTypes.map(pt => {
                  const isOpen = expandedProduct === pt;
                  const combos = combinationsByProduct[pt] || [];
                  const currentProduct = searchParams.get('product') || '';
                  return (
                    <li key={pt}>
                      <button
                        className={`sidebar-product-btn ${isOpen ? 'active' : ''}`}
                        onClick={() => handleProductClick(pt)}
                        title={pt}
                      >
                        <span className="sidebar-product-icon-label">
                          {PRODUCT_ICONS[pt] || DEFAULT_ICON}
                          <span>{pt}</span>
                        </span>
                        {combos.length > 0 && (
                          <svg
                            className={`sidebar-product-icon ${isOpen ? 'expanded' : ''}`}
                            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        )}
                      </button>
                      {isOpen && (
                        <ul className="sidebar-combos">
                          {combos.map(combo => (
                            <li key={combo}>
                              <button
                                className={`sidebar-combo-btn ${currentProduct === pt && activeCombination === combo ? 'active' : ''}`}
                                onClick={() => handleCombinationClick(pt, combo)}
                              >
                                {combo}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Compatibility dropdown section — no gap */}
            {compatMatrices.length > 0 && (
              <div className="sidebar-nav-section">
                <div className="sidebar-nav-header">
                  <span className="sidebar-nav-label">Compatibility</span>
                </div>
                <ul className="sidebar-items">
                  <li>
                    <button
                      className={`sidebar-product-btn ${compatExpanded ? 'active' : ''}`}
                      onClick={handleCompatToggle}
                    >
                      <span className="sidebar-product-icon-label">
                        {COMPAT_ICON}
                        <span>Compatibility</span>
                      </span>
                      <svg
                        className={`sidebar-product-icon ${compatExpanded ? 'expanded' : ''}`}
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {compatExpanded && (
                      <ul className="sidebar-combos">
                        {compatMatrices.map(m => (
                          <li key={m._id}>
                            <button
                              className={`sidebar-combo-btn ${activeView === 'compatibility' && activeMatrix === m.slug ? 'active' : ''}`}
                              onClick={() => handleMatrixClick(m.slug)}
                            >
                              {m.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                </ul>
              </div>
            )}

            {/* Cloud Info dropdown section — no gap */}
            {cloudInfoItems.length > 0 && (
              <div className="sidebar-nav-section">
                <div className="sidebar-nav-header">
                  <span className="sidebar-nav-label">Cloud Info</span>
                </div>
                <ul className="sidebar-items">
                  <li>
                    <button
                      className={`sidebar-product-btn ${cloudInfoExpanded ? 'active' : ''}`}
                      onClick={handleCloudInfoToggle}
                    >
                      <span className="sidebar-product-icon-label">
                        {CLOUD_INFO_ICON}
                        <span>Cloud Info</span>
                      </span>
                      <svg
                        className={`sidebar-product-icon ${cloudInfoExpanded ? 'expanded' : ''}`}
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {cloudInfoExpanded && (
                      <ul className="sidebar-combos">
                        {cloudInfoItems.map(item => (
                          <li key={item._id}>
                            <button
                              className={`sidebar-combo-btn ${activeView === 'cloudinfo' && searchParams.get('info') === item.slug ? 'active' : ''}`}
                              onClick={() => handleCloudInfoClick(item.slug)}
                            >
                              {item.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                </ul>
              </div>
            )}
          </>
        )}

        {collapsed && (
          <ul className="sidebar-items">
            {productTypes.map(pt => (
              <li key={pt}>
                <button
                  className="sidebar-product-btn"
                  onClick={() => { setCollapsed(false); handleProductClick(pt); }}
                  title={pt}
                >
                  <span className="sidebar-product-icon-label">
                    {PRODUCT_ICONS[pt] || DEFAULT_ICON}
                  </span>
                </button>
              </li>
            ))}
            {compatMatrices.length > 0 && (
              <li>
                <button
                  className="sidebar-product-btn"
                  onClick={() => setCollapsed(false)}
                  title="Compatibility"
                >
                  <span className="sidebar-product-icon-label">
                    {COMPAT_ICON}
                  </span>
                </button>
              </li>
            )}
            {cloudInfoItems.length > 0 && (
              <li>
                <button
                  className="sidebar-product-btn"
                  onClick={() => setCollapsed(false)}
                  title="Cloud Info"
                >
                  <span className="sidebar-product-icon-label">
                    {CLOUD_INFO_ICON}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </aside>
      {!collapsed && (
        <div
          className={`sidebar-resize-handle ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}

export default Sidebar;
