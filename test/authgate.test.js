// Тест вхідної перевірки: без сесії має показуватись форма входу,
// із сесією — застосунок. Перевіряє, що застосунок не відкривається
// в обхід входу лише приховуванням екрана.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js'];
let ok = 0, fail = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
};

const noop = () => {};

// Запускає всі скрипти з порожнім або заданим сховищем і повертає
// стан екранів після завантаження.
function boot(session, opts = {}) {
  const tracked = new Map();
  function makeEl(id) {
    // Один і той самий обʼєкт на той самий id — інакше app.js тримає
    // посилання на інший елемент, ніж ми перевіряємо.
    if (id && tracked.has(id)) return tracked.get(id);
    const el = {
      id, hidden: false, value: '', textContent: '', disabled: false, checked: false,
      style: { setProperty: noop }, dataset: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, appendChild: noop, removeChild: noop, remove: noop,
      setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
      focus: noop, click: noop, querySelector: () => null, querySelectorAll: () => []
    };
    if (id) tracked.set(id, el);
    return el;
  }
  const localStorageMap = new Map();
  if (session) localStorageMap.set('anki.auth.session', JSON.stringify(session));

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Error, URL, URLSearchParams,
    FormData: class FormData {},
    document: {
      getElementById: (id) => makeEl(id),
      querySelector: () => makeEl(null), querySelectorAll: () => [],
      addEventListener: noop, createElement: () => makeEl(null),
      body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
      documentElement: {
        style: { setProperty: noop }, dataset: {},
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        getAttribute: () => null, appendChild: noop
      }
    },
    localStorage: {
      getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
      setItem: (k, v) => localStorageMap.set(k, String(v)),
      removeItem: (k) => localStorageMap.delete(k)
    },
    fetch: async (url) => {
      const full = String(url).startsWith('/') ? 'http://127.0.0.1:8000' + url : String(url);
      if (full.includes('/api/config')) return { ok: true, status: 200, json: async () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }) };
      if (full.includes('/auth/v1/')) return { ok: true, status: 200, json: async () => ({}) };
      if (opts.decksFail) return { ok: false, status: 503, json: async () => ({ detail: 'сервер недоступний' }) };
      return { ok: true, status: 200, json: async () => ({ decks: [] }) };
    },
    navigator: { userAgent: 'node', onLine: true },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: noop,
    getComputedStyle: () => ({ color: 'rgb(15, 23, 42)' }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', reload: noop },
    alert: noop, confirm: () => true, addEventListener: noop, removeEventListener: noop, scrollTo: noop
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), sandbox, { filename: name });
  }
  return {
    loginScreen: tracked.get('loginScreen'),
    appRoot: tracked.get('app'),
    session: sandbox.window.AnkiAuth.getSession()
  };
}

const validSession = {
  accessToken: 'test-token', refreshToken: 'r', expiresAt: Date.now() + 3600 * 1000,
  userId: '11111111-1111-1111-1111-111111111111', email: 'zadarko12@gmail.com'
};

// Чекаємо, доки внутрішні проміси app.js відпрацюють.
const settle = () => new Promise((r) => setTimeout(r, 10));

(async () => {
console.log('\nБез сесії — має бути форма входу');
const a = boot(null);
await settle();
check('сесії немає', a.session, null);
check('loginScreen показано (hidden=false)', a.loginScreen.hidden, false);
check('застосунок приховано (hidden=true)', a.appRoot.hidden, true);

console.log('\nІз валідною сесією — має відкритися застосунок');
const b = boot(validSession);
await settle();
check('сесія знайдена', b.session !== null, true);
check('loginScreen приховано', b.loginScreen.hidden, true);
check('застосунок показано', b.appRoot.hidden, false);

console.log('\nПрострочена сесія не повинна відкривати застосунок');
const stale = { ...validSession, expiresAt: Date.now() - 1000 };
const c = boot(stale);
await settle();
check('застосунок не відкривається', c.appRoot.hidden, true);
check('форма входу показана', c.loginScreen.hidden, false);

console.log('\nСервер недоступний — сесія справжня, викидати на вхід не можна');
const d = boot(validSession, { decksFail: true });
await settle();
check('користувач лишається в застосунку', d.appRoot.hidden, false);
check('екран входу приховано', d.loginScreen.hidden, true);

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); process.exit(1); });
