// Тест окремих чатів.
//
// Раніше на акаунт існував один чат: усе, про що користувач питав — фізика,
// математика — лежало в одній стрічці й однією ж історією йшло в контекст
// моделі. Тепер це список діалогів. Тут перевіряється те, що легко зламати:
// міграція старого масиву без втрати переписки, ізоляція історій між чатами,
// прив'язка до акаунта, збереження після F5 і назва за першим запитом.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MSG_KEY = 'anki-gemini-messages-v1';
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
    expiresAt: Date.now() + 3600000, userId, email: `${userId}@x.co`
  }));
}

function makeSandbox() {
  const els = new Map();
  const el = (id) => {
    if (id && els.has(id)) return els.get(id);
    const e = { id, hidden: false, value: '', textContent: '', innerHTML: '', disabled: false,
      scrollHeight: 0, scrollTop: 0, style: { setProperty: noop }, dataset: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, appendChild: noop, removeChild: noop, remove: noop,
      setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
      focus: noop, click: noop, replaceWith: noop, blur: noop, select: noop,
      querySelector: () => null, querySelectorAll: () => [], scrollTo: noop };
    if (id) els.set(id, e);
    return e;
  };

  const s = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Error, URL, URLSearchParams, Array, Object, String, Number,
    document: { getElementById: el, querySelector: () => el(null), querySelectorAll: () => [],
      addEventListener: noop, createElement: () => el(null), createElementNS: () => el(null),
      body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
      documentElement: { style: { setProperty: noop }, dataset: {}, getAttribute: () => null,
        appendChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } } },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({ decks: [] }) }),
    navigator: { userAgent: 'node', vibrate: noop, serviceWorker: null },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: noop,
    getComputedStyle: () => ({ color: 'rgb(1,2,3)', getPropertyValue: () => '' }),
    location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', reload: noop },
    alert: noop, confirm: () => true, addEventListener: noop, removeEventListener: noop, scrollTo: noop
  };
  s.window = s;
  s.globalThis = s;
  vm.createContext(s);
  for (const n of ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', n), 'utf8'), s, { filename: n });
  }
  return s;
}

const run = (s, expr) => vm.runInContext(expr, s);
const read = (s, expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, s));

const ids = (s) => read(s, 'appState.chats.map((chat) => chat.id)');
const messagesOf = (s, id) => read(s, `(appState.chats.find((chat) => chat.id === ${JSON.stringify(id)}) || {}).messages || []`);
const contents = (messages) => messages.map((m) => m.content);
const titleOf = (s, id) => read(s, `(appState.chats.find((chat) => chat.id === ${JSON.stringify(id)}) || {}).title || ''`);

