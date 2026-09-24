import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';

const TYPE_LABEL = {
  combination: 'Combination',
  feature: 'Feature',
  compatibility: 'Compatibility',
  cloudinfo: 'Cloud Info',
  document: 'Document',
};

// Global search box for the navbar. Searches everything the signed-in user can
// see (combinations, features, compatibility, cloud info, accessible docs) and
// navigates to the picked result. Restricted documents never appear.
export default function GlobalSearch() {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const timer = useRef(null);
  const abortRef = useRef(null);
  // On the Sales page the navbar search is a combination finder only.
  const onSales = location.pathname === '/sales';

  const run = useCallback(async (text) => {
    if (text.trim().length < 2) { setResults([]); setLoading(false); return; }
    // Cancel any earlier in-flight request so a slow one can't clobber a newer one.
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(text.trim()), { signal: ctrl.signal });
      const data = await res.json();
      if (!ctrl.signal.aborted) {
        let out = res.ok ? (data.results || []) : [];
        if (onSales) out = out.filter((r) => r.type === 'combination'); // sales: combinations only
        setResults(out);
        setLoading(false);
      }
    } catch (e) {
      if (e.name !== 'AbortError') { setResults([]); setLoading(false); }
    }
  }, [onSales]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 220);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, run]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (item) => {
    if (!item) return;
    const params = new URLSearchParams(item.url.split('?')[1] || '');
    if (onSales) {
      // Stay on /sales and just select that combination (product + combination).
      setSearchParams({ product: params.get('product') || '', combination: params.get('combination') || '' });
    } else if (location.pathname === '/') {
      // Reader: update params in place (same as the sidebar).
      setSearchParams(params);
    } else {
      navigate(item.url);
    }
    setOpen(false);
    setQ('');
    setResults([]);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { go(results[active >= 0 ? active : 0]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="global-search" ref={boxRef}>
      <div className="global-search-input">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={q}
          placeholder={onSales ? 'Search combinations…' : 'Search…'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search"
        />
        {q && <button className="global-search-clear" onClick={() => { setQ(''); setResults([]); }} aria-label="Clear">×</button>}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="global-search-panel">
          {loading && <div className="global-search-empty">Searching…</div>}
          {!loading && results.length === 0 && <div className="global-search-empty">No matches for “{q.trim()}”.</div>}
          {!loading && results.map((r, i) => (
            <button
              key={i}
              className={`global-search-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <span className={`gs-type gs-type-${r.type}`}>{TYPE_LABEL[r.type] || r.type}</span>
              <span className="gs-body">
                <span className="gs-title">{r.title}</span>
                {(r.subtitle || r.snippet) && (
                  <span className="gs-sub">{r.subtitle}{r.subtitle && r.snippet ? ' — ' : ''}{r.snippet}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
