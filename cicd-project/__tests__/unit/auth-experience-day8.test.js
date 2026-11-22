/* SCRUM-24 Day 8: exercise the actual HTTP session lifecycle, not just HTML presence.
   Database services are mocked; the real Express app, cookies, CSRF and routes run. */
jest.mock('../../src/services/login-service', () => ({ authenticateAccount: jest.fn() }));
jest.mock('../../src/services/registration-service', () => ({
  registerCustomerAccount: jest.fn(),
}));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(),
  findActiveSession: jest.fn(),
  revokeSession: jest.fn(),
}));

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../../src/app');
const { authenticateAccount } = require('../../src/services/login-service');
const { registerCustomerAccount } = require('../../src/services/registration-service');
const {
  createSession,
  findActiveSession,
  revokeSession,
} = require('../../src/models/Session.model');

const customer = {
  id: 432,
  name: 'Test Customer',
  email: 'new.customer@example.com',
  role: 'customer',
  stallId: null,
};
const signup = {
  displayName: 'Test Customer',
  email: 'new.customer@example.com',
  password: 'safe-customer-pass-456',
  confirmPassword: 'safe-customer-pass-456',
};

let activeSession;
beforeEach(() => {
  jest.resetAllMocks();
  activeSession = null;
  createSession.mockImplementation(async (userId, tokenHash, _expiry, csrfToken) => {
    activeSession = { ...customer, id: userId, tokenHash, csrfToken };
  });
  findActiveSession.mockImplementation(async (tokenHash) => {
    return activeSession && activeSession.tokenHash === tokenHash ? activeSession : null;
  });
  revokeSession.mockImplementation(async (tokenHash) => {
    if (activeSession?.tokenHash === tokenHash) activeSession = null;
  });
  registerCustomerAccount.mockResolvedValue({ created: true, account: customer, errors: {} });
  authenticateAccount.mockResolvedValue({ authenticated: true, account: customer, errors: {} });
});

test('port root opens the real Makan Liao homepage without overwriting the CI/CD scaffold', async () => {
  const response = await request(app).get('/');
  expect(response.status).toBe(302);
  expect(response.headers.location).toBe('/home.html');
  const home = await request(app).get('/home.html');
  expect(home.status).toBe(200);
  expect(home.text).toContain('LESS QUEUE.');
  expect(home.text).toContain('/auth-shell.js');
  expect(home.text).not.toMatch(/DemoPass!2026|TRY A DEMO ACCOUNT/);
});

