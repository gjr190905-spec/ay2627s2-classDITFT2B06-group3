const fs = require('node:fs');
const path = require('node:path');

const publicPath = path.join(__dirname, '..', '..', 'src', 'public');
const html = (page) => fs.readFileSync(path.join(publicPath, page), 'utf8');
const js = fs.readFileSync(path.join(publicPath, 'auth-pages.js'), 'utf8');
const css = fs.readFileSync(path.join(publicPath, 'styles', 'auth-pages.css'), 'utf8');

describe('SCRUM-24 Day 8 login / signup UI', () => {
  test('both pages are available and link to each other', () => {
    expect(html('login.html')).toContain('href="/signup.html"');
    expect(html('signup.html')).toContain('href="/login.html"');
    expect(html('login.html')).toContain('data-auth-page="login"');
    expect(html('signup.html')).toContain('data-auth-page="signup"');
  });

  test('signup matches the SCRUM-12 API field contract', () => {
    const page = html('signup.html');
    for (const field of ['displayName', 'email', 'password', 'confirmPassword']) {
      expect(page).toContain(`name="${field}"`);
    }
    expect(js).toContain("'/api/auth/signup'");
  });

  test('login uses cookie-based session authentication', () => {
    expect(js).toContain("'/api/auth/login'");
    expect(js).toContain("credentials: 'same-origin'");
    expect(js).toContain("'/api/auth/me'");
    expect(js).not.toMatch(/localStorage|sessionStorage|Bearer /);
  });

  test('sign out calls the server with its CSRF token', () => {
    expect(js).toContain("'/api/auth/logout'");
    expect(js).toContain("'X-CSRF-Token': csrfToken");
  });

  test('forms are accessible and do not collect SP credentials', () => {
    expect(html('login.html')).toContain('aria-live="polite"');
    expect(html('signup.html')).toContain('autocomplete="new-password"');
    expect(html('login.html')).toContain('not Singapore Polytechnic Single Sign-On');
  });

  test('UI follows the supplied final prototype design tokens and assets', () => {
    expect(css).toContain('#ba080d');
    expect(css).toContain('background: #b91213');
    expect(css).toContain('#fffaf5');
    expect(css).toContain('Barlow Condensed');
    expect(css).toContain('DM Sans');
    expect(css).toContain('@media (max-width: 770px)');
    expect(fs.existsSync(path.join(publicPath, 'images', 'makan-liao-logo.png'))).toBe(true);
    expect(html('login.html')).toContain('How It Works');
    expect(html('login.html')).toContain('Help &amp; Support');
    expect(html('login.html')).not.toMatch(/data-demo=|fc6-vendor|DemoPass!2026|TRY A DEMO ACCOUNT/);
    expect(html('login.html')).toContain('Your next break');
  });
});
