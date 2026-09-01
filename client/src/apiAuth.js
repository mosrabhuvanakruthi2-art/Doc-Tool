// Attaches the signed-in user's token to same-origin /api requests.
//
// The content routes (features, compatibility, cloud info, documents) do not require
// authentication, so the editing screens were never written to send a token. Version
// history needs to know WHO made a change, and the token is the only place that
// identity exists. Rather than editing every one of the ~40 write calls spread across
// the admin components, the header is added in one place here.
//
// An explicit Authorization already set by the caller always wins.
export function installApiAuth() {
  const original = window.fetch;

  window.fetch = function patchedFetch(input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const sameOriginApi = url.startsWith('/api/')
        || url.startsWith(`${window.location.origin}/api/`);

      if (sameOriginApi) {
        // Admin edits carry admin_token; a signed-in reader carries docs_token.
        const token = localStorage.getItem('admin_token') || sessionStorage.getItem('docs_token');
        if (token) {
          const headers = new Headers(
            (init && init.headers) || (input instanceof Request ? input.headers : undefined)
          );
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
            return original(input, { ...init, headers });
          }
        }
      }
    } catch {
      // Never let this get in the way of the request itself.
    }
    return original(input, init);
  };
}
