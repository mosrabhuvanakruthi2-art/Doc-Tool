import { useState, useEffect, useCallback } from 'react';
import CfLoader from './CfLoader';

// Admin view of who did what, and when. Everything the server records — sign-ins,
// access requests and their decisions, user administration, content edits, uploads,
// trash operations and internal API downloads — filtered from one bar.

// A readable label per action, so the filter is not a list of dotted identifiers.
const ACTION_LABEL = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.admin_login': 'Opened Admin Panel',
  'auth.admin_login_failed': 'Admin sign-in failed',
  'auth.microsoft_login': 'Signed in with Microsoft',
  'access_request.created': 'Requested Documents access',
  'access_request.approved': 'Access approved',
  'access_request.denied': 'Access denied',
  'access_request.revoked': 'Access revoked',
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.deleted': 'User deleted',
  'user.auto_created': 'User auto-created',
  'content.created': 'Content added',
  'content.updated': 'Content updated',
  'content.deleted': 'Content deleted',
  'content.restored': 'Content restored',
  'content.restored_from_trash': 'Restored from Trash',
  'content.permanently_deleted': 'Permanently deleted',
  'content.bulk_created': 'Bulk added',
  'content.bulk_updated': 'Bulk updated',
  'content.bulk_deleted': 'Bulk deleted',
  'upload.screenshots': 'Screenshots uploaded',
  'api.word_doc_downloaded': 'Word doc downloaded (API)',
};

const TARGET_LABEL = {
  feature: 'Feature',
  compatibility: 'Compatibility',
  cloudInfo: 'Cloud Info',
  document: 'Document',
  productConfig: 'Product type',
  user: 'User',
  accessRequest: 'Access request',
  screenshot: 'Screenshot',
  features: 'Features',
};

// Category and person are intentionally not offered as dropdowns: the action list
// already implies the category, and the search box matches on who did it.
const EMPTY_FILTERS = {
  q: '', action: '', outcome: '', from: '', to: '',
};

