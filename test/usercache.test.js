// Тест прив'язки локального кеша до акаунта.
//
// Ключ localStorage мусить містити user id. Без цього два акаунти в одному
// браузері ділять кеш: користувач B бачить колоди користувача A, і — гірше —
// якщо в акаунті B сервер порожній, syncDecksFromServer() відправляє чужі
// колоди в чужий акаунт.
//
// Сесія тут не стабиться: вона сідається в localStorage у тому ж форматі,
// що й справжня (js/auth.js, TOKEN_KEY = 'anki.auth.session'), щоб тест
// перевіряв реальний getSession(), а не підміну.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DECKS_KEY = 'anki-gemini-decks-v1';
const SESSION_KEY = 'anki.auth.session';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
const ls = new Map();          // одне сховище на весь тест = один браузер

function signIn(userId) {
  if (!userId) ls.delete(SESSION_KEY);
  else ls.set(SESSION_KEY, JSON.stringify({
    accessToken: 'tok', refreshToken: 'ref',
    expiresAt: Date.now() + 3600000, userId, email: 'u@x.co'
  }));
}

function makeSandbox({ remoteDecks = [] } = {}) {
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

  const pushes = [];
  const reply = (payload) => ({ ok: true, status: 200,
    headers: { get: () => 'application/json' }, json: async () => payload });

  const s = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Error, URL, URLSearchParams,
    document: { getElementById: el, querySelector: () => el(null), querySelectorAll: () => [],
      addEventListener: noop, createElement: () => el(null),
      body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
      documentElement: { style: { setProperty: noop }, dataset: {}, getAttribute: () => null,
        appendChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } } },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    fetch: async (url, opts = {}) => {
      const full = String(url).startsWith('/') ? 'http://127.0.0.1:8000' + String(url) : String(url);
      const method = (opts.method || 'GET').toUpperCase();
      if (full.includes('/api/config')) return reply({ supabaseUrl: 'https://x.co', supabaseAnonKey: 'k' });
      if (method === 'GET' && /\/api\/decks(\?|$)/.test(full)) return reply({ decks: remoteDecks });
      if (method === 'POST' && /\/api\/decks(\?|$)/.test(full)) { pushes.push(JSON.parse(opts.body)); return reply({}); }
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
  vm.runInContext('globalThis.__sync = syncDecksFromServer;globalThis.__save = saveDecksLocally;' +
                  'globalThis.__load = loadDecks;globalThis.__switch = switchToCurrentUserCache;' +
                  'globalThis.__key = deckStorageKey;globalThis.__get = () => appState.decks;' +
                  'globalThis.__set = (v) => { appState.decks = v; };', s);
  return { s, ls, pushes,
    get decks() { return vm.runInContext('__get()', s); },
    set decks(v) { vm.runInContext('__set(' + JSON.stringify(v) + ')', s); } };
}

const DECK_A_ID = '11111111-1111-4111-8111-111111111111';
const mkDeck = (id, title) => ({
  id, title, fieldNames: ['A'], modelCss: '', templates: [],
  cards: [{ id: '22222222-2222-4222-8222-222222222222', values: { A: title } }], updatedAt: 1
});
const titles = (decks) => decks.map((d) => d.title);

