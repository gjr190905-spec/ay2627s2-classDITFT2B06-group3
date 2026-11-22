/* SCRUM-24 Day 8: shared cookie-session navigation for Makan Liao pages.
   Never store session tokens, identity or roles in localStorage. */
(function () {
  'use strict';

  let user = null;
  let csrfToken = null;
  let sessionRequest = null;

  function showSession() {
    const signedIn = Boolean(user);
    document.querySelectorAll('[data-session-user]').forEach((element) => {
      element.hidden = !signedIn;
    });
    document.querySelectorAll('[data-session-guest]').forEach((element) => {
      element.hidden = signedIn;
    });
    document.querySelectorAll('[data-session-name]').forEach((element) => {
      element.textContent = signedIn ? user.displayName || user.email || 'Customer' : '';
    });
    document.querySelectorAll('[data-session-role]').forEach((element) => {
      element.textContent = signedIn ? user.role || 'customer' : '';
    });
    document.querySelectorAll('[data-guest-message]').forEach((element) => {
      element.hidden = signedIn;
    });
  }

  async function refreshSession() {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Unable to confirm your account session.');
    const data = await response.json();
    user = data.user && typeof data.user === 'object' ? data.user : null;
    csrfToken = typeof data.csrfToken === 'string' ? data.csrfToken : null;
    showSession();
    return user;
  }

  function getSession(forceRefresh = false) {
    if (forceRefresh) sessionRequest = null;
    if (!sessionRequest) {
      sessionRequest = refreshSession().catch((error) => {
        sessionRequest = null; // transient network failures can be retried
        throw error;
      });
    }
    return sessionRequest;
  }

  function loginLocation() {
    const next = `${window.location.pathname}${window.location.search}`;
    if (!/^\/(?:home\.html|menu\.html|stall-menu\.html)(?:\?[^#]*)?$/.test(next)) {
      return '/login.html';
    }
    return `/login.html?next=${encodeURIComponent(next)}`;
  }

  async function requireUser() {
    try {
      // Recheck the server on each cart action; a previous login may have expired.
      const result = await getSession(true);
      if (result) return true;
    } catch {
      // A failed session check must never allow a protected cart operation.
    }
    window.location.assign(loginLocation());
    return false;
  }

  async function signOut() {
    if (!(await getSession(true))) return;
    if (!csrfToken) throw new Error('Your session could not be verified. Refresh and retry.');
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: '{}',
    });
    if (!response.ok) {
      throw new Error('Sign out failed. Please check your connection and try again.');
    }
    user = null;
    csrfToken = null;
    sessionRequest = null;
    showSession();
    window.location.assign('/login.html?logged_out=1');
  }

  window.MakanAuth = { getSession, requireUser, signOut };

  document.addEventListener('DOMContentLoaded', () => {
    showSession();
    document.querySelectorAll('[data-session-logout]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await signOut();
        } catch (error) {
          const status = document.querySelector('[data-session-error]');
          if (status) {
            status.textContent = error.message;
            status.hidden = false;
          } else {
            window.alert(error.message);
          }
        } finally {
          button.disabled = false;
        }
      });
    });
    getSession().catch(() => {
      const status = document.querySelector('[data-session-error]');
      if (status) {
        status.textContent = 'Account status unavailable. Please refresh to try again.';
        status.hidden = false;
      }
    });
  });
})();
