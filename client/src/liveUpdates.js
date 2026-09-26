import { useEffect, useRef } from 'react';
import { AUTH_CHANGED } from './authEvents';

// Live updates: keep one GET /api/live stream open per visible tab. The server
// pushes the kinds of content an admin just changed ("features", "documents",
// ...); screens subscribe with useContentChanged() and quietly re-fetch.
//
// fetch() is used instead of EventSource because EventSource cannot send the
// Authorization header, and putting the session token in a URL would leak it
// into logs. The global fetch wrapper (apiAuth.js) adds the token.

export const CONTENT_CHANGED = 'doctool:content-changed';
export const ALL_TOPICS = ['productConfig', 'features', 'compatibility', 'cloudInfo', 'documents', 'access'];

const HIDDEN_DISCONNECT_MS = 30000;          // close the stream once a tab has been hidden this long
// The server sends a heartbeat every 15s. A connection can die silently (server
// killed behind a proxy, laptop sleep, network switch) without ever closing, so
// if nothing arrives for this long the stream is treated as dead and reopened.
const STALE_MS = 45000;
const CONNECT_TIMEOUT_MS = 15000;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 15000]; // capped so tabs recover soon after a redeploy

function emit(topics) {
  window.dispatchEvent(new CustomEvent(CONTENT_CHANGED, { detail: { topics } }));
}

let running = false;
let controller = null;     // AbortController of the current stream
let retryTimer = null;
let hiddenTimer = null;
let attempt = 0;
let connectedOnce = false; // a later (re)connect may have missed events -> resync
let authBlocked = false;   // server said 401: wait for a sign-in instead of retrying

function clearTimers() {
  clearTimeout(retryTimer);
  clearTimeout(hiddenTimer);
  retryTimer = null;
  hiddenTimer = null;
}

function disconnect() {
  if (controller) controller.abort();
  controller = null;
}

function scheduleRetry() {
  if (!running || authBlocked || document.hidden) return;
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  retryTimer = setTimeout(connect, base + Math.random() * 500);
}

async function connect() {
  if (!running || controller || document.hidden) return;
  const ctrl = new AbortController();
  controller = ctrl;
  let stale = false;      // we aborted it ourselves because it went silent -> reconnect
  let watchdog = null;
  const connectTimer = setTimeout(() => { stale = true; ctrl.abort(); }, CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch('/api/live', {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
    });
    clearTimeout(connectTimer);
    if (res.status === 401) { authBlocked = true; return; }
    if (!res.ok || !res.body) throw new Error('live stream unavailable');

    let lastData = Date.now();
    watchdog = setInterval(() => {
      if (Date.now() - lastData > STALE_MS) { stale = true; ctrl.abort(); }
    }, 5000);

    attempt = 0;
    // Anything that changed while we were disconnected was missed: refresh all.
    if (connectedOnce) emit(ALL_TOPICS);
    connectedOnce = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lastData = Date.now(); // heartbeat or event: the connection is alive
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (event === 'change' && data) {
          try {
            const { topics } = JSON.parse(data);
            if (Array.isArray(topics) && topics.length) emit(topics);
          } catch (_) { /* malformed message: ignore */ }
        }
      }
    }
  } catch (_) {
    // Aborted on purpose, network drop, or server restart — handled below.
  } finally {
    clearTimeout(connectTimer);
    clearInterval(watchdog);
    if (controller === ctrl) controller = null;
  }
  // Reconnect after a drop or a silent (stale) stream — but not after a
  // deliberate disconnect (tab hidden, sign-out, stopLiveUpdates).
  if (!ctrl.signal.aborted || stale) scheduleRetry();
}

function onVisibility() {
  if (document.hidden) {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(disconnect, HIDDEN_DISCONNECT_MS);
  } else {
    clearTimeout(hiddenTimer);
    if (!controller) { attempt = 0; clearTimeout(retryTimer); connect(); }
  }
}

function onAuthChanged() {
  // New (or no) token: reconnect so the stream runs as the current user.
  authBlocked = false;
  attempt = 0;
  clearTimeout(retryTimer);
  disconnect();
  connect();
}

export function startLiveUpdates() {
  if (running) return stopLiveUpdates;
  running = true;
  authBlocked = false;
  attempt = 0;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener(AUTH_CHANGED, onAuthChanged);
  connect();
  return stopLiveUpdates;
}

export function stopLiveUpdates() {
  running = false;
  connectedOnce = false;
  clearTimers();
  disconnect();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener(AUTH_CHANGED, onAuthChanged);
}

// Keep the stream open while `enabled` is true (signed-in reader pages).
export function useLiveUpdates(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    return startLiveUpdates();
  }, [enabled]);
}

// True when two fetched records are the same version, so a live refresh can
// keep the one already on screen. Compares updatedAt (every content model has
// timestamps) rather than the whole object, because some responses carry values
// that differ on each request — e.g. a document's short-lived signed file URL —
// and swapping those would needlessly reload an open PDF or video.
export function sameVersion(a, b) {
  if (!a || !b) return false;
  if (a.updatedAt && b.updatedAt) {
    return String(a._id || a.id) === String(b._id || b.id) && String(a.updatedAt) === String(b.updatedAt);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// Run `handler` when any of `topics` changes. Calls within `delay` ms are merged,
// and the latest handler is always used, so it can read current props/state.
export function useContentChanged(topics, handler, delay = 250) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = topics.join(',');

  useEffect(() => {
    const wanted = key.split(',');
    let timer = null;
    const onChange = (e) => {
      const changed = (e.detail && e.detail.topics) || [];
      if (!changed.some((t) => wanted.includes(t))) return;
      clearTimeout(timer);
      timer = setTimeout(() => handlerRef.current(), delay);
    };
    window.addEventListener(CONTENT_CHANGED, onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CONTENT_CHANGED, onChange);
    };
  }, [key, delay]);
}