function formatWhen(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function relative(value) {
  const then = new Date(value).getTime();
  if (isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function AuditLog() {
  const token = localStorage.getItem('admin_token') || '';

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const [data, setData] = useState({ logs: [], total: 0, pages: 1 });
  const [options, setOptions] = useState({ actions: [], categories: [], actors: [], total: 0, trackingSince: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const queryString = useCallback((extra = {}) => {
    const params = new URLSearchParams();
    Object.entries({ ...applied, page, limit, ...extra }).forEach(([k, v]) => {
      if (v !== '' && v != null) params.set(k, v);
    });
    return params.toString();
  }, [applied, page, limit]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/audit-logs?${queryString()}`, { headers: authHeaders });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load the audit log');
      setData(body);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [queryString, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/audit-logs/filters', { headers: authHeaders })
      .then(r => r.json())
      .then(body => { if (!body.error) setOptions(body); })
      .catch(() => {});
  }, [token]);

  const activeCount = Object.entries(applied).filter(([, v]) => v !== '').length;

  const clear = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const set = (key) => (e) => setFilters(prev => ({ ...prev, [key]: e.target.value }));

  // Filters apply themselves. Typing is debounced so a search does not fire a
  // request per keystroke; dropdowns and dates feel immediate at this delay.
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(prev => (JSON.stringify(prev) === JSON.stringify(filters) ? prev : filters));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  // Quick range buttons — the common questions are "today" and "this week".
  const quickRange = (days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    const iso = (d) => d.toISOString().slice(0, 10);
    setFilters(prev => ({ ...prev, from: iso(from), to: iso(to) }));
  };

  // Fetched rather than opened in a tab: a plain navigation cannot carry the
  // Authorization header, and the export route is admin-only.
  const exportCsv = async () => {
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      const res = await fetch(`/api/audit-logs/export?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="audit">
      <div className="audit-header">
        <div>
          <h2 className="audit-title">Audit Logs</h2>
          <p className="audit-sub">
            {options.total.toLocaleString()} recorded {options.total === 1 ? 'event' : 'events'}
            {options.trackingSince && ` · tracking since ${formatWhen(options.trackingSince)}`}
          </p>
        </div>
        <div className="audit-header-actions">
          <button className="audit-btn" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="audit-btn audit-btn-primary" onClick={exportCsv} disabled={!data.total}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="audit-filters">
        <input
          className="audit-search"
          placeholder="Search person, action, or what was changed…"
          value={filters.q}
          onChange={set('q')}
        />

        <select className="audit-select" value={filters.action} onChange={set('action')}>
          <option value="">All actions</option>
          {options.actions.map(a => (
            <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>
          ))}
        </select>

        <select className="audit-select audit-select-sm" value={filters.outcome} onChange={set('outcome')}>
          <option value="">Any result</option>
          <option value="success">Succeeded</option>
          <option value="failure">Failed</option>
        </select>

        <div className="audit-dates">
          <input type="date" className="audit-date" value={filters.from} onChange={set('from')} title="From" />
          <span className="audit-date-sep">→</span>
          <input type="date" className="audit-date" value={filters.to} onChange={set('to')} title="To" />
        </div>

        {activeCount > 0 && (
          <button className="audit-btn audit-btn-ghost" onClick={clear}>Clear ({activeCount})</button>
        )}
      </div>

      <div className="audit-quick">
        <span className="audit-quick-label">Quick range:</span>
        <button className="audit-chip" onClick={() => quickRange(0)}>Today</button>
        <button className="audit-chip" onClick={() => quickRange(7)}>Last 7 days</button>
        <button className="audit-chip" onClick={() => quickRange(30)}>Last 30 days</button>
      </div>

      {error && <div className="audit-error">{error}</div>}

      {loading && !data.logs.length ? (
        <CfLoader inline />
      ) : !data.logs.length ? (
        <div className="audit-empty">
          No events match these filters.
          <span className="audit-empty-hint">
            Recording starts from when audit logging was switched on — anything before that is not held here.
          </span>
        </div>
      ) : (
        <>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th className="audit-col-when">When</th>
                  <th className="audit-col-who">Who</th>
                  <th className="audit-col-action">Action</th>
                  <th className="audit-col-what">What happened</th>
                  <th className="audit-col-ip">From</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(log => {
                  const isOpen = expanded === log.id;
                  const hasDetails = log.details && Object.keys(log.details).length > 0;
                  return (
                    <>
                      <tr
                        key={log.id}
                        className={`audit-row ${log.outcome === 'failure' ? 'audit-row-failure' : ''} ${hasDetails ? 'audit-row-clickable' : ''}`}
                        onClick={() => hasDetails && setExpanded(isOpen ? null : log.id)}
                      >
                        <td className="audit-col-when">
                          <span className="audit-when">{formatWhen(log.at)}</span>
                          <span className="audit-ago">{relative(log.at)}</span>
                        </td>
                        <td className="audit-col-who">
                          <span className="audit-who">{log.actorEmail || '—'}</span>
                          {log.actorRole && <span className={`audit-role audit-role-${log.actorRole}`}>{log.actorRole}</span>}
                        </td>
                        <td className="audit-col-action">
                          <span className={`audit-action audit-cat-${log.category}`}>
                            {ACTION_LABEL[log.action] || log.action}
                          </span>
                          {log.outcome === 'failure' && <span className="audit-failed">failed</span>}
                        </td>
                        <td className="audit-col-what">
                          <span className="audit-summary">{log.summary || '—'}</span>
                          {log.targetType && (
                            <span className="audit-target">
                              {TARGET_LABEL[log.targetType] || log.targetType}
                              {log.targetName ? `: ${log.targetName}` : ''}
                            </span>
                          )}
                          {hasDetails && <span className="audit-more">{isOpen ? 'hide details' : 'show details'}</span>}
                        </td>
                        <td className="audit-col-ip">{log.ip || '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${log.id}-details`} className="audit-details-row">
                          <td colSpan="5">
                            <pre className="audit-details">{JSON.stringify(log.details, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="audit-footer">
            <span className="audit-count">
              {((page - 1) * limit) + 1}–{Math.min(page * limit, data.total)} of {data.total.toLocaleString()}
            </span>
            <div className="audit-pager">
              <select
                className="audit-select audit-select-sm"
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              >
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
              <button className="audit-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                Previous
              </button>
              <span className="audit-page">Page {page} of {data.pages}</span>
              <button className="audit-btn" onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AuditLog;
