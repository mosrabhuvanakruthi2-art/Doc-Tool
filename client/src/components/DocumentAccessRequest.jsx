import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';

function DocumentAccessRequest() {
  const { token } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | loading | sent | already | error
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if already requested
    fetch('/api/access-requests', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(() => {}) // only admin can list — ignore
      .catch(() => {});
  }, []);

  const handleRequest = async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes('pending')) { setStatus('already'); return; }
        throw new Error(data.error || 'Failed to send request');
      }
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="doc-access-gate">
      <div className="doc-access-card">
        <div className="doc-access-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {status === 'sent' ? (
          <>
            <h2 className="doc-access-title">Request Sent!</h2>
            <p className="doc-access-desc">Your access request has been sent to the administrator. You'll be notified once it's approved.</p>
          </>
        ) : status === 'already' ? (
          <>
            <h2 className="doc-access-title">Request Pending</h2>
            <p className="doc-access-desc">You already have a pending access request. The administrator will review it shortly.</p>
          </>
        ) : (
          <>
            <h2 className="doc-access-title">Documents Access Required</h2>
            <p className="doc-access-desc">You don't have access to the Documents section. Request access from the administrator.</p>
            {status === 'error' && <p className="doc-access-error">{error}</p>}
            <button
              className="doc-access-btn"
              onClick={handleRequest}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Sending Request...' : 'Request Access'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default DocumentAccessRequest;
