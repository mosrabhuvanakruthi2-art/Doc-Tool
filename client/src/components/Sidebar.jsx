import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductConfig } from '../ProductConfigContext';
import { useAuth } from '../AuthContext';

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

const LOCK_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const FOLDER_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const DOC_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const CLOUD_INFO_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const HOME_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);

const COMPAT_MATRICES_CHANGED = 'docproject:compat-matrices-changed';

function Sidebar() {
  const { productTypes, combinationsByProduct } = useProductConfig();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCombination = searchParams.get('combination') || '';
  const activeMatrix = searchParams.get('matrix') || '';
  const activeView = searchParams.get('view') || '';
  // MainContent shows the welcome dashboard when nothing is selected.
  const isDashboard = !searchParams.get('product') && !searchParams.get('combination') && !activeView;
  const [expandedProduct, setExpandedProduct] = useState('');
  const [compatExpanded, setCompatExpanded] = useState(false);
  const [cloudInfoExpanded, setCloudInfoExpanded] = useState(false);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [compatMatrices, setCompatMatrices] = useState([]);
  const [cloudInfoItems, setCloudInfoItems] = useState([]);
  const [docItems, setDocItems] = useState([]);
  const [docFolders, setDocFolders] = useState([]);
  const [openDocFolders, setOpenDocFolders] = useState({});
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef(null);

  // Folders and documents are edited in the admin panel, often in another tab,
  // so the tree is reloaded on mount, on focus, and whenever the reader moves to
  // another page - a menu that quietly lags a rename is worse than an extra GET.
  const loadDocs = useCallback(() => {
    fetch('/api/documents')
      .then((res) => res.json())
      .then((data) => setDocItems(data.items || []))
      .catch(() => {});
    fetch('/api/document-folders')
      .then((res) => res.json())
      .then((data) => setDocFolders(data.folders || []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs, activeView, searchParams]);

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
      loadDocs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(COMPAT_MATRICES_CHANGED, onCompatChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Reveal whichever section the current page belongs to. This runs only when the
  // URL itself changes, so manually closing a menu does not spring it back open.
  const urlProduct = searchParams.get('product') || '';
  useEffect(() => {
    if (!urlProduct) return;
    setExpandedProduct(urlProduct);
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
    setDocsExpanded(false);
  }, [urlProduct]);

  useEffect(() => {
    if (activeView === 'compatibility') {
      setCompatExpanded(true);
      setExpandedProduct('');
      setCloudInfoExpanded(false);
      setDocsExpanded(false);
    } else if (activeView === 'cloudinfo') {
      setCloudInfoExpanded(true);
      setExpandedProduct('');
      setCompatExpanded(false);
      setDocsExpanded(false);
    } else if (activeView === 'documents') {
      setDocsExpanded(true);
      setExpandedProduct('');
      setCompatExpanded(false);
      setCloudInfoExpanded(false);
    }
  }, [activeView]);

  // The dashboard is simply the page with no query at all, so returning to it
  // means clearing the search params and closing every open menu.
  const goDashboard = () => {
    setExpandedProduct('');
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
    setDocsExpanded(false);
    setSearchParams(new URLSearchParams());
  };

  // Opening or closing a section is only that: the page you are reading stays put.
  // Navigation happens when a combination is clicked, or via Dashboard.
  const handleProductClick = (slug) => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    if (expandedProduct === slug) {
      setExpandedProduct('');
      return;
    }
    setExpandedProduct(slug);
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
    setDocsExpanded(false);
  };

  const handleCombinationClick = (product, combo) => {
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
    setDocsExpanded(false);
    const params = new URLSearchParams(searchParams);
    params.set('product', product);
    params.delete('view');
    params.delete('matrix');
    params.delete('info');
    params.delete('doc');
    params.set('combination', combo);
    setSearchParams(params);
  };

  const handleCompatToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    setCompatExpanded(prev => !prev);
    setExpandedProduct('');
    setCloudInfoExpanded(false);
    setDocsExpanded(false);
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
    setCloudInfoExpanded(prev => !prev);
    setExpandedProduct('');
    setCompatExpanded(false);
    setDocsExpanded(false);
  };

  const handleDocsToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    setDocsExpanded(prev => !prev);
    setExpandedProduct('');
    setCompatExpanded(false);
    setCloudInfoExpanded(false);
  };

  const handleDocClick = (slug) => {
    const params = new URLSearchParams();
    params.set('view', 'documents');
    params.set('doc', slug);
    setSearchParams(params);
  };

  const toggleDocFolder = (id) => setOpenDocFolders((prev) => ({ ...prev, [id]: !prev[id] }));

  // Folders are structure, not permission: everyone can open one and read the
  // names inside. The lock sits on the individual documents.

  // Landing on a document by URL should reveal it: open every folder above it,
  // leaving whatever the reader opened by hand untouched.
  const openDocSlug = searchParams.get('doc') || '';
  useEffect(() => {
    if (activeView !== 'documents' || !openDocSlug) return;
    const doc = docItems.find((d) => d.slug === openDocSlug);
    if (!doc || !doc.folderId) return;
    const ancestors = {};
    let cursor = docFolders.find((f) => f.id === String(doc.folderId));
    while (cursor && !ancestors[cursor.id]) {
      ancestors[cursor.id] = true;
      cursor = cursor.parentId ? docFolders.find((f) => f.id === cursor.parentId) : null;
    }
    setOpenDocFolders((prev) => ({ ...prev, ...ancestors }));
  }, [activeView, openDocSlug, docItems, docFolders]);

  // The Documents menu mirrors the folder tree built in the admin panel.
  // Top-level folders read like product types; everything nested inside reads
  // like the combinations under one. Folders only open and close - a document
  // is what actually navigates.
  const docFoldersIn = (parentId) => docFolders.filter((f) => (f.parentId || '') === (parentId || ''));
  const docsIn = (parentId) => docItems.filter((d) => (d.folderId || '') === (parentId || ''));

  const renderDocFolder = (folder, depth) => {
    const open = !!openDocFolders[folder.id];
    const childCount = docFoldersIn(folder.id).length + docsIn(folder.id).length;
    const top = depth === 0;
    return (
      <li key={folder.id}>
        <button
          className={top
            ? `sidebar-product-btn ${open ? 'active' : ''}`
            : `sidebar-combo-btn sidebar-doc-folder ${open ? 'open' : ''}`}
          style={top ? undefined : { paddingLeft: 14 + (depth - 1) * 14 }}
          onClick={() => toggleDocFolder(folder.id)}
          title={folder.name}
        >
          {top ? (
            <>
              <span className="sidebar-product-icon-label">
                {FOLDER_ICON}
                <span>{folder.name}</span>
              </span>
              <svg
                className={`sidebar-product-icon ${open ? 'expanded' : ''}`}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </>
          ) : (
            <>
              <svg
                className={`sidebar-doc-folder-chevron ${open ? 'expanded' : ''}`}
                width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="sidebar-doc-folder-name">{folder.name}</span>
            </>
          )}
        </button>
        {open && (
          <ul className="sidebar-combos">
            {childCount > 0
              ? renderDocBranch(folder.id, depth + 1)
              : <li className="sidebar-folder-empty" style={{ paddingLeft: 14 + depth * 14 }}>No documents</li>}
          </ul>
        )}
      </li>
    );
  };

  // A document the reader has not been granted is still listed by name - that is
  // how they know to ask for it - and carries a lock; clicking it opens the
  // request instead of the document.
  const renderDocLeaf = (item, depth) => {
    const active = activeView === 'documents' && searchParams.get('doc') === item.slug;
    const locked = !!item.locked;
    const title = locked ? `${item.name} — access required` : item.name;
    if (depth === 0) {
      return (
        <li key={item._id}>
          <button
            className={`sidebar-product-btn ${active ? 'active' : ''} ${locked ? 'sidebar-doc-locked' : ''}`}
            onClick={() => handleDocClick(item.slug)}
            title={title}
          >
            <span className="sidebar-product-icon-label">
              {DOC_ICON}
              <span>{item.name}</span>
            </span>
            {locked && <span className="sidebar-doc-lock">{LOCK_ICON}</span>}
          </button>
        </li>
      );
    }
    return (
      <li key={item._id}>
        <button
          className={`sidebar-combo-btn sidebar-doc-leaf ${active ? 'active' : ''} ${locked ? 'sidebar-doc-locked' : ''}`}
          style={{ paddingLeft: 14 + (depth - 1) * 14 }}
          onClick={() => handleDocClick(item.slug)}
          title={title}
        >
          <span className="sidebar-doc-leaf-name">{item.name}</span>
          {locked && <span className="sidebar-doc-lock">{LOCK_ICON}</span>}
        </button>
      </li>
    );
  };

  const renderDocBranch = (parentId, depth) => (
    <>
      {docFoldersIn(parentId).map((folder) => renderDocFolder(folder, depth))}
      {docsIn(parentId).map((item) => renderDocLeaf(item, depth))}
    </>
  );

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
            {/* Dashboard — the plain "/" view, above everything else */}
            <div className="sidebar-nav-section sidebar-dashboard-section">
              <ul className="sidebar-items">
                <li>
                  <button
                    className={`sidebar-product-btn ${isDashboard ? 'active' : ''}`}
                    onClick={goDashboard}
                    title="Dashboard"
                  >
                    <span className="sidebar-product-icon-label">
                      {HOME_ICON}
                      <span>Dashboard</span>
                    </span>
                  </button>
                </li>
              </ul>
            </div>

            {/* Product Types dropdown section */}
            {hasPermission('productTypes') && (
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
            )}

            {/* Compatibility dropdown section â€” no gap */}
            {hasPermission('compatibility') && compatMatrices.length > 0 && (
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

            {/* Cloud Info dropdown section â€” no gap */}
            {hasPermission('cloudInfo') && cloudInfoItems.length > 0 && (
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

            {/* Documents – always visible; access-gated for users without permission */}
            <div className="sidebar-nav-section">
              <div className="sidebar-nav-header">
                <span className="sidebar-nav-label">Documents</span>
              </div>
              <ul className="sidebar-items">
                {/* Every folder and document name is listed to everyone. The
                    lock sits on each document, which is what access is asked
                    for, one or several at a time. */}
                {docFolders.length === 0 && docItems.length === 0 ? (
                  <li className="sidebar-docs-empty">No documents yet</li>
                ) : (
                  renderDocBranch('', 0)
                )}
              </ul>
            </div>
          </>
        )}

        {collapsed && (
          <ul className="sidebar-items">
            <li>
              <button
                className={`sidebar-product-btn ${isDashboard ? 'active' : ''}`}
                onClick={() => { setCollapsed(false); goDashboard(); }}
                title="Dashboard"
              >
                <span className="sidebar-product-icon-label">{HOME_ICON}</span>
              </button>
            </li>
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
