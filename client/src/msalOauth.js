const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || '';
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || 'common';

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function startMicrosoftLogin() {
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(digest);
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

  sessionStorage.setItem('ms_pkce_verifier', verifier);
  sessionStorage.setItem('ms_oauth_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: window.location.origin,
    scope: 'openid profile email User.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  window.location.href =
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`;
}

export async function handleMicrosoftCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    window.history.replaceState({}, '', window.location.pathname);
    throw new Error(params.get('error_description') || error);
  }

  if (!code) return null;

  const savedState = sessionStorage.getItem('ms_oauth_state');
  if (state !== savedState) {
    window.history.replaceState({}, '', window.location.pathname);
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const verifier = sessionStorage.getItem('ms_pkce_verifier');
  sessionStorage.removeItem('ms_pkce_verifier');
  sessionStorage.removeItem('ms_oauth_state');
  window.history.replaceState({}, '', window.location.pathname);

  return { code, verifier, redirectUri: window.location.origin };
}
