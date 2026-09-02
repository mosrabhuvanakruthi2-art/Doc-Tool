// Client-side audit beacons.
//
// The export buttons build their file in the browser, so the server never sees the
// download and cannot log it. This tells it one happened.
//
// Fire-and-forget on purpose: a failed audit call must never stop a user getting
// their file, so nothing here is awaited by the caller and errors are swallowed.
export function reportDownload(kind, format, info = {}) {
  try {
    fetch('/api/audit/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, format, ...info }),
      keepalive: true, // survives the navigation a download can trigger
    }).catch(() => {});
  } catch {
    // ignore
  }
}

// Signing out clears the token locally, so the server would never see it. Sent
// before the token is discarded, and awaited by the caller only long enough to
// leave: keepalive lets it finish after the page changes.
export function reportLogout(surface) {
  try {
    fetch('/api/audit/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never block signing out
  }
}