test('signup → session cookie → refresh → CSRF logout → guest is one complete user journey', async () => {
  const browser = request.agent(app);
  const created = await browser.post('/api/auth/signup').send(signup);
  expect(created.status).toBe(201);
  expect(created.body.user).toMatchObject({ email: customer.email, role: 'customer' });
  expect(created.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(created.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect(registerCustomerAccount).toHaveBeenCalledTimes(1);

  const refreshed = await browser.get('/api/auth/me');
  expect(refreshed.body.user.displayName).toBe('Test Customer');
  expect(refreshed.body.csrfToken).toBe(created.body.csrfToken);
  expect(await browser.get('/home.html').then((r) => r.status)).toBe(200);
  expect(await browser.get('/menu.html').then((r) => r.status)).toBe(200);

  const blocked = await browser.post('/api/auth/logout').send({});
  expect(blocked.status).toBe(403);
  expect((await browser.get('/api/auth/me')).body.user).not.toBeNull();
  const loggedOut = await browser
    .post('/api/auth/logout')
    .set('X-CSRF-Token', created.body.csrfToken)
    .send({});
  expect(loggedOut.status).toBe(200);
  expect(loggedOut.headers['set-cookie'][0]).toContain('Max-Age=0');
  expect((await browser.get('/api/auth/me')).body).toEqual({ user: null, csrfToken: null });
});

test('login creates a fresh real session and logout invalidates it', async () => {
  const browser = request.agent(app);
  const login = await browser.post('/api/auth/login').send({
    email: customer.email,
    password: signup.password,
  });
  expect(login.status).toBe(200);
  expect(createSession).toHaveBeenCalledTimes(1);
  expect((await browser.get('/api/auth/me')).body.user.email).toBe(customer.email);
  expect(
    (await browser.post('/api/auth/logout').set('X-CSRF-Token', login.body.csrfToken).send({}))
      .status,
  ).toBe(200);
  expect((await browser.get('/api/auth/me')).body.user).toBeNull();
});

test('wrong credentials do not authenticate the browser or issue a cookie', async () => {
  authenticateAccount.mockResolvedValue({
    authenticated: false,
    errors: { form: 'Incorrect email or password.' },
  });
  const browser = request.agent(app);
  const result = await browser.post('/api/auth/login').send({
    email: customer.email,
    password: 'incorrect-guess',
  });
  expect(result.status).toBe(401);
  expect(result.headers['set-cookie']).toBeUndefined();
  expect((await browser.get('/api/auth/me')).body.user).toBeNull();
});

test('duplicate signup does not create a session', async () => {
  registerCustomerAccount.mockResolvedValue({
    created: false,
    errors: { email: 'An account with this email already exists.' },
  });
  const result = await request(app).post('/api/auth/signup').send(signup);
  expect(result.status).toBe(409);
  expect(createSession).not.toHaveBeenCalled();
});

test('a revoked session cannot remain authenticated after refresh', async () => {
  const browser = request.agent(app);
  expect(
    (await browser.post('/api/auth/login').send({ email: signup.email, password: signup.password }))
      .status,
  ).toBe(200);
  activeSession = null; // expiry / revocation performed server-side
  expect((await browser.get('/api/auth/me')).body.user).toBeNull();
});

test('the menu and stall scripts depend on the server session, not a localStorage bearer token', () => {
  const base = path.join(__dirname, '..', '..', 'src', 'public');
  for (const file of ['menu.js', 'stall-menu.js']) {
    const text = fs.readFileSync(path.join(base, file), 'utf8');
    expect(text).not.toMatch(
      /localStorage\.getItem\(TOKEN_KEY\)|Authorization\s*=\s*`Bearer|removeItem\(TOKEN_KEY\)/,
    );
  }
  expect(fs.readFileSync(path.join(base, 'stall-menu.js'), 'utf8')).toContain(
    'MakanAuth.requireUser()',
  );
  for (const file of ['menu.html', 'stall-menu.html']) {
    const html = fs.readFileSync(path.join(base, file), 'utf8');
    expect(html).toContain('auth-shell.js');
    expect(html).toContain('data-session-logout');
    expect(html).toContain('data-session-guest');
  }
});

test('successful login/sign up redirects into the app using a validated same-origin path', () => {
  const base = path.join(__dirname, '..', '..', 'src', 'public');
  const browserCode = fs.readFileSync(path.join(base, 'auth-pages.js'), 'utf8');
  expect(browserCode).toContain('window.location.replace(postLoginDestination())');
  expect(browserCode).toContain("return '/home.html'");
  expect(browserCode).toContain('stall-menu');
  expect(browserCode).not.toMatch(/localStorage\.setItem|Bearer /);
});

function bootSessionShell({ fetchImpl, pathname = '/home.html', search = '' }) {
  const vm = require('node:vm');
  const base = path.join(__dirname, '..', '..', 'src', 'public');
  const source = fs.readFileSync(path.join(base, 'auth-shell.js'), 'utf8');
  const listeners = {};
  const elements = {
    '[data-session-user]': [{ hidden: true, textContent: '' }],
    '[data-session-guest]': [{ hidden: false, textContent: '' }],
    '[data-session-name]': [{ hidden: true, textContent: '' }],
    '[data-session-role]': [{ hidden: true, textContent: '' }],
    '[data-guest-message]': [{ hidden: true, textContent: '' }],
    '[data-session-logout]': [
      {
        disabled: false,
        addEventListener(type, handler) {
          listeners[`logout_${type}`] = handler;
        },
      },
    ],
  };
  const navigation = [];
  const document = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    querySelectorAll(selector) {
      return elements[selector] || [];
    },
    querySelector() {
      return null;
    },
  };
  const window = {
    location: {
      pathname,
      search,
      assign(url) {
        navigation.push(url);
      },
    },
    alert: jest.fn(),
  };
  vm.runInNewContext(source, { document, window, fetch: fetchImpl });
  listeners.DOMContentLoaded();
  return { window, elements, navigation, listeners };
}

test('the real shared navigation shows the signed-in user and performs CSRF-protected logout', async () => {
  const calls = [];
  const fetchImpl = jest.fn(async (route, options) => {
    calls.push({ route, options });
    if (route === '/api/auth/me') {
      return {
        ok: true,
        json: async () => ({
          user: { displayName: 'Real Customer', role: 'customer' },
          csrfToken: 'csrf-value',
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const shell = bootSessionShell({ fetchImpl });
  expect((await shell.window.MakanAuth.getSession()).displayName).toBe('Real Customer');
  expect(shell.elements['[data-session-user]'][0].hidden).toBe(false);
  expect(shell.elements['[data-session-guest]'][0].hidden).toBe(true);
  expect(shell.elements['[data-session-name]'][0].textContent).toBe('Real Customer');
  await shell.window.MakanAuth.signOut();
  const logout = calls.find((item) => item.route === '/api/auth/logout');
  expect(logout.options.headers['X-CSRF-Token']).toBe('csrf-value');
  expect(logout.options.credentials).toBe('same-origin');
  expect(shell.navigation).toEqual(['/login.html?logged_out=1']);
});

test('cart authentication rechecks the server and redirects expired sessions to login', async () => {
  let active = true;
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      user: active ? { displayName: 'Customer', role: 'customer' } : null,
      csrfToken: active ? 'csrf-value' : null,
    }),
  }));
  const shell = bootSessionShell({ fetchImpl, pathname: '/stall-menu.html', search: '?id=2' });
  expect(await shell.window.MakanAuth.getSession()).toBeTruthy();
  active = false;
  expect(await shell.window.MakanAuth.requireUser()).toBe(false);
  expect(shell.navigation).toEqual(['/login.html?next=%2Fstall-menu.html%3Fid%3D2']);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