(async () => {
  console.log('\nКлюч кеша має містити user id');
  signIn(null);
  check('без входу — загальний ключ', vm.runInContext('__key()', makeSandbox().s), DECKS_KEY);
  signIn(USER_A);
  check('увійшов A — ключ з id A', vm.runInContext('__key()', makeSandbox().s), `${DECKS_KEY}:${USER_A}`);
  signIn(USER_B);
  check('увійшов B — ключ з id B', vm.runInContext('__key()', makeSandbox().s), `${DECKS_KEY}:${USER_B}`);

  console.log('\nДані A не мають потрапити в кеш B');
  ls.clear();
  signIn(USER_A);
  const a = makeSandbox();
  a.decks = [mkDeck(DECK_A_ID, 'Колода A')];
  vm.runInContext('__save()', a.s);
  checkThat('A записав у ключ A', ls.has(`${DECKS_KEY}:${USER_A}`), `ключі: ${JSON.stringify([...ls.keys()])}`);
  checkThat('A НЕ записав у загальний ключ', !ls.has(DECKS_KEY), `ключі: ${JSON.stringify([...ls.keys()])}`);

  signIn(USER_B);
  const b = makeSandbox();
  checkThat('B не бачить колоду A', !titles(vm.runInContext('__load()', b.s)).includes('Колода A'),
    `бачить: ${JSON.stringify(titles(vm.runInContext('__load()', b.s)))}`);

  console.log('\nНайгірший сценарій: у B порожньо на сервері');
  // A працював під своїм входом — його кеш лежить у ключі A.
  // B заходить, сервер B порожній, тож sync іде у гілку «сервер порожній
  // → відправ локальне». Саме там раніше витікали чужі колоди.
  ls.clear();
  signIn(USER_A);
  const seed = makeSandbox();
  seed.decks = [mkDeck(DECK_A_ID, 'Колода A')];
  vm.runInContext('__save()', seed.s);

  signIn(USER_B);
  const leak = makeSandbox({ remoteDecks: [] });
  vm.runInContext('__switch()', leak.s);
  await leak.s.__sync();
  checkThat('колода A не просочилась в акаунт B',
    !leak.pushes.some((p) => p.id === DECK_A_ID || p.title === 'Колода A'),
    `відправлено: ${JSON.stringify(leak.pushes.map((p) => p.title))}`);
  // B legitimately seeds its own demo decks, so an exact count is wrong here.
  checkThat('B не відправляє картки колоди A',
    !JSON.stringify(leak.pushes).includes(DECK_A_ID), '');

  console.log('\nСтарий спільний ключ переходить першому акаунту один раз');
  // Залишок попередньої версії: масив без user id. Привласнюємо тому,
  // хто зайшов першим, і відразу видаляємо — другий уже не візьме.
  ls.clear();
  ls.set(DECKS_KEY, JSON.stringify([mkDeck(DECK_A_ID, 'Старий кеш')]));
  signIn(USER_A);
  const legacy = makeSandbox({ remoteDecks: [] });
  vm.runInContext('__switch()', legacy.s);
  checkThat('перший акаунт забрав старий кеш', titles(legacy.decks).includes('Старий кеш'),
    `бачить: ${JSON.stringify(titles(legacy.decks))}`);
  checkThat('старий ключ очищено', !ls.has(DECKS_KEY), `ключі: ${JSON.stringify([...ls.keys()])}`);

  console.log('\nОфлайн-робота до першого входу не губиться');
  ls.clear();
  signIn(null);
  const pre = makeSandbox();
  pre.decks = [mkDeck('33333333-3333-4333-8333-333333333333', 'Офлайн')];
  vm.runInContext('__save()', pre.s);
  checkThat('записано в загальний ключ', ls.has(DECKS_KEY), `ключі: ${JSON.stringify([...ls.keys()])}`);

  signIn(USER_A);
  const first = makeSandbox({ remoteDecks: [] });
  vm.runInContext('__switch()', first.s);
  checkThat('перший акаунт забрав офлайн-колоду', titles(first.decks).includes('Офлайн'),
    `бачить: ${JSON.stringify(titles(first.decks))}`);
  checkThat('загальний ключ очищено', !ls.has(DECKS_KEY), `ключі: ${JSON.stringify([...ls.keys()])}`);
  checkThat('запис переїхав у ключ A', ls.has(`${DECKS_KEY}:${USER_A}`), '');

  console.log('\nДругий акаунт офлайн-колоду вже не забере');
  signIn(USER_B);
  const second = makeSandbox({ remoteDecks: [] });
  vm.runInContext('__switch()', second.s);
  checkThat('B не отримав офлайн-колоду A', !titles(second.decks).includes('Офлайн'),
    `бачить: ${JSON.stringify(titles(second.decks))}`);

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); console.error(e && e.stack); process.exit(1); });
