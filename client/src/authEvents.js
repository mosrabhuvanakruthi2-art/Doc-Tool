// A tiny "the session changed" signal.
//
// Data that loads once at app start (e.g. product types) can be requested before
// the sign-in token is stored — every /api route requires a login, so that early
// request gets a 401 and the screen stays empty until a manual refresh. Firing
// this event whenever a token is stored or cleared lets such data reload with
// the right credentials. Other tabs are covered by the browser's `storage` event.
export const AUTH_CHANGED = 'doctool:auth-changed';

export function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event(AUTH_CHANGED));
  } catch {
    // Never let a notification get in the way of signing in or out.
  }
}
