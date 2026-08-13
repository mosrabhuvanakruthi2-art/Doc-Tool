import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const POLL_MS = 60000;

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function NotificationBell() {
  const { token } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setUnread(data.unreadCount || 0);
    } catch { /* offline — keep whatever we last had */ }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Opening one notification clears only that one, so the count goes down by one
  // and everything else stays waiting for you.
  const markOne = async (item) => {
    if (!item.unread) return;
    setItems(prev => prev.map(i => (i.key === item.key ? { ...i, unread: false } : i)));
    setUnread(n => Math.max(0, n - 1));
    if (!token) return;
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Dismiss only up to the change shown, so anything newer stays unread.
        body: JSON.stringify({ key: item.key, at: item.at }),
      });
    } catch { /* cleared locally regardless */ }
  };

  const markAll = async () => {
    if (!unread) return;
    setItems(prev => prev.map(i => ({ ...i, unread: false })));
    setUnread(0);
    if (!token) return;
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* cleared locally regardless */ }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const openItem = (item) => {
    markOne(item);
    if (!item.link) return;
    setOpen(false);
    const params = new URLSearchParams();
    Object.entries(item.link).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setSearchParams(params);
  };

  if (!token) return null;

  return (
    <div className="notif" ref={panelRef}>
      <button
        className="notif-btn"
        onClick={toggle}
        title={unread ? `${unread} update${unread > 1 ? 's' : ''} since your last visit` : 'Notifications'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>
              Notifications
              {unread > 0 && <span className="notif-panel-count">{unread} new</span>}
            </span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={markAll}>Mark all as read</button>
            )}
          </div>

          <div className="notif-list">
            {loading && !items.length && <div className="notif-empty">Loading…</div>}

            {!loading && !items.length && (
              <div className="notif-empty">
                No updates yet.
                <span className="notif-empty-hint">
                  You will be notified here when content you have access to changes.
                </span>
              </div>
            )}

            {items.map(item => (
              <button
                key={item.key}
                className={`notif-item ${item.unread ? 'notif-item-unread' : ''}`}
                onClick={() => openItem(item)}
                title={item.link ? 'Open and mark as read' : 'Mark as read'}
              >
                <span className="notif-item-msg">
                  {item.unread && <span className="notif-dot" aria-hidden="true" />}
                  {item.message}
                </span>
                <span className="notif-item-meta">
                  {timeAgo(item.at)}
                  {item.count > 1 && <span className="notif-item-count">{item.count} changes</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