(async () => {
  console.log('\nСтарий масив поверх повідомлень мігрує в один чат без втрат');
  signIn(USER_A);
  ls.set(`${MSG_KEY}:${USER_A}`, JSON.stringify([
    { id: 'old1', role: 'user', type: 'text', content: 'старе питання про межі', createdAt: 1 },
    { id: 'old2', role: 'assistant', type: 'text', content: 'стара відповідь', createdAt: 2 }
  ]));
  const migrated = makeSandbox();
  check('один чат', read(migrated, 'appState.chats.length'), 1);
  check('обидва повідомлення на місці', read(migrated, 'appState.messages.length'), 2);
  check('порядок збережено', contents(read(migrated, 'appState.messages')),
    ['старе питання про межі', 'стара відповідь']);
  check('назва взята з першого запиту', titleOf(migrated, ids(migrated)[0]), 'старе питання про межі');

  console.log('\nДва чати мають незалежні історії');
  ls.clear();
  signIn(USER_A);
  const s = makeSandbox();
  const mathId = read(s, `createChat({ title: 'Математика', messages: [
    { id: 'm1', role: 'user', type: 'text', content: 'похідна', createdAt: 1 }
  ] }).id`);
  const physicsId = read(s, `createChat({ title: 'Фізика', messages: [
    { id: 'p1', role: 'user', type: 'text', content: 'імпульс', createdAt: 2 }
  ] }).id`);
  check('три чати: привітальний + два створені', read(s, 'appState.chats.length'), 3);
  check('активний — щойно створений', read(s, 'appState.activeChatId'), physicsId);
  check('стрічка активного = Фізика', contents(read(s, 'appState.messages')), ['імпульс']);

  run(s, `switchChat(${JSON.stringify(mathId)})`);
  check('перемкнули на Математику', read(s, 'appState.activeChatId'), mathId);
  check('стрічка Математики', contents(read(s, 'appState.messages')), ['похідна']);

  run(s, `switchChat(${JSON.stringify(physicsId)})`);
  check('назад на Фізику — знову лише імпульс', contents(read(s, 'appState.messages')), ['імпульс']);

  // Головна вимога: дописування в один чат не чіпає інший.
  run(s, `appState.messages.push({ id: 'p2', role: 'user', type: 'text', content: 'енергія', createdAt: 3 }); saveMessagesLocally();`);
  check('у Фізиці два повідомлення', contents(messagesOf(s, physicsId)), ['імпульс', 'енергія']);
  check('у Математиці досі одне', contents(messagesOf(s, mathId)), ['похідна']);

  console.log('\nНазва чату виводиться з першого запиту');
  run(s, `createChat({})`);
  check('новий чат без назви', titleOf(s, read(s, 'appState.activeChatId')), '');
  run(s, `appState.messages.push({ id: 'q1', role: 'user', type: 'text', content: '  Що таке інтеграл?  ', createdAt: 4 }); saveMessagesLocally();`);
  check('назва = перший запит', titleOf(s, read(s, 'appState.activeChatId')), 'Що таке інтеграл?');

  console.log('\nПерейменування');
  check('перейменування працює', run(s, `renameChat(${JSON.stringify(mathId)}, '  Матан  ')`), true);
  check('пробіли обрізано', titleOf(s, mathId), 'Матан');
  check('порожня назва відхиляється', run(s, `renameChat(${JSON.stringify(mathId)}, '   ')`), false);
  check('назва не зіпсована', titleOf(s, mathId), 'Матан');

  console.log('\nВидалення');
  run(s, `deleteChat(${JSON.stringify(physicsId)})`);
  checkThat('Фізики більше немає', !ids(s).includes(physicsId));
  checkThat('решта чатів лишилася', ids(s).includes(mathId));
  // Видаляємо геть усе: застосунок не має лишитися без жодного чату.
  run(s, `while (appState.chats.length > 1) deleteChat(appState.chats[0].id);`);
  run(s, `deleteChat(appState.chats[0].id)`);
  check('після видалення останнього є один порожній чат', read(s, 'appState.chats.length'), 1);
  check('цей чат порожній', read(s, 'appState.messages.length'), 0);
  checkThat('id валідний', typeof read(s, 'appState.activeChatId') === 'string');

  console.log('\nЗбереження переживає F5');
  ls.clear();
  signIn(USER_A);
  const before = makeSandbox();
  read(before, `createChat({ title: 'Алгебра' }).id`);
  read(before, `createChat({ title: 'Геометрія' }).id`);
  run(before, `appState.messages.push({ id: 'g1', role: 'user', type: 'text', content: 'трикутник', createdAt: 5 }); saveMessagesLocally();`);
  const activeBefore = read(before, 'appState.activeChatId');
  const beforeIds = ids(before);
  const after = makeSandbox();   // той самий ls = те саме сховище
  check('усі чати відновлено', ids(after).sort(), [...beforeIds].sort());
  check('активний чат відновлено', read(after, 'appState.activeChatId'), activeBefore);
  check('історія активного відновлена', contents(read(after, 'appState.messages')), ['трикутник']);

  console.log('\nІсторії не змішуються між акаунтами');
  signIn(USER_B);
  const other = makeSandbox();
  run(other, 'switchToCurrentUserCache()');
  checkThat('B не бачить чатів A',
    !ids(other).some((id) => beforeIds.includes(id)),
    `ids=${JSON.stringify(ids(other))}`);
  const bChat = read(other, `createChat({ title: 'Історія' }).id`);
  check('у B свій чат', ids(other).includes(bChat), true);
  checkThat('ключі різні', read(other, 'messagesStorageKey()') !== `${MSG_KEY}:${USER_A}`);

  signIn(USER_A);
  run(after, 'switchToCurrentUserCache()');
  check('A повернувся до своїх чатів', ids(after).sort(), [...beforeIds].sort());
  checkThat('чатів B у A немає', !ids(after).includes(bChat));

  console.log('\nСтарий API loadMessages() лишається робочим');
  check('loadMessages повертає масив', Array.isArray(read(after, 'loadMessages([])')), true);

  console.log('\nВідповідь лягає в чат-джерело, навіть якщо перемкнути під час очікування');
  ls.clear();
  signIn(USER_A);
  const sw = makeSandbox();
  const aId = read(sw, `createChat({ title: 'Математика' }).id`);
  const bId = read(sw, `createChat({ title: 'Фізика', messages: [
    { id: 'b1', role: 'user', type: 'text', content: 'імпульс', createdAt: 1 }
  ] }).id`);
  run(sw, `
    appState.selectedFile = null;
    elements.messageInput.value = 'питання з математики';
    globalThis.__resolve = null;
    getAssistantReply = () => new Promise((resolve) => { globalThis.__resolve = resolve; });
    switchChat(${JSON.stringify(aId)});
    globalThis.__pending = submitChat();
  `);
  check('запит пішов у Математику', read(sw, `appState.chats.find((c) => c.id === ${JSON.stringify(aId)}).messages.length`), 2);
  check('у Фізиці лише її повідомлення', contents(messagesOf(sw, bId)), ['імпульс']);

  run(sw, `switchChat(${JSON.stringify(bId)})`);   // користувач перемкнувся, поки чекав
  run(sw, `globalThis.__resolve({ content: 'відповідь A', cards: [], fieldNames: [], modelCss: '', templates: [] });`);
  await run(sw, 'globalThis.__pending');
  await new Promise((r) => setTimeout(r, 20));
  check('відповідь прийшла в Математику', contents(messagesOf(sw, aId)), ['питання з математики', 'відповідь A']);
  check('Фізику не зачеплено', contents(messagesOf(sw, bId)), ['імпульс']);
  check('активним лишився Фізика', read(sw, 'appState.activeChatId'), bId);

  console.log('\nКількість чатів обмежена');
  ls.clear();
  signIn(USER_A);
  const many = makeSandbox();
  run(many, `for (let i = 0; i < 70; i++) createChat({ title: 'Чат ' + i });`);
  check('не більше 60 чатів', read(many, 'appState.chats.length'), 60);

  console.log('\nФормули в повідомленнях типсетиться, коли стрічка перемальовується');
  // Без цього виклику картки в чаті лишалися б із сирим "\(" — MathJax
  // завантажується async і сам нічого не знає про нові повідомлення.
  ls.clear();
  signIn(USER_A);
  const math = makeSandbox();
  run(math, `globalThis.__typed = [];
    window.MathJax = { startup: { promise: Promise.resolve() },
      typesetPromise: (nodes) => { globalThis.__typed.push(nodes); return Promise.resolve(); } };`);
  run(math, `appState.chats[0].messages = [
    { id: 'f1', role: 'user', type: 'text', content: 'розв\\'яжи \\(x^2\\)', createdAt: 1 },
    { id: 'f2', role: 'assistant', type: 'text', content: 'відповідь \\(x^2 = 4\\)', createdAt: 2 }
  ];
  globalThis.__typed.length = 0;
  renderMessages();`);
  await new Promise((r) => setTimeout(r, 0));
  // Точну кількість не ловимо: ініціалізація застосунку теж перемальовує
  // стрічку. Важливо, що виклик є і що він на контейнері повідомлень.
  checkThat('MathJax викликано після рендеру', read(math, '__typed.length') >= 1,
    `викликів: ${read(math, '__typed.length')}`);
  checkThat('типсетиться контейнер повідомлень',
    read(math, '__typed[__typed.length - 1][0] === elements.messages'),
    JSON.stringify(read(math, '__typed.map((n) => n.map((x) => x.id))')));

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); console.error(e && e.stack); process.exit(1); });
