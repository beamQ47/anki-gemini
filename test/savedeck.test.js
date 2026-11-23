/**
 * Регресії, знайдені користувачем на живому застосунку:
 *
 * 1. «Поля не збігаються — створіть нову колоду» при збереженні карток
 *    у ПОРОЖНЮ колоду, і те саме — коли нову колоду створити, а потім
 *    обрати її. Перевірка canMergeCards порівнювала імена полів колоди
 *    з іменами полів карток. Але кожна нова колода народжується з
 *    типовими ['Front','Back','Extra'] (createDeck), тоді як модель із
 *    чату приносить власні імена — і збереження блокувалося завжди.
 *    Порожній колоді нема що втрачати: вона має просто прийняти імена
 *    полів тих карток, які в неї кладуть.
 *
 * 2. Чат зникав після перезавантаження сторінки: appState.messages жив
 *    тільки в пам'яті, жодного запису в localStorage не було. Через це
 *    губилися і текст запиту, і картки, які користувач ще не встиг
 *    зберегти.
 *
 * Обидва випадки відтворюються на справжніх js/*.js у VM, а не на
 * копії логіки: саме через розрив між файлами перший баг і проскочив.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;

function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${g}\n         want ${w}`); }
}
function ok(label, value, detail) {
  if (value) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail || ''}`); }
}

// --- Мінімальний DOM, як у download.test.js ---
function store() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] || null,
    get length() { return m.size; }
  };
}

// localStorage має бути спільним для контекстів, щоб перевірити
// збереження чату між «перезавантаженнями» сторінки.
const sharedStorage = store();

function makeElements() {
  return new Proxy({}, {
    get(target, key) {
      if (key === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (!(key in target)) {
        target[key] = {
          innerHTML: '', textContent: '', value: '', hidden: false,
          disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          dataset: {}, style: {}, children: [], options: [],
          addEventListener() {}, appendChild() {}, remove() {}, focus() {},
          querySelector() { return null; }, querySelectorAll() { return []; },
          setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
          closest() { return null; }, scrollIntoView() {}
        };
      }
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; }
  });
}

function loadApp() {
  const elements = makeElements();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Promise, Error, isNaN, parseInt, parseFloat, RegExp, Symbol, Proxy,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      getElementById: (id) => elements[id],
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tagName: String(tag || '').toUpperCase(),
        click() {}, remove() {},
        set href(v) { this._href = v; }, get href() { return this._href; },
        style: {}, className: '', innerHTML: '', textContent: '',
        appendChild() {}, setAttribute() {}, getAttribute() { return null; },
        download: '', rel: ''
      }),
      body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
      documentElement: {
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        style: { setProperty() {}, removeProperty() {} },
        getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
        dataset: {}, appendChild() {}, remove() {}
      },
      addEventListener() {}
    },
    window: {
      addEventListener() {}, innerWidth: 1200, innerHeight: 800,
      setTimeout, clearTimeout, setInterval, clearInterval,
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      scrollTo() {}, localStorage: sharedStorage, sessionStorage: store(),
      URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
      location: { href: 'http://127.0.0.1:8000/' },
      getComputedStyle: () => ({ getPropertyValue: () => '', color: 'rgb(255,255,255)' })
    },
    localStorage: sharedStorage,
    fetch: async () => { throw new Error('fetch не викликався'); },
    navigator: { userAgent: 'node', serviceWorker: null, vibrate() {}, clipboard: { writeText() {} } },
    alert() {}, confirm() { return true; },
    Intl, URLSearchParams, TextEncoder, TextDecoder
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.module = undefined;

  const ctx = vm.createContext(sandbox);
  const files = ['js/runtime.js', 'js/auth.js', 'js/model.js', 'js/decks.js',
                 'js/chat.js', 'js/app.js'];
  const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: files.join('+') });
  return { ctx, sandbox };
}

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

console.log('Файли завантажуються разом');
let app;
try {
  app = loadApp();
  pass++; console.log('  ok   runtime+model+decks+chat+app без ReferenceError');
} catch (e) {
  fail++; console.log(`  FAIL завантаження: ${e.message}`);
  process.exit(1);
}

const evalIn = (expr) => vm.runInContext(expr, app.ctx);
const decl = (name) => evalIn(`typeof ${name}`);

console.log('\nФункції, потрібні для сценарію');
for (const fn of ['confirmDeckModal', 'openDeckModal', 'canMergeCards', 'deckFieldNames',
                  'saveMessagesLocally', 'loadMessages', 'messagesStorageKey', 'createDeck']) {
  check(`${fn} доступна`, decl(fn), 'function');
}

(async () => {
  const toasts = [];
  evalIn(`
    showToast = (msg, kind) => { globalThis.__toasts.push({ msg, kind: kind || null }); };
    renderDecks = () => {};
    renderMessages = () => {};
    setStorageStatus = () => {};
    haptic = () => {};
    // Сервер недоступний: перевіряємо локальне збереження, тож
    // pushDeckChain не має впасти на fetch.
    apiRequestJson = async () => ({});
    globalThis.__toasts = [];
  `);
  const readToasts = () => vm.runInContext('globalThis.__toasts', app.ctx);

  // Картки з чату: модель сама вибрала TWO поля з власними іменами.
  const chatCards = [
    { values: { 'Питання': 'Що таке Anki?', 'Відповідь': 'Програма для інтервальних повторень.' } },
    { values: { 'Питання': 'Що таке SRS?', 'Відповідь': 'Інтервальне повторення.' } }
  ];
  const chatFieldNames = ['Питання', 'Відповідь'];

  console.log('\nБАГ 1: збереження в ПОРОЖНЮ колоду');
  // Порожня колода з типовими іменами полів — рівно та, що її створює
  // createDeck(title, []).
  evalIn(`
    appState.decks = [{
      id: ${JSON.stringify(D1)}, title: 'Мої колоди', parentId: null,
      fieldNames: ['Front','Back','Extra'], cards: [], updatedAt: 1
    }];
    appState.activeDeckId = ${JSON.stringify(D1)};
    appState.editorDeckId = null;
    openDeckModal('save', ${JSON.stringify(chatCards)}, {
      fieldNames: ${JSON.stringify(chatFieldNames)},
      css: '.card { color: #111; }', templates: [{ name: 'Картка' }]
    });
    globalThis.__toasts = [];
    elements.newDeckName.value = '';
  `);
  await evalIn(`confirmDeckModal()`);
  const toastsEmpty = readToasts();
  ok('збереження не заблоковано',
     !toastsEmpty.some((t) => t.msg.includes('Поля не збігаються')),
     JSON.stringify(toastsEmpty));
  const savedEmpty = evalIn(`appState.decks[0].cards`);
  check('картки збережено в порожню колоду', savedEmpty.length, 2);
  check('імена полів колоди перейнято з карток',
        evalIn(`appState.decks[0].fieldNames`), chatFieldNames);
  check('css модели перейнято', evalIn(`appState.decks[0].modelCss`), '.card { color: #111; }');
  check('шаблони перейнято', evalIn(`appState.decks[0].templates.length`), 1);

  console.log('\nБАГ 1 (продовження): створити нову колоду й обрати її');
  // Рівно те, що робить користувач: у полі вводить назву, потім
  // зберігає. Нова колода теж порожня, тож має прийняти імена полів.
  evalIn(`
    appState.decks = [{
      id: ${JSON.stringify(D1)}, title: 'Мої колоди', parentId: null,
      fieldNames: ['Front','Back','Extra'], cards: [], updatedAt: 1
    }];
    openDeckModal('save', ${JSON.stringify(chatCards)}, {
      fieldNames: ${JSON.stringify(chatFieldNames)},
      css: '.card { color: #222; }', templates: []
    });
    globalThis.__toasts = [];
    elements.newDeckName.value = 'Математика';
  `);
  await evalIn(`confirmDeckModal()`);
  const toastsNew = readToasts();
  ok('збереження в щойно створену колоду не заблоковано',
     !toastsNew.some((t) => t.msg.includes('Поля не збігаються')),
     JSON.stringify(toastsNew));
  const newDeck = evalIn(`appState.decks.find(d => d.title === 'Математика')`);
  ok('нову колоду створено', !!newDeck);
  check('у новій колоді картки', newDeck && newDeck.cards.length, 2);
  check('у новій колоді правильні імена полів', newDeck && newDeck.fieldNames, chatFieldNames);
  // У режимі 'save' appState.pendingParentId скидається в null, тож
  // колода без «::» у назві створюється в корені. Це не баг: батька
  // можна задати шляхом «університет::математика», і це тестовано
  // окремо в test_hierarchy.py та test_api_hierarchy.py.
  check('нова колода створена в корені', newDeck && newDeck.parentId, null);

  console.log('\nБАГ 1 (продовження): непорожня колода з іншими полями');
  // Тут відмова правильна: у колоді вже є картки, їхні значення не
  // можна перекласти в поля з іншими іменами — вони б порожніли.
  evalIn(`
    appState.decks = [{
      id: ${JSON.stringify(D1)}, title: 'Існуюча', parentId: null,
      fieldNames: ['Front','Back'], cards: [
        { id: 'aaaaaaaa-1111-4111-8111-111111111111', values: { Front: 'x', Back: 'y' } }
      ], updatedAt: 1
    }];
    appState.activeDeckId = ${JSON.stringify(D1)};
    openDeckModal('save', ${JSON.stringify(chatCards)}, {
      fieldNames: ${JSON.stringify(chatFieldNames)}, css: '', templates: []
    });
    globalThis.__toasts = [];
    elements.newDeckName.value = '';
  `);
  await evalIn(`confirmDeckModal()`);
  const toastsBusy = readToasts();
  ok('непорожня колода з чужими полями — відмова',
     toastsBusy.some((t) => t.msg.includes('Поля не збігаються')),
     JSON.stringify(toastsBusy));
  check('картки не додалися', evalIn(`appState.decks[0].cards.length`), 1);

  console.log('\nБАГ 1 (продовження): непорожня колода з ТИМИ самими полями');
  evalIn(`
    appState.decks = [{
      id: ${JSON.stringify(D1)}, title: 'Сумісна', parentId: null,
      fieldNames: ${JSON.stringify(chatFieldNames)}, cards: [
        { id: 'bbbbbbbb-1111-4111-8111-111111111111', values: { 'Питання': 'q', 'Відповідь': 'a' } }
      ], updatedAt: 1
    }];
    appState.activeDeckId = ${JSON.stringify(D1)};
    openDeckModal('save', ${JSON.stringify(chatCards)}, {
      fieldNames: ${JSON.stringify(chatFieldNames)}, css: '', templates: []
    });
    globalThis.__toasts = [];
    elements.newDeckName.value = '';
  `);
  await evalIn(`confirmDeckModal()`);
  check('картки додалися', evalIn(`appState.decks[0].cards.length`), 3);

  console.log('\nБАГ 2: чат не зберігається');
  // Важливо: перевіряємо не виклик saveMessagesLocally(), а справжній
  // submitChat() — саме він у реальності мусить зберегти переписку.
  // Інакше тест був би зелений навіть із вирізаними викликами.
  evalIn(`
    getAssistantReply = async () => ({
      content: 'відповідь', cards: ${JSON.stringify(chatCards)},
      fieldNames: ${JSON.stringify(chatFieldNames)},
      modelCss: '.card { color: #333; }', templates: []
    });
    showAttachment = () => {};
    updateMessageInput = () => {};
    clearAttachment = () => {};
    appState.selectedFile = null;
    appState.messages = [];
    elements.messageInput.value = 'що таке Anki?';
    globalThis.__toasts = [];
  `);
  await evalIn(`submitChat()`);
  check('після submitChat у appState два повідомлення',
        evalIn('appState.messages.length'), 2);
  const key = evalIn('messagesStorageKey()');
  ok('ключ chat створено самим submitChat', !!sharedStorage.getItem(key), `key=${key}`);
  // Зберігається не голий масив, а список чатів: перевіряємо повідомлення
  // саме активного чату.
  const payload = JSON.parse(sharedStorage.getItem(key) || '{}');
  const stored = (payload.chats || []).find((chat) => chat.id === payload.activeId)?.messages || [];
  check('у сховищі два повідомлення, loading відкинуто', stored.length, 2);
  check('текст запиту збережено', stored[0] && stored[0].content, 'що таке Anki?');
  // Картки мають зберегтися разом із полями: без них повідомлення
  // після F5 лишилося б текстом, і «збережити картки» було б неможливе.
  const storedCards = stored[1] || {};
  check('картки збережено', (storedCards.cards || []).length, 2);
  check('імена полів збережено', storedCards.fieldNames, chatFieldNames);
  check('css збережено', storedCards.modelCss, '.card { color: #333; }');

  // Виняток: повідомлення про помилку теж має лишатися, але не як
  // «помилка API» — інакше користувач після F5 бачив би лише напис
  // «бекенд не запущено» про запит, який так і не пішов.
  evalIn(`
    appState.messages = [];
    globalThis.__toasts = [];
  `);
  ok('помилка теж записується в чат', (() => {
    try {
      evalIn(`
        getAssistantReply = async () => { throw new Error('сервер мертвий'); };
        elements.messageInput.value = ' друге питання';
        submitChat();
      `);
    } catch (e) { /* async */ }
    return true;
  })());
  await new Promise((r) => setTimeout(r, 30));
  const afterErrPayload = JSON.parse(sharedStorage.getItem(key) || '{}');
  const afterErr = (afterErrPayload.chats || []).find((chat) => chat.id === afterErrPayload.activeId)?.messages || [];
  check('і помилкове повідомлення збережено', afterErr.length, 2);
  ok('текст помилки присутній',
     afterErr.some((m) => m.content && m.content.includes('Не вдалося')),
     JSON.stringify(afterErr.map((m) => m.type)));

  // Імітуємо перезавантаження сторінки: новий контекст, той самий
  // localStorage. Це те, що бачить користувач після F5.
  sharedStorage.setItem(
    'anki-gemini-messages-v1:u1',
    JSON.stringify([
      { id: 'm1', role: 'user', type: 'text', content: 'питання після F5', createdAt: 1 },
      { id: 'm2', role: 'assistant', type: 'loading', createdAt: 2 }
    ])
  );
  const reloaded = loadApp();
  const evalReloaded = (expr) => vm.runInContext(expr, reloaded.ctx);
  // Імітуємо вхід у акаунт u1 — саме тоді додається chat до кешу.
  evalReloaded(`
    window.AnkiAuth = { getSession: () => ({ userId: 'u1' }) };
    appState.messages = [{ id: 'welcome', role: 'assistant', type: 'text', content: 'Привіт', createdAt: 0 }];
    switchToCurrentUserCache();
  `);
  const afterReload = evalReloaded('appState.messages');
  check('після перезавантаження чат відновлено разом із loading', afterReload.length, 2);
  check('відновлено саме те повідомлення', afterReload[0].content, 'питання після F5');
  check('стан loading від ШІ збережено і не зник', afterReload[1].type, 'loading');

  console.log('\nБАГ 2 (продовження): чат прив’язаний до акаунта');
  const otherKey = 'anki-gemini-messages-v1:u2';
  const evalOther = (expr) => vm.runInContext(expr, reloaded.ctx);
  evalOther(`
    window.AnkiAuth = { getSession: () => ({ userId: 'u2' }) };
    appState.messages = [{ id: 'x', role: 'user', type: 'text', content: 'чужий', createdAt: 0 }];
    switchToCurrentUserCache();
  `);
  check('в іншому акаунті чат порожній (є лише привітання)',
        evalOther('appState.messages.length'), 1);
  ok('ключ іншого акаунта інший', evalOther('messagesStorageKey()') !== key);

  console.log('\nКлючі сховища не змішуються');
  ok('ключ колод і ключ чату різні',
     evalIn('deckStorageKey()') !== evalIn('messagesStorageKey()'),
     `${evalIn('deckStorageKey()')} vs ${evalIn('messagesStorageKey()')}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
