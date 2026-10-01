// Тест реальної apiFetch() з js/app.js: перевіряє, що запити
// справді йдуть з bearer-токеном, а не падають на необʼявлену змінну.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let ok = 0, fail = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
};

// Мінімальний DOM: app.js дзвінюється до нього під час завантаження.
const noop = () => {};
const fakeEl = {
  addEventListener: noop, appendChild: noop, remove: noop, setAttribute: noop,
  getAttribute: () => null, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', checked: false,
  querySelector: () => null, querySelectorAll: () => [], focus: noop, click: noop
};
const elements = new Proxy({}, { get: () => fakeEl });

const calls = [];

// Локальне сховище: справжній auth.js читає з нього сесію.
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

// Відповідь Supabase на /token?grant_type=password.
const AUTH_RESPONSE = {
  access_token: 'test-token-abc',
  refresh_token: 'test-refresh-xyz',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'test@example.com' }
};

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Date, Math, Error, URL, URLSearchParams,
  FormData: class FormData {},
  document: {
    getElementById: () => fakeEl,
    querySelector: () => fakeEl,
    querySelectorAll: () => [],
    addEventListener: noop,
    createElement: () => fakeEl,
    body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
    documentElement: {
      style: { setProperty: noop, removeProperty: noop },
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      getAttribute: () => null, setAttribute: noop, removeAttribute: noop,
      appendChild: noop, removeChild: noop,
      dataset: {}
    }
  },
  localStorage: localStorageStub,
  fetch: async (url, opts) => {
    // Браузер робить відносні URL абсолютними; Node — ні.
    const full = String(url).startsWith('/') ? 'http://127.0.0.1:8000' + url : String(url);
    calls.push({ url: full, headers: (opts && opts.headers) || {} });
    if (full.includes('/api/config')) {
      return { ok: true, status: 200,
               json: async () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authRequired: true }),
               text: async () => '' };
    }
    if (full.includes('/auth/v1/token')) {
      return { ok: true, status: 200, json: async () => AUTH_RESPONSE, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({ decks: [] }), text: async () => '' };
  },
  navigator: { userAgent: 'node', onLine: true },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: noop,
  getComputedStyle: () => ({ color: 'rgb(15, 23, 42)', getPropertyValue: () => 'rgb(15, 23, 42)' }),
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', reload: noop },
  alert: noop, confirm: () => true,
  addEventListener: noop, removeEventListener: noop,
  scrollTo: noop
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
// Завантажуємо локальні скрипти в тому самому порядку, що й index.html —
// так тест перевіряє справжній ланцюг залежностей, а не app.js у відриві.
const SCRIPTS = ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js'];
for (const name of SCRIPTS) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), sandbox, { filename: name });
}
vm.runInContext('globalThis.__apiFetch = apiFetch;globalThis.__getAccessToken = getAccessToken;', sandbox, { filename: 'capture' });

const apiFetch = sandbox.__apiFetch;
const getAccessToken = sandbox.__getAccessToken;

(async () => {
  console.log('\nСтатична перевірка');
  check('apiFetch існує', typeof apiFetch, 'function');
  check('getAccessToken існує', typeof getAccessToken, 'function');

  console.log('\nВхід через справжній auth.signIn');
  const auth = sandbox.window.AnkiAuth;
  check('AnkiAuth завантажився', typeof auth.signIn, 'function');
  const session = await auth.signIn('test@example.com', 'пароль');
  check('токен отримано', session.accessToken, 'test-token-abc');
  check('сесія в localStorage', store.has('anki.auth.session'), true);

  console.log('\ngetAccessToken()');
  check('повертає токен', await getAccessToken(), 'test-token-abc');
  check('без модуля повертає null', await (async () => {
    const saved = sandbox.AnkiAuth; sandbox.AnkiAuth = undefined;
    const r = await getAccessToken(); sandbox.AnkiAuth = saved; return r;
  })(), null);
  check('при помилці повертає null, не кидає', await (async () => {
    const saved = sandbox.AnkiAuth;
    sandbox.AnkiAuth = { getAccessToken: async () => { throw new Error('бу'); } };
    const r = await getAccessToken(); sandbox.AnkiAuth = saved; return r;
  })(), null);

  console.log('\napiFetch додає Authorization');
  calls.length = 0;
  await apiFetch('/api/decks');
  check('запит пішов', calls.length, 1);
  check('bearer у заголовку', calls[0].headers.Authorization, 'Bearer test-token-abc');

  console.log('\napiFetch без токена не додає заголовок');
  calls.length = 0;
  auth.signOut();
  check('сесія очищено', auth.getSession(), null);
  await apiFetch('/api/decks');
  check('Authorization відсутній', calls[0].headers.Authorization, undefined);
  // повертаємося у вхід, щоб перевірити решту випадків
  await auth.signIn('test@example.com', 'пароль');

  console.log('\nВласні заголовки не перетираються');
  calls.length = 0;
  await apiFetch('/api/decks', { headers: { 'X-Test': 'так' } });
  check('X-Test збережено', calls[0].headers['X-Test'], 'так');
  check('bearer на місці', calls[0].headers.Authorization, 'Bearer test-token-abc');

  console.log('\nПомилка 401 не зупиняє решту');
  const savedFetch = sandbox.fetch;
  sandbox.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  let thrown = null;
  try { await apiFetch('/api/decks'); } catch (e) { thrown = e; }
  check('401 кидає помилку', thrown && thrown.status, 401);
  sandbox.fetch = savedFetch;

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); process.exit(1); });
