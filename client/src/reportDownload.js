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
