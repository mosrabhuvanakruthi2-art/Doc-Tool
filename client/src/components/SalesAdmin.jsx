import { useState, useEffect, useMemo, useRef } from 'react';
import { useProductConfig } from '../ProductConfigContext';
import { showToast } from './Toast';
import CfLoader from './CfLoader';

// Admin control for what appears on the /sales page. Same layout as the sales
// page (product tabs -> combination -> What Migrates / Limitations), but every
// feature has an on/off switch. Off by default; only switched-on features are
// shown to salespeople.

const toArrow = (name) => String(name || '').replace(/\s+to\s+/i, ' → ');

// For the combination finder: "Slack to Chat", "slack → chat" and "slack chat"
// all normalise to the same words.
const normalizeCombo = (s) => String(s || '').toLowerCase().replace(/→/g, ' ').replace(/\bto\b/g, ' ').replace(/\s+/g, ' ').trim();

function groupByFamily(feats) {
  const m = new Map();
  feats.forEach((f) => {
    const k = (f.family && f.family.trim()) || 'General';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  });
  return [...m.entries()];
}

export default function SalesAdmin() {
  const { productTypes, combinationsByProduct } = useProductConfig();
  const [product, setProduct] = useState('');
  const [combo, setCombo] = useState('');
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('migrates');
  const [query, setQuery] = useState('');
  const [savingIds, setSavingIds] = useState(() => new Set());

  // Combination finder (top-right): searches every product type's combinations.
  const [comboQuery, setComboQuery] = useState('');
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderIdx, setFinderIdx] = useState(0);
  const finderRef = useRef(null);

  const finderResults = useMemo(() => {
    const words = normalizeCombo(comboQuery).split(' ').filter(Boolean);
    if (!words.length) return [];
    const out = [];
    productTypes.forEach((pt) => {
      (combinationsByProduct[pt] || []).forEach((name) => {
        const hay = normalizeCombo(name);
        if (words.every((w) => hay.includes(w))) out.push({ pt, name });
      });
    });
    return out.slice(0, 30);
  }, [comboQuery, productTypes, combinationsByProduct]);

  useEffect(() => {
    const onDown = (e) => { if (finderRef.current && !finderRef.current.contains(e.target)) setFinderOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Jump to a combination, switching product type if needed.
  const openFound = (hit) => {
    if (!hit) return;
    setProduct(hit.pt);
    setCombo(hit.name);
    setView('migrates');
    setQuery('');
    setComboQuery('');
    setFinderOpen(false);
  };

  const onFinderKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFinderIdx((i) => Math.min(i + 1, finderResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFinderIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); openFound(finderResults[finderIdx]); }
    else if (e.key === 'Escape') { setFinderOpen(false); }
  };

  // Default the selected product once the config loads.
  useEffect(() => {
    if (!product && productTypes.length) setProduct(productTypes[0]);
  }, [productTypes, product]);

  // Load every feature for the product (no sales filter — admin sees them all).
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

  const selectProduct = (pt) => { setProduct(pt); setCombo(''); setView('migrates'); setQuery(''); };

  const combos = useMemo(() => {
    const ordered = combinationsByProduct[product] || [];
    const fromFeats = [...new Set(features.map((f) => f.combination).filter(Boolean))];
    const names = [...new Set([...ordered, ...fromFeats])];
    return names.map((name) => {
      const fs = features.filter((f) => f.combination === name);
      return {
        name,
        total: fs.length,
        shown: fs.filter((f) => f.showInSales).length,
      };
    }).filter((c) => c.total > 0);
  }, [product, features, combinationsByProduct]);

  const activeCombo = combo || (combos[0] && combos[0].name) || '';
  const comboFeats = features.filter((f) => f.combination === activeCombo);
  const migrates = comboFeats.filter((f) => f.scope === 'inscope');
  const limits = comboFeats.filter((f) => f.scope === 'outscope');
  const base = view === 'migrates' ? migrates : limits;
  const q = query.trim().toLowerCase();
  const shown = base.filter((f) => !q
    || (f.name || '').toLowerCase().includes(q)
    || (f.description || '').toLowerCase().includes(q)
    || (f.family || '').toLowerCase().includes(q));
  const groups = groupByFamily(shown);

  // Persist a set of features to a new showInSales value with an optimistic update.
  const persist = async (items, value) => {
    const ids = items.filter((f) => !!f.showInSales !== value).map((f) => f.id);
    if (!ids.length) return;
    setSavingIds((prev) => new Set([...prev, ...ids]));
    setFeatures((prev) => prev.map((f) => ids.includes(f.id) ? { ...f, showInSales: value } : f));
    try {
      const results = await Promise.all(ids.map((id) =>
        fetch('/api/features/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showInSales: value }),
        }).then((r) => r.ok)
      ));
      if (results.some((ok) => !ok)) throw new Error('Some updates failed');
      showToast(
        ids.length === 1
          ? (value ? 'Added to sales page' : 'Removed from sales page')
          : `${ids.length} features ${value ? 'added to' : 'removed from'} sales page`,
        'success'
      );
    } catch {
      // Revert on failure.
      setFeatures((prev) => prev.map((f) => ids.includes(f.id) ? { ...f, showInSales: !value } : f));
      showToast('Could not save. Please try again.', 'error');
    } finally {
      setSavingIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
    }
  };

  const shownCount = base.filter((f) => f.showInSales).length;
  const allShown = base.length > 0 && shownCount === base.length;

  return (
    <div className="sales-admin">
      {/* Finder for any combination on the left, then the product-type tabs */}
      <div className="sales-admin-topbar">
        <div className="sales-admin-finder" ref={finderRef}>
          <div className="sales-feature-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              type="text"
              value={comboQuery}
              placeholder="Search all combinations…"
              onChange={(e) => { setComboQuery(e.target.value); setFinderOpen(true); setFinderIdx(0); }}
              onFocus={() => setFinderOpen(true)}
              onKeyDown={onFinderKey}
              aria-label="Search all combinations"
            />
            {comboQuery && <button className="sales-feature-search-clear" onClick={() => { setComboQuery(''); setFinderOpen(false); }} aria-label="Clear">×</button>}
          </div>
          {finderOpen && comboQuery.trim() && (
            <div className="sales-admin-finder-panel" role="listbox">
              {finderResults.length === 0 ? (
                <div className="sales-admin-finder-empty">No combination matches “{comboQuery.trim()}”.</div>
              ) : finderResults.map((hit, i) => (
                <button
                  key={hit.pt + '|' + hit.name}
                  type="button"
                  role="option"
                  aria-selected={i === finderIdx}
                  className={`sales-admin-finder-item${i === finderIdx ? ' active' : ''}`}
                  onMouseEnter={() => setFinderIdx(i)}
                  onClick={() => openFound(hit)}
                >
                  <span className="sales-admin-finder-name">{toArrow(hit.name)}</span>
                  <span className="sales-admin-finder-pt">{hit.pt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sales-tabs sales-admin-tabs">
          {productTypes.map((pt) => (
            <button key={pt} className={`sales-tab${pt === product ? ' active' : ''}`} onClick={() => selectProduct(pt)}>{pt}</button>
          ))}
        </div>
      </div>

      <div className="sales-admin-body">
        {/* Sidebar: combinations */}
        <aside className="sales-admin-sidebar">
          <div className="sales-combo-list">
            {combos.map((c) => (
              <button
                key={c.name}
                className={`sales-combo${c.name === activeCombo ? ' active' : ''}`}
                onClick={() => { setCombo(c.name); setView('migrates'); setQuery(''); }}
              >
                <span className="sales-combo-name">{toArrow(c.name)}</span>
                <span className="sales-combo-count" title={`${c.shown} of ${c.total} shown on sales`}>{c.shown}/{c.total}</span>
              </button>
            ))}
            {!loading && combos.length === 0 && <div className="sales-empty">No combinations yet.</div>}
          </div>
        </aside>

        {/* Main editor */}
        <main className="sales-admin-main">
          {loading ? (
            <CfLoader inline />
          ) : !activeCombo ? (
            <div className="sales-empty-main">Select a combination.</div>
          ) : (
            <>
              <div className="sales-admin-main-head">
                <h3 className="sales-admin-combo">{toArrow(activeCombo)}</h3>
                <div className="sales-feature-search">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input type="text" value={query} placeholder="Search features…" onChange={(e) => setQuery(e.target.value)} aria-label="Search features" />
                  {query && <button className="sales-feature-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button>}
                </div>
              </div>

              <div className="sales-admin-controls">
                <div className="sales-toggle">
                  <button className={`sales-toggle-btn is-good${view === 'migrates' ? ' active' : ''}`} onClick={() => { setView('migrates'); setQuery(''); }}>
                    What Migrates <span className="sales-toggle-count">{migrates.filter((f) => f.showInSales).length}/{migrates.length}</span>
                  </button>
                  <button className={`sales-toggle-btn is-warn${view === 'limits' ? ' active' : ''}`} onClick={() => { setView('limits'); setQuery(''); }}>
                    Limitations <span className="sales-toggle-count">{limits.filter((f) => f.showInSales).length}/{limits.length}</span>
                  </button>
                </div>
                {base.length > 0 && (
                  <div className="sales-admin-bulk-actions">
                    <button className="sales-admin-bulk-btn is-enable" disabled={allShown} onClick={() => persist(base, true)}>Enable all</button>
                    <button className="sales-admin-bulk-btn is-disable" disabled={shownCount === 0} onClick={() => persist(base, false)}>Disable all</button>
                  </div>
                )}
              </div>

              {groups.length === 0 ? (
                <div className="sales-empty-main">{q ? `No features match “${query.trim()}”.` : 'Nothing here.'}</div>
              ) : (
                groups.map(([family, items]) => (
                  <section className="sales-group" key={family}>
                    <h3 className={`sales-group-title ${view === 'migrates' ? 'is-good' : 'is-warn'}`}>{family}</h3>
                    <div className="sales-admin-rows">
                      {items.map((f) => {
                        const on = !!f.showInSales;
                        const busy = savingIds.has(f.id);
                        return (
                          <label key={f.id} className={`sales-admin-row${on ? ' on' : ''}`}>
                            <span className="sales-admin-row-info">
                              <span className="sales-admin-row-name">{f.name}</span>
                              {f.description && <span className="sales-admin-row-desc">{f.description}</span>}
                            </span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={on}
                              aria-label={`Show "${f.name}" on sales page`}
                              className={`sw${on ? ' on' : ''}${busy ? ' busy' : ''}`}
                              onClick={() => persist([f], !on)}
                            >
                              <span className="sw-knob" />
                            </button>
                          </label>
                        );
                      })}
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
