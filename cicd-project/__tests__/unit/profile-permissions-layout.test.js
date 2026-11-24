const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const assets = path.resolve(__dirname, '../../src/public/prototype-exact');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');

// Evaluate just the shared page renderer, not the app bootstrap. This verifies
// the actual HTML for customer, staff, vendor and admin accounts.
const section = app.slice(app.indexOf('function profilePage(){'), app.indexOf('\nfunction cartPage('));
function htmlFor(role) {
  const state = { user: { role, displayName: 'Test Person', email: 'demo@example.test', phone: '', stallName: 'Test Stall', avatarUrl: null } };
  return runInNewContext(`${section}\nprofilePage();`, {
    state,
    ico: name => `<svg aria-hidden="true" data-icon="${name}"></svg>`,
    esc: value => String(value),
    titleCase: value => value[0].toUpperCase() + value.slice(1),
  });
}

test.each(['customer', 'staff', 'vendor', 'admin'])('%s profile has one compact permissions card at the end', role => {
  const html = htmlFor(role);
  expect(html).toContain('class="note-box profile-permission-note" role="note"');
  expect(html).toContain('class="profile-permission-icon" aria-hidden="true"');
  expect(html).toContain('class="profile-permission-shield"');
  expect(html).toContain('stroke-linecap="round"');
  expect(html).toContain('class="profile-permission-text"');
  expect(html).toContain('<strong>Permissions notice</strong>');
  expect(html).toContain('Account roles and vendor stall assignments are controlled by the server.');
  expect((html.match(/profile-permission-note/g) || [])).toHaveLength(1);
  expect(html.indexOf('profile-permission-note')).toBeGreaterThan(html.indexOf('id="profileForm"'));
  expect(html).toContain('data-action="changeAvatar"');
});

test('shield icon is explicitly constrained to 20px and the card remains mobile-friendly', () => {
  expect(css).toMatch(/\.profile-permission-note\s*\{[^}]*display:flex/);
  expect(css).toMatch(/\.profile-permission-icon svg\s*\{[^}]*width:21px;height:21px/);
  expect(css).toMatch(/@media\(max-width:520px\)\s*\{\.profile-permission-note/);
  expect(css).toContain('.profile-permission-text{flex:1;min-width:0;');
  expect(css).toContain('background:linear-gradient(145deg,#fff9ed,#f3e7d2)');
});
