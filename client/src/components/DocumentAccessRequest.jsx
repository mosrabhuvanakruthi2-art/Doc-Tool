import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';

// The screen a locked document opens.
//
// Access is per document, so this asks for the one that was clicked - and, since
// somebody who needs one document in a folder usually needs several, it lists
// every other locked document in the same folder with a checkbox and sends the
// whole selection as one request.
function DocumentAccessRequest({ documentId = '', documentName = '', folderId = '', folderName = '' }) {
  const { token } = useAuth();
  const [docs, setDocs] = useState([]);
  const [mine, setMine] = useState([]);
  const [picked, setPicked] = useState(() => (documentId ? { [documentId]: true } : {}));
  const [status, setStatus] = useState('loading'); // loading | idle | sending | sent | error
  const [sentNames, setSentNames] = useState([]);
  const [error, setError] = useState('');

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([
      fetch('/api/documents', { headers: authHeaders }).then(r => r.json()).catch(() => ({ items: [] })),
      fetch('/api/access-requests/mine', { headers: authHeaders }).then(r => r.json()).catch(() => ({ requests: [] })),
    ]).then(([docData, mineData]) => {
      if (cancelled) return;
      setDocs(docData.items || []);
      setMine(mineData.requests || []);
      setStatus('idle');
    });
    return () => { cancelled = true; };
  }, [documentId]);

  // The pending/approved state of each document for this reader.
  const stateOf = useMemo(() => {
    const map = new Map();
    mine.forEach((r) => {
      if (!r.documentId) return;
      const seen = map.get(r.documentId);
      if (!seen) map.set(r.documentId, r.status);
    });
    return map;
  }, [mine]);

  // Locked documents in the same folder as the one that was clicked.
  const siblings = useMemo(() => {
    const here = String(folderId || '');
    return docs.filter(d => d.locked && String(d.folderId || '') === here);
  }, [docs, folderId]);

  const askable = siblings.filter(d => stateOf.get(d._id) !== 'pending');
  const allPicked = askable.length > 0 && askable.every(d => picked[d._id]);
  const chosen = Object.keys(picked).filter(id => picked[id]);

  const toggle = (id) => setPicked(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleAll = () => {
    if (allPicked) { setPicked({}); return; }
    const next = {};
    askable.forEach(d => { next[d._id] = true; });
    setPicked(next);
  };

  const submit = async () => {
    if (!chosen.length) return;
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ documentIds: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      setSentNames(data.documents || []);
      setStatus('sent');
      // Reflect the new pending state if the reader stays on the page.
      fetch('/api/access-requests/mine', { headers: authHeaders })
        .then(r => r.json())
        .then(d => setMine(d.requests || []))
        .catch(() => {});
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const clickedPending = documentId && stateOf.get(documentId) === 'pending';

  return (
    <div className="doc-access-gate">
      <div className="doc-access-card doc-access-card-wide">
        <div className="doc-access-icon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {status === 'sent' ? (
          <>
            <h2 className="doc-access-title">Request sent</h2>
            <p className="doc-access-desc">
              {sentNames.length > 1
                ? `Your request for ${sentNames.length} documents has been sent to the administrator.`
                : 'Your request has been sent to the administrator.'}
              {' '}You'll be notified once it's approved.
            </p>
            {sentNames.length > 0 && (
              <ul className="doc-access-sent-list">
                {sentNames.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </>
        ) : (
          <>
            <h2 className="doc-access-title">
              {documentName ? `"${documentName}" is locked` : 'Access required'}
            </h2>
            <p className="doc-access-desc">
              {clickedPending
                ? 'You already have a pending request for this document.'
                : 'You don’t have access to this document yet.'}
              {folderName ? ` It lives in ${folderName}.` : ''}
            </p>

            {status === 'loading' ? (
              <p className="doc-access-desc">Loading…</p>
            ) : (
              <>
                {siblings.length > 1 && (
                  <div className="doc-access-pick-header">
                    <span>Request access to:</span>
                    <button type="button" className="doc-access-selectall" onClick={toggleAll}>
                      {allPicked ? 'Clear all' : `Select all ${askable.length} in this folder`}
                    </button>
                  </div>
                )}

                <ul className="doc-access-pick-list">
                  {siblings.map((d) => {
                    const state = stateOf.get(d._id);
                    const pending = state === 'pending';
                    return (
                      <li key={d._id} className={pending ? 'is-pending' : ''}>
                        <label>
                          <input
                            type="checkbox"
                            checked={!!picked[d._id] && !pending}
                            disabled={pending}
                            onChange={() => toggle(d._id)}
                          />
                          <span className="doc-access-pick-name">{d.name}</span>
                          {pending && <span className="doc-access-pick-tag">Pending</span>}
                          {state === 'denied' && <span className="doc-access-pick-tag denied">Previously denied</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>

                {status === 'error' && <p className="doc-access-error">{error}</p>}

                <button
                  className="doc-access-btn"
                  onClick={submit}
                  disabled={status === 'sending' || chosen.length === 0}
                >
                  {status === 'sending'
                    ? 'Sending…'
                    : chosen.length > 1
                      ? `Request access to ${chosen.length} documents`
                      : 'Request access'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DocumentAccessRequest;
