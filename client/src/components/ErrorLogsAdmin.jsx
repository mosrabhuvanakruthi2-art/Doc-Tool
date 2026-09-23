import { useState, useEffect, useCallback } from 'react';
import { showToast } from './Toast';

const KINDS = [
  { key: 'code', label: 'Code / Server' },
  { key: 'human', label: 'Human / Expected' },
  { key: 'all', label: 'All' },
];

// Friendly one-word labels for each category.
const CAT_LABEL = {
  validation: 'Validation', auth: 'Auth', permission: 'Permission', conflict: 'Conflict',
  payload: 'Payload', ratelimit: 'Rate limit', notfound: 'Not found', client: 'Client',
  server: 'Server error', dependency: 'Dependency', 'silent-failure': 'Silent failure',
  frontend: 'Frontend', unknown: 'Unknown',
};

function fmt(t) {
  try { return new Date(t).toLocaleString(); } catch { return t; }
}

export default function ErrorLogsAdmin() {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ total: 0, codeCount: 0 });
  const [kind, setKind] = useState('code');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [health, setHealth] = useState(null); // { ok, mongo } | 'down'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch('/api/error-logs?' + params.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setItems(data.items || []);
      setCounts({ total: data.total || 0, codeCount: data.codeCount || 0 });
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  }, [kind, q]);

  useEffect(() => { load(); }, [load]);

  // Backend reachability indicator.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try { const r = await fetch('/api/health'); const d = await r.json(); if (alive) setHealth(d); }
      catch { if (alive) setHealth('down'); }
    };
    ping();
    const t = setInterval(ping, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const clearAll = async () => {
    if (!window.confirm('Delete all error entries?')) return;
    try {
      const res = await fetch('/api/error-logs', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast(`Cleared ${data.deleted} entries`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <div className="error-logs">
      <div className="error-logs-header">
        <div>
          <h2 className="scope-form-title">Errors</h2>
          <p className="error-logs-sub">
            {counts.codeCount} code/server issue{counts.codeCount !== 1 ? 's' : ''} · {counts.total} total logged
          </p>
        </div>
        <div className="error-logs-head-actions">
          <span className={`error-health ${health === 'down' ? 'down' : health ? 'up' : ''}`}>
            <span className="error-health-dot" />
            {health === 'down' ? 'Backend unreachable' : health ? `Backend OK · DB ${health.mongo}` : 'Checking…'}
          </span>
          <button className="btn-secondary" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button className="btn-delete-inline" onClick={clearAll}>Clear</button>
        </div>
      </div>

      <div className="error-logs-filters">
        {KINDS.map(k => (
          <button key={k.key} className={`error-kind-tab ${kind === k.key ? 'active' : ''}`} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
        <input className="error-search" placeholder="Search reason, route, ref, user…" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
      </div>

      {items.length === 0 ? (
        <p className="cloud-info-empty">{loading ? 'Loading…' : 'No errors logged for this filter. 🎉'}</p>
      ) : (
        <div className="error-table">
          <div className="error-row error-row-head">
            <span>When</span><span>Kind</span><span>Category</span><span>Where</span><span>Reason</span><span>Ref</span>
          </div>
          {items.map(it => (
            <div key={it.id}>
              <div className={`error-row error-row-${it.kind}`} onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                <span className="error-when">{fmt(it.at)}</span>
                <span><span className={`error-badge error-badge-${it.kind}`}>{it.kind === 'code' ? 'CODE' : 'HUMAN'}</span></span>
                <span>{CAT_LABEL[it.category] || it.category}</span>
                <span className="error-where">
                  <span className={`error-src error-src-${it.source}`}>{it.source}</span>
                  {it.status ? ' ' + it.status : ''} {it.method !== 'CLIENT' ? it.route : ''}
                </span>
                <span className="error-reason" title={it.reason || it.message}>{it.reason || it.message}</span>
                <span className="error-ref">{it.refId}</span>
              </div>
              {expanded === it.id && (
                <div className="error-detail">
                  {it.route && <div><strong>Route:</strong> {it.method} {it.route}</div>}
                  {it.actorEmail && <div><strong>User:</strong> {it.actorEmail}</div>}
                  {it.message && <div><strong>Message:</strong> {it.message}</div>}
                  {it.context && <div><strong>Context:</strong> <code>{JSON.stringify(it.context)}</code></div>}
                  {it.stack && <pre className="error-stack">{it.stack}</pre>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
