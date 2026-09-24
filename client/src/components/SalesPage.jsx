import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductConfig } from '../ProductConfigContext';
import CfLoader from './CfLoader';

// Sales-facing migration reference. All data is live from the app:
//   scope=inscope  -> "What Migrates" (names only, grouped by family)
//   scope=outscope -> "Limitations"   (name + reason, grouped by family)
// Helps a salesperson quickly tell a client what a combination migrates and what it doesn't.

const toArrow = (name) => String(name || '').replace(/\s+to\s+/i, ' → ');

// Pick an icon for a product type by keyword, with a generic fallback so any
// dynamically-added product type still gets a sensible glyph.
function TabIcon({ name }) {
  const n = String(name || '').toLowerCase();
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (/mail|email|outlook|gmail/.test(n)) return (<svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>);
  if (/message|chat|slack|teams|talk/.test(n)) return (<svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
  if (/content|doc|file|drive|storage/.test(n)) return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>);
  if (/calendar|event|meeting/.test(n)) return (<svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
  if (/contact|people|user|team/.test(n)) return (<svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>);
  return (<svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
}

function groupByFamily(feats) {
  const m = new Map();
  feats.forEach((f) => {
    const k = (f.family && f.family.trim()) || 'General';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  });
  return [...m.entries()];
}

function newestLabel(feats) {
  let best = null;
  feats.forEach((f) => {
    const s = f.updatedAt || f.createdAt;
    if (s && (!best || s > best)) best = s;
  });
  if (!best) return '';
  try {
    return 'Updated on ' + new Date(best).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export default function SalesPage() {
  const { productTypes, combinationsByProduct } = useProductConfig();
  // product + combination live in the URL so the navbar search can drive the
  // selection (and back/forward works). Fall back to the first available.
  const [searchParams, setSearchParams] = useSearchParams();
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('migrates');
  const [query, setQuery] = useState('');

  const product = searchParams.get('product') || productTypes[0] || '';

  const selectProduct = (pt) => { setSearchParams({ product: pt }); setView('migrates'); setQuery(''); };
  const selectCombo = (name) => { setSearchParams({ product, combination: name }); setView('migrates'); setQuery(''); };

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/features?productType=' + encodeURIComponent(product))
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setFeatures(d.features || []); })
      .catch(() => { if (!cancelled) setFeatures([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [product]);

  // Combinations for the product (config order first, then any extras seen in data), with counts.
  const combos = useMemo(() => {
    const ordered = combinationsByProduct[product] || [];
    const fromFeats = [...new Set(features.map((f) => f.combination).filter(Boolean))];
    const names = [...new Set([...ordered, ...fromFeats])];
    return names.map((name) => {
      const fs = features.filter((f) => f.combination === name);
      return {
        name,
        migrates: fs.filter((f) => f.scope === 'inscope').length,
        limits: fs.filter((f) => f.scope === 'outscope').length,
      };
    });
  }, [product, features, combinationsByProduct]);

  const combo = searchParams.get('combination') || (combos[0] && combos[0].name) || '';
  const comboFeats = features.filter((f) => f.combination === combo);
  const migrates = comboFeats.filter((f) => f.scope === 'inscope');
  const limits = comboFeats.filter((f) => f.scope === 'outscope');
  const q = query.trim().toLowerCase();
  const match = (f) => !q || (f.name || '').toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q) || (f.family || '').toLowerCase().includes(q);
  const shown = (view === 'migrates' ? migrates : limits).filter(match);
  const groups = groupByFamily(shown);
  const updated = newestLabel(comboFeats);

  return (
    <div className="sales-page">
      <div className="sales-body">
        {/* Sidebar: product-type tabs on top, then combinations */}
        <aside className="sales-sidebar">
          <div className="sales-tabs">
            {productTypes.map((pt) => (
              <button
                key={pt}
                className={`sales-tab${pt === product ? ' active' : ''}`}
                onClick={() => selectProduct(pt)}
              ><TabIcon name={pt} />{pt}</button>
            ))}
          </div>
          <div className="sales-combo-list">
            {combos.map((c) => (
              <button
                key={c.name}
                className={`sales-combo${c.name === combo ? ' active' : ''}`}
                onClick={() => selectCombo(c.name)}
              >
                <span className="sales-combo-name">{toArrow(c.name)}</span>
                <span className="sales-combo-count" title={`${c.migrates} migrate · ${c.limits} limitations`}>{c.migrates}</span>
              </button>
            ))}
            {!loading && combos.length === 0 && (
              <div className="sales-empty">No combinations yet.</div>
            )}
          </div>
        </aside>

        {/* Main panel */}
        <main className="sales-main">
          {loading ? (
            <CfLoader inline />
          ) : !combo ? (
            <div className="sales-empty-main">Select a combination to see what migrates.</div>
          ) : (
            <>
              <div className="sales-main-head">
                <div className="sales-head-left">
                  <h1 className="sales-title">{toArrow(combo)}</h1>
                  {updated && <span className="sales-updated">{updated}</span>}
                </div>
                <div className="sales-feature-search">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={query}
                    placeholder="Search this combination…"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search this combination"
                  />
                  {query && <button className="sales-feature-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button>}
                </div>
              </div>

              <div className="sales-toggle">
                <button className={`sales-toggle-btn is-good${view === 'migrates' ? ' active' : ''}`} onClick={() => setView('migrates')}>
                  What Migrates <span className="sales-toggle-count">{migrates.length}</span>
                </button>
                <button className={`sales-toggle-btn is-warn${view === 'limits' ? ' active' : ''}`} onClick={() => setView('limits')}>
                  Limitations <span className="sales-toggle-count">{limits.length}</span>
                </button>
              </div>

              {groups.length === 0 ? (
                <div className="sales-empty-main">
                  {q
                    ? `No ${view === 'migrates' ? 'migrate items' : 'limitations'} match “${query.trim()}”.`
                    : view === 'migrates' ? 'No migrate items recorded for this combination.' : 'No limitations recorded — everything migrates. 🎉'}
                </div>
              ) : view === 'migrates' ? (
                groups.map(([family, items]) => (
                  <section className="sales-group" key={family}>
                    <h3 className="sales-group-title is-good">{family}</h3>
                    <div className="sales-chip-row">
                      {items.map((f) => (
                        <span className="sales-chip sales-chip-good" key={f.id || f._id || f.name}>{f.name}</span>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                groups.map(([family, items]) => (
                  <section className="sales-group" key={family}>
                    <h3 className="sales-group-title is-warn">{family}</h3>
                    <div className="sales-chip-row">
                      {items.map((f) => (
                        <span
                          className={`sales-chip sales-chip-warn${f.description ? ' has-tip' : ''}`}
                          key={f.id || f._id || f.name}
                          tabIndex={f.description ? 0 : undefined}
                        >
                          {f.name}
                          {f.description && <span className="sales-chip-tip" role="tooltip">{f.description}</span>}
                        </span>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
