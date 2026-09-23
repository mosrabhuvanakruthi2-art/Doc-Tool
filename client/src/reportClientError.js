// Reports a frontend failure to the backend so it lands in the Errors tab next
// to backend failures. Best-effort: if the backend is unreachable, the error is
// queued in localStorage and flushed on the next successful report.
//
// Deduped so a render loop can't spam thousands of identical entries.

const QUEUE_KEY = 'client_error_queue';
const recent = new Map(); // signature -> timestamp

function seenRecently(sig) {
  const now = Date.now();
  const last = recent.get(sig) || 0;
  recent.set(sig, now);
  // prune
  if (recent.size > 100) for (const [k, t] of recent) if (now - t > 60000) recent.delete(k);
  return now - last < 10000; // same error within 10s -> skip
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20))); } catch { /* ignore */ }
}

async function post(entry) {
  const res = await fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('report failed ' + res.status);
}

export async function flushClientErrorQueue() {
  const q = loadQueue();
  if (!q.length) return;
  const rest = [];
  for (const e of q) {
    try { await post(e); } catch { rest.push(e); }
  }
  saveQueue(rest);
}

export function reportClientError(input = {}) {
  const entry = {
    source: 'frontend',
    category: input.category || 'frontend',
    message: String(input.message || 'Unknown client error').slice(0, 2000),
    reason: String(input.reason || input.message || '').slice(0, 2000),
    stack: String(input.stack || '').slice(0, 8000),
    route: (typeof location !== 'undefined' ? location.pathname + location.search : '') || input.route || '',
    context: input.context,
  };
  const sig = entry.category + '|' + entry.message + '|' + entry.route;
  if (seenRecently(sig)) return;
  post(entry).catch(() => {
    // Backend unreachable: queue and try again later.
    const q = loadQueue();
    q.push(entry);
    saveQueue(q);
  });
}

// Wire the browser-level nets once.
export function installClientErrorReporting() {
  if (window.__clientErrReady) return;
  window.__clientErrReady = true;

  window.addEventListener('error', (e) => {
    // Resource load failure (script/chunk/img) vs a real JS error.
    if (e && e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) {
      reportClientError({ category: 'dependency', message: 'Failed to load resource: ' + (e.target.src || e.target.href || ''), reason: 'A page resource failed to load (deploy/network).' });
      return;
    }
    reportClientError({ category: 'frontend', message: (e && e.message) || 'window error', stack: e && e.error && e.error.stack });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    reportClientError({ category: 'frontend', message: 'Unhandled promise rejection: ' + ((r && r.message) || String(r)), stack: r && r.stack });
  });

  // Try to flush anything queued while the backend was down.
  flushClientErrorQueue();
  window.addEventListener('online', flushClientErrorQueue);
}
