// Тест синхронізації колод із сервером.
// Ловить дві реальні помилки:
//   1) нова колода йшла на PUT /api/decks/{id} — сервер відповідав 404,
//      бо рядка ще не існувало;
//   2) сервер віддає CSS полем "css", а migrateDeck читає "modelCss",
//      тому CSS зникав на кожній синхронізації.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let ok = 0, fail = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
};
const checkThat = (label, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
};

const noop = () => {};
function makeSandbox(remoteDecks) {
  const els = new Map();
  const el = (id) => {
    if (id && els.has(id)) return els.get(id);
    const e = { id, hidden: false, value: '', textContent: '', innerHTML: '', disabled: false,
      style: { setProperty: noop }, dataset: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, appendChild: noop, removeChild: noop, remove: noop,
      setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
      focus: noop, click: noop, querySelector: () => null, querySelectorAll: () => [] };
    if (id) els.set(id, e);
    return e;
  };

  const calls = [];
  const ls = new Map();
  const s = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Error, URL, URLSearchParams,
    FormData: class {},
    document: { getElementById: el, querySelector: () => el(null), querySelectorAll: () => [],
      addEventListener: noop, createElement: () => el(null),
      body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
      documentElement: { style: { setProperty: noop }, dataset: {}, getAttribute: () => null,
        appendChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } } },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    fetch: async (url, opts = {}) => {
      const full = String(url).startsWith('/') ? 'http://127.0.0.1:8000' + String(url) : String(url);
      calls.push({ method: (opts.method || 'GET').toUpperCase(), url: full });
      const reply = (payload) => ({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: async () => payload
      });
      if (full.includes('/api/config')) return reply({ supabaseUrl: 'https://x.co', supabaseAnonKey: 'k' });
      if (/\/api\/decks(\?|$)/.test(full) && (opts.method || 'GET') === 'GET') return reply({ decks: remoteDecks });
      return reply({});
    },
    navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: noop,
    getComputedStyle: () => ({ color: 'rgb(1,2,3)' }),
    IntersectionObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', reload: noop },
    alert: noop, confirm: () => true, addEventListener: noop, removeEventListener: noop, scrollTo: noop
  };
  s.window = s;
  vm.createContext(s);
  for (const n of ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', n), 'utf8'), s, { filename: n });
  }
  vm.runInContext('globalThis.__push = pushDeckToServer;globalThis.__sync = syncDecksFromServer;' +
                  'globalThis.__migrate = migrateDeck;globalThis.__payload = deckToServerPayload;' +
                  'globalThis.__cardsPayload = cardsToServerPayload;' +
                  'globalThis.__get = () => appState.decks;' +
                  'globalThis.__set = (v) => { appState.decks = v; };', s);
  // appState оголошено через const, тому ззовні він не видно —
  // читаємо і пишемо лише зсередини контексту.
  return {
    s, calls,
    get decks() { return vm.runInContext('__get()', s); },
    set decks(v) { vm.runInContext('__set(' + JSON.stringify(v) + ')', s); }
  };
}

const CSS = '.card { font-size: 20px; background: #123456; }';
const remoteDeck = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Коди HTTP',
  fieldNames: ['Код', 'Назва'],
  css: CSS,
  templates: [],
  cards: [{ id: '22222222-2222-4222-8222-222222222222', values: { Код: '200', Назва: 'OK' } }],
  updatedAt: 1
};

(async () => {
  console.log('\nНова колода має доїхати до сервера');
  const a = makeSandbox([]);
  a.decks = [];
  await a.s.__push({
    id: '33333333-3333-4333-8333-333333333333', title: 'Нова', fieldNames: ['A'],
    modelCss: '', templates: [], cards: []
  });
  const created = a.calls.find((c) => c.method === 'POST' && /\/api\/decks(\?|$)/.test(c.url));
  checkThat('POST /api/decks (upsert) використано', !!created,
    `виклики: ${JSON.stringify(a.calls.map((c) => c.method + ' ' + c.url))}`);
  checkThat('PUT /api/decks/{id} НЕ використовується для нової колоди',
    !a.calls.some((c) => c.method === 'PUT' && /\/api\/decks\/[0-9a-f-]{36}$/.test(c.url)),
    `виклики: ${JSON.stringify(a.calls.map((c) => c.method + ' ' + c.url))}`);
  checkThat('картки теж відправлені', a.calls.some((c) => c.url.includes('/cards')), '');

  console.log('\nCSS з сервера не має зникати');
  const b = makeSandbox([remoteDeck]);
  b.decks = [];
  await b.s.__sync();
  check('отримано колоду', b.decks.length, 1);
  check('modelCss збережено', b.decks[0].modelCss, CSS);
  checkThat('CSS не порожній', b.decks[0].modelCss.length > 0, `отримано ${JSON.stringify(b.decks[0].modelCss)}`);

  console.log('\nСервер віддає і modelCss — теж має працювати');
  const c = makeSandbox([{ ...remoteDeck, css: undefined, modelCss: CSS }]);
  c.decks = [];
  await c.s.__sync();
  check('modelCss збережено', c.decks[0].modelCss, CSS);

  console.log('\nПовний цикл: правка -> сервер -> назад');
  const d = makeSandbox([remoteDeck]);
  d.decks = [];
  await d.s.__sync();
  const before = d.decks[0].cards[0].id;
  check('id картки стабільний', before, '22222222-2222-4222-8222-222222222222');
  const payload = d.s.__cardsPayload(d.decks[0]);
  check('payload зберігає id', payload.cards[0].id, before);
  check('payload має values', payload.cards[0].values.Код, '200');

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); console.error(e && e.stack); process.exit(1); });
