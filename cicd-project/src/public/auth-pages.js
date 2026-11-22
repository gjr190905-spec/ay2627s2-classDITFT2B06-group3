/* SCRUM-24 Day 8: browser-side authentication UI for the existing SCRUM-12 API.
   Trust ONLY the server's HTTP-only session cookie, not client-supplied roles/tokens. */
(function () {
  'use strict';

  const mode = document.body.dataset.authPage;
  const form = document.getElementById('auth-form');
  const statusBox = document.getElementById('form-status');
  const submitButton = document.getElementById('submit-button');
  const signedIn = document.getElementById('signed-in');
  const logoutButton = document.getElementById('logout-button');
  const fields =
    mode === 'signup'
      ? ['displayName', 'email', 'password', 'confirmPassword']
      : ['email', 'password'];
  let csrfToken = null;

  // Keep the browser validation aligned with signup rules without a control-character regex.
  function hasInvalidDisplayNameCharacter(name) {
    return [...name].some((char) => {
      const code = char.charCodeAt(0);
      return char === '<' || char === '>' || code < 32 || code === 127;
    });
  }

  function showStatus(message, kind = 'error') {
    statusBox.textContent = message;
    statusBox.className = `form-status ${kind}`;
    statusBox.hidden = !message;
  }

  function clearErrors() {
    showStatus('');
    for (const field of fields) {
      const input = document.getElementById(field);
      const error = document.getElementById(`error-${field}`);
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    }
  }

  function showErrors(errors) {
    let firstInput = null;
    for (const [field, message] of Object.entries(errors)) {
      if (!fields.includes(field) || typeof message !== 'string') continue;
      const input = document.getElementById(field);
      const error = document.getElementById(`error-${field}`);
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      if (!firstInput) firstInput = input;
    }
    showStatus(
      typeof errors.form === 'string' ? errors.form : 'Please review the highlighted fields.',
    );
    if (firstInput) firstInput.focus();
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      /* Respond gracefully to non-JSON errors. */
    }
    if (!response.ok) {
      const error = new Error(body.error || body.message || 'Request failed. Please try again.');
      error.errors = body.errors || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  // Only local, supported app paths can be used as a post-login destination.
  function postLoginDestination() {
    const next = new URLSearchParams(window.location.search).get('next');
    if (
      next &&
      /^\/(?:home\.html|menu\.html|stall-menu\.html)(?:\?[A-Za-z0-9=&%._-]*)?$/.test(next)
    ) {
      return next;
    }
    return '/home.html';
  }

  function showAccount(user, token) {
    if (!user || typeof user !== 'object') return;
    csrfToken = typeof token === 'string' ? token : null;
    // Successful signup/login goes into the real app, not an isolated confirmation panel.
    window.location.replace(postLoginDestination());
  }

  function showGuest() {
    csrfToken = null;
    form.hidden = false;
    document.querySelector('.auth-switch').hidden = false;
    signedIn.hidden = true;
    form.reset();
    clearErrors();
  }

  function validate() {
    const data = {
      email: document.getElementById('email').value.trim().toLowerCase(),
      password: document.getElementById('password').value,
    };
    const errors = {};
    if (!data.email || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!data.password || !data.password.trim()) errors.password = 'Password is required.';
    if (mode === 'signup') {
      data.displayName = document.getElementById('displayName').value.trim().replace(/\s+/g, ' ');
      data.confirmPassword = document.getElementById('confirmPassword').value;
      if (
        data.displayName.length < 2 ||
        data.displayName.length > 80 ||
        hasInvalidDisplayNameCharacter(data.displayName)
      ) {
        errors.displayName = 'Name must contain 2–80 supported characters.';
      }
      if (
        data.password.length < 8 ||
        data.password.length > 128 ||
        new TextEncoder().encode(data.password).length > 72
      ) {
        errors.password = 'Use 8–128 characters, no more than 72 UTF-8 bytes.';
      }
      if (!data.confirmPassword || data.password !== data.confirmPassword) {
        errors.confirmPassword = 'Passwords must match.';
      }
    }
    return { data, errors };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const { data, errors } = validate();
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }

    submitButton.disabled = true;
    const originalLabel = submitButton.innerHTML;
    submitButton.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
    try {
      const result = await apiRequest(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      form.reset();
      showAccount(result.user, result.csrfToken);
    } catch (error) {
      if (error.errors && typeof error.errors === 'object') showErrors(error.errors);
      else
        showStatus(error.status === 429 ? 'Too many requests. Please try later.' : error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = originalLabel;
    }
  });

  for (const button of document.querySelectorAll('[data-reveal]')) {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.reveal);
      const revealing = input.type === 'password';
      input.type = revealing ? 'text' : 'password';
      button.textContent = revealing ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(revealing));
    });
  }

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      if (!csrfToken) {
        const data = await apiRequest('/api/auth/me');
        csrfToken = data.csrfToken;
      }
      if (!csrfToken) throw new Error('Could not verify your session. Refresh and retry.');
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: '{}',
      });
      showGuest();
      showStatus('You have signed out successfully.', 'success');
    } catch (error) {
      showStatus(error.message);
    } finally {
      logoutButton.disabled = false;
    }
  });

  // Match the prototype header while avoiding dead links to unfinished features.
  const mobileMenu = document.getElementById('mobile-menu');
  const navigation = document.getElementById('site-navigation');
  mobileMenu.addEventListener('click', () => {
    const expanded = mobileMenu.getAttribute('aria-expanded') !== 'true';
    mobileMenu.setAttribute('aria-expanded', String(expanded));
    navigation.classList.toggle('open', expanded);
  });

  const notice = document.getElementById('ui-notice');
  for (const button of document.querySelectorAll('[data-future]')) {
    button.addEventListener('click', () => {
      const label = button.getAttribute('data-future');
      notice.textContent = `${label} will be connected during the remaining frontend integration days.`;
      notice.hidden = false;
      notice.focus?.();
    });
  }

  // Server is the source of truth, including role and current session state.
  apiRequest('/api/auth/me')
    .then((data) => {
      if (data.user) showAccount(data.user, data.csrfToken);
    })
    .catch(() => {
      showStatus('Could not check your current session. You can still try signing in.');
    });
})();
