// Live "content changed" stream (Server-Sent Events).
//
// Every signed-in browser tab holds one open GET /api/live. When an admin
// successfully creates, edits, reorders or deletes content, the kinds of content
// that changed ("features", "documents", ...) are pushed to every tab, which then
// re-fetches just those lists through its normal, access-checked endpoints.
//
// Security: a message carries topic names only — never ids, names or content —
// so it reveals nothing a caller could not already see. What each reader then
// receives is decided by the same per-route authorization as before.
//
// Scope: connections live in this process's memory, which matches the single
// server container this app runs as. Several server instances would each need to
// relay events (e.g. via Redis pub/sub) to reach tabs connected to the others.

// Keeps proxies (nginx default 60s) from closing idle streams, and lets the
// browser detect a dead connection: the client reconnects after ~3 missed beats.
const HEARTBEAT_MS = 15000;
const COALESCE_MS = 400;    // bundle bursts (bulk upload, reorder) into one message

const clients = new Set();
let pending = new Set();
let flushTimer = null;

// Open a stream for this request. The caller has already been authenticated.
function attach(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx honours this per response, so the stream is not buffered and no
    // proxy configuration has to change.
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const client = { res };
  clients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { /* closed; cleaned up below */ }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

function flush() {
  flushTimer = null;
  if (!pending.size) return;
  const message = `event: change\ndata: ${JSON.stringify({ topics: [...pending], at: Date.now() })}\n\n`;
  pending = new Set();
  for (const client of clients) {
    try { client.res.write(message); } catch (_) { clients.delete(client); }
  }
}

// Queue topics for the next coalesced broadcast.
function publish(topics) {
  for (const t of topics) pending.add(t);
  if (!flushTimer) flushTimer = setTimeout(flush, COALESCE_MS);
}

const ALL_CONTENT = ['productConfig', 'features', 'compatibility', 'cloudInfo', 'documents'];

// Which kinds of content a successful write to this path changes. Anything not
// listed (sign-in, audit writes, notification read-state, uploads that are not
// yet attached to anything) changes no shared content and broadcasts nothing.
function topicsForWrite(method, path) {
  if (/^\/api\/(auth|admin\/login|audit|notifications|client-errors|doc-file|live|internal|screenshots|image-proxy)(\/|$)/.test(path)) return [];
  if (path.startsWith('/api/access-requests')) return method === 'PUT' ? ['access'] : []; // approve / deny / revoke
  if (path.startsWith('/api/users')) return ['access'];
  if (path.startsWith('/api/features')) return ['features'];
  if (path.startsWith('/api/product-config') || /(^|\/)product-types\//.test(path)) return ['productConfig', 'features'];
  if (path.startsWith('/api/categories')) return ['productConfig'];
  if (path.startsWith('/api/compatibility')) return ['compatibility'];
  if (path.startsWith('/api/cloud-info')) return ['cloudInfo'];
  if (path.startsWith('/api/document')) return ['documents']; // documents + document-folders
  if (path.startsWith('/api/trash')) return ALL_CONTENT;       // restore / purge can touch anything
  return [];
}

// Express middleware: after a write succeeds, broadcast what it changed.
function broadcastWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const topics = topicsForWrite(req.method, req.originalUrl.split('?')[0]);
  if (topics.length) {
    res.on('finish', () => {
      if (res.statusCode < 400) publish(topics);
    });
  }
  next();
}

module.exports = { attach, publish, broadcastWrites, topicsForWrite, clientCount: () => clients.size };
