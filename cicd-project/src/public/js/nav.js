/**
 * nav.js — Makan Liao shared navigation
 *
 * Sections:
 *  1. Constants
 *  2. Route Guard
 *  3. Nav HTML
 *  4. Render & Init
 */

// ── 1. Constants ─────────────────────────────────────────
const TOKEN_KEY = 'token';
const CART_KEY  = 'cart';
const LOGIN_PAGE = '/index.html';

// menu.html and stall-menu.html are intentionally public — no token needed
const PROTECTED_PAGES = ['orders.html', 'cart.html', 'checkout.html'];

// ── 2. Route Guard ───────────────────────────────────────
function currentPage() {
  return window.location.pathname.split('/').pop() || 'index.html';
}

// Having a token isn't the same as being logged in: it may have expired.
// If it decodes as a JWT and `exp` is in the past, clear it. Anything we can't
// decode is left alone (the server still has the final say via 401).
function hasValidToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) {
      localStorage.removeItem(TOKEN_KEY);
      return false;
    }
  } catch {
    // not a decodable JWT, so treat it as present
  }
  return true;
}

function enforceRouteGuard() {
  if (!hasValidToken() && PROTECTED_PAGES.includes(currentPage())) {
    window.location.replace(LOGIN_PAGE);
  }
}

// Back/forward button fires popstate — re-run the guard so they can't
// navigate back into a protected page after signing out.
window.addEventListener('popstate', enforceRouteGuard);

// The browser can restore a page from its back/forward cache without running
// any scripts, leaving a stale nav on screen. pageshow fires in that case.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  enforceRouteGuard();
  renderNav();
});

// Signed out (or in) from another tab: re-check this one.
window.addEventListener('storage', (event) => {
  if (event.key !== TOKEN_KEY) return;
  enforceRouteGuard();
  renderNav();
});

// ── 3. Nav HTML ──────────────────────────────────────────
function getCartCount() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY));
    if (!stored || !Array.isArray(stored.items)) return 0;
    return stored.items.reduce((sum, line) => sum + (line.quantity ?? 1), 0);
  } catch {
    return 0;
  }
}

function buildNavHTML() {
  const page       = currentPage();
  const hasToken   = hasValidToken();
  const cartCount  = getCartCount();

  const stallsActive = page === 'menu.html'   ? ' aria-current="page"' : '';
  const ordersActive = page === 'orders.html' ? ' aria-current="page"' : '';

  return `
    <a class="skip-link" href="#main">Skip to main content</a>

    <p class="promo-bar">MADE FOR SP STUDENTS &amp; STAFF &nbsp;|&nbsp; ORDER TOGETHER, SAVE MORE &nbsp;|&nbsp; COLLECT AT YOUR CAMPUS CANTEEN</p>

    <header class="site-header">
      <a class="brand" href="menu.html">
        <img class="brand__logo" src="/images/brand/makan-liao-logo.png" alt="Makan Liao" width="120" height="48" />
      </a>

      <nav class="site-nav" aria-label="Main">
        <ul class="site-nav__list">
          <li><a href="menu.html"${stallsActive}>Food stalls</a></li>
          ${hasToken ? `<li><a href="orders.html"${ordersActive}>My orders</a></li>` : ''}
          ${hasToken ? `<li>
            <a href="cart.html" aria-label="Cart, ${cartCount} item${cartCount !== 1 ? 's' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              <span class="cart-badge" id="cart-count" aria-live="polite">${cartCount}</span>
            </a>
          </li>` : ''}
        </ul>
      </nav>

      <div class="site-user">
        ${hasToken
          ? `<button type="button" class="button button--outline" id="sign-out">Sign out</button>`
          : `<a class="button button--outline" href="/index.html">Sign in</a>`
        }
      </div>
    </header>`;
}

// ── 4. Render & Init ─────────────────────────────────────
function renderNav() {
  const mount = document.getElementById('site-nav-mount');
  if (!mount) return;

  mount.innerHTML = buildNavHTML();

  document.getElementById('sign-out')?.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CART_KEY);
    window.location.href = LOGIN_PAGE;
  });
}

// Page scripts call this after changing the cart. It does nothing for guests,
// because the cart icon isn't rendered for them.
function refreshCartBadge() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = String(count);
  badge.closest('a')?.setAttribute('aria-label', `Cart, ${count} item${count !== 1 ? 's' : ''}`);
}

// Keep the badge in sync when the cart changes in another tab
window.addEventListener('storage', (e) => {
  if (e.key === CART_KEY) refreshCartBadge();
});

// This script is loaded with `defer` and listed before the page script, so the
// DOM is already parsed and we run first. Render now (not on DOMContentLoaded)
// so elements like #cart-count exist by the time page scripts look for them.
enforceRouteGuard();
renderNav();