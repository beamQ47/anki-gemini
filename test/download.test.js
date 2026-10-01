/**
 * Справжній виклик downloadDeck() у браузерному середовищі.
 *
 * Навіщо такий тест. Помилка «Не вдалося завантажити .apkg» — це
 * catch (error), який ловить усе підряд і не казує, що саме впало.
 * Статичний аналіз тут безсилий:downloadDeck звертається до функцій з
 * model.js, які живуть у глобальній області, тож помилка виникає лише
 * в момент виконання — у браузері, якого в тестах немає.
 *
 * Тут ми збираємо справжні js/*.js у спільній області (вони і в
 * браузері завантажуються як окремі <script> і бачать глобальні
 * об'явлення одне одного) і викликаємо downloadDeck з підробленим
 * fetch. Якщо в коді є ReferenceError або TypeError — тест впаде
 * тут, а не в браузері в руках користувача.
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

// --- Мінімальний DOM, достатній для renderDecks і downloadDeck ---
const toasts = [];
const elements = new Proxy({}, {
  get(target, key) {
    if (key === 'style') return new Proxy({}, {
    get: () => '', set: () => true
  });
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

const listeners = {};
const sandbox = {
  console,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
  Promise, Error, isNaN, parseInt, parseFloat, RegExp, Symbol, Proxy,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById: (id) => elements[id],
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: String(tag || '').toUpperCase(),
      click() { globalThis.__link = { href: this.href, download: this.download }; }, remove() {},
      set href(v) { this._href = v; }, get href() { return this._href; },
      style: {},
      className: '', innerHTML: '', textContent: '',
      appendChild() {}, setAttribute() {}, getAttribute() { return null; },
      download: '', rel: ''
    }),
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    // createObjectURL/createElement живуть у document/window, тож
    // виклики нижче йдуть саме сюди.
    documentElement: {
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: { setProperty() {}, removeProperty() {} },
      getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
      dataset: {}, appendChild() {}, remove() {}
    },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  },
  window: {
    addEventListener() {}, innerWidth: 1200, innerHeight: 800,
    // downloadDeck планує revokeObjectURL через window.setTimeout, тож
    // ці таймери мають бути на самому window, а не лише в глобалі.
    setTimeout, clearTimeout, setInterval, clearInterval,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    scrollTo() {}, localStorage: store(), sessionStorage: store(),
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    location: { href: 'http://127.0.0.1:8000/' },
    getComputedStyle: (el) => ({
      getPropertyValue: () => '',
      // resolveTheme() читає колір і парсить його через match. Тема
      // нам нецікава, але код має відпрацювати.
      color: 'rgb(255, 255, 255)'
    })
  },
  localStorage: store(),
  fetch: async () => { throw new Error('fetch не викликався'); },
  navigator: {
    userAgent: 'node', serviceWorker: null, vibrate() {},
    clipboard: { writeText() {} },
    // msSaveOrOpenBlob перевіряється перед createObjectURL, тож реальна
    // відсутність цього API змусить код іти звичайним шляхом через <a>.
    msSaveOrOpenBlob: undefined,
    msSaveBlob: undefined
  },
  alert() {}, confirm() { return true; },
  Intl, URLSearchParams, TextEncoder, TextDecoder
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
// У браузері module не існує, тому js/model.js не виконує блок
// module.exports. У Node він існує — тож без явного undefined тест
// випадково перевіряв би іншу гілку коду й не знайшов би помилку,
// яку користувач бачить у браузері.
sandbox.module = undefined;

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

function loadApp() {
  const ctx = vm.createContext(sandbox);
  // Спочатку усі файли — і лише потім запуск. У браузері <script>
  // виконується після завантаження всього пакета, тож функція з
  // chat.js доступна з app.js; окремий runInContext під час завантаження
  // давав би хибний ReferenceError.
  const files = ['js/runtime.js', 'js/auth.js', 'js/model.js', 'js/decks.js',
                 'js/chat.js', 'js/app.js'];
  const sources = files.map((file) => ({
    file, code: fs.readFileSync(path.join(ROOT, file), 'utf8')
  }));
  vm.runInContext(sources.map((s) => s.code).join('\n;\n'), ctx,
    { filename: files.join('+') });
  return ctx;
}

const U = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';

console.log('Файли завантажуються разом');
let ctx;
try {
  ctx = loadApp();
  pass++; console.log('  ok   runtime+model+decks+app без ReferenceError');
} catch (e) {
  fail++; console.log(`  FAIL завантаження: ${e.message}`);
  process.exit(1);
}

// appState оголошено через const, тому він не стає властивістю
// глобального об'єкта — доступ треба через сам контекст. Так само
// працює і в браузері: const не потрапляє у window.
const evalIn = (expr) => vm.runInContext(expr, ctx);
// typeof всередині контексту повертає рядок, а не значення — це нормально,
// але порівнювати треба саме з рядком.
const decl = (name) => evalIn(`typeof ${name}`);
console.log('\nФункції, які викликає downloadDeck, існують');
for (const fn of ['collectSubtreeIds', 'isSubtreeExportIdentityReady',
                  'isExportIdentityReady', 'buildExportPayload',
                  'migrateDeck', 'saveDecksLocally', 'showToast',
                  'getApiUrl', 'apiFetch', 'sanitizeFileName',
                  'haptic', 'haptic']) {
  check(`${fn} доступна`, decl(fn), 'function');
}

// Мутація: якщо collectSubtreeIds знову опиниться всередині блоку
// module.exports, вона зникне з глобальної зони браузера, і downloadDeck
// впаде з ReferenceError. Тест має це ловити, а не пропускати.
function readModelSource() {
  return require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'model.js'), 'utf8');
}
const src0 = readModelSource();
const guard = "if (typeof module !== 'undefined' && module.exports) {";
const guardAt = src0.indexOf(guard);
const exportsAt = src0.indexOf('module.exports = {');
ok('оболонка module.exports рівно одна',
   src0.split(guard).length - 1 === 1, `знайдено ${src0.split(guard).length - 1}`);
ok('оголошення функцій стоять перед module.exports',
   src0.indexOf('function collectSubtreeIds') < exportsAt && guardAt < exportsAt,
   `guard=${guardAt} exports=${exportsAt}`);
// Жодна function-декларація не має бути всередині export-оболонки.
const insideGuard = guardAt !== -1 && exportsAt !== -1
  ? src0.slice(guardAt, src0.indexOf('\n}', exportsAt))
  : '';
ok('усередині export-оболонки немає function',
   !/function\s+\w+\s*\(/.test(insideGuard),
   insideGuard.slice(0, 120));

console.log('\ndownloadDeck реально доходить до fetch');
// Ставимо колоду з однією карткою і перехоплюємо запит.
const deck = {
  id: L, title: 'лекція 1', fieldNames: ['Front', 'Back'],
  cards: [{ id: C1, values: { Front: '200', Back: 'ok' } }]
};
evalIn(`appState.decks = ${JSON.stringify([deck])};
        appState.activeDeckId = ${JSON.stringify(L)};
        appState.editorDeckId = ${JSON.stringify(L)};`);

let seen = null;
// apiFetch і showToast оголошено через function/const, тож перекриваємо
// їх усередині контексту, а не ззовні.
evalIn(`
  apiFetch = async (url, opts) => {
    globalThis.__seen = { url, method: opts.method, payload: JSON.parse(opts.body) };
    return { ok: true, status: 200, blob: async () => new Uint8Array([0x50, 0x4b, 3, 4]) };
  };
  showToast = (msg, kind) => { (globalThis.__toasts = globalThis.__toasts || []).push({ msg, kind }); };
`);
// Помилка з downloadDeck приходить із catch, який ковтає все й не каже
// що впало. Тому ловимо її тут: без цього тест бачив би лише toast
// і не міг би відрізнити збій у коді від збій у тестовому DOM.
const originalError = console.error;
console.error = (...args) => originalError(...args);
process.on('unhandledRejection', (e) => {
  originalError('unhandledRejection:', e && e.stack || e);
});
const readSeen = () => vm.runInContext('globalThis.__seen', ctx);
const readToasts = () => vm.runInContext('globalThis.__toasts || []', ctx);

// Тимчасово перехоплюємо window.setTimeout і link.click, щоб побачити
// реальну помилку з catch усередині downloadDeck.
async function captureError(deckId) {
  const probe = `
    (async () => {
      try {
        await downloadDeck(${JSON.stringify(deckId)});
        return null;
      } catch (e) {
        return e && (e.stack || e.message) || String(e);
      }
    })()
  `;
  return await evalIn(probe);
}

(async () => {
  // Помилка з catch усередині downloadDeck не виходить назовні, тож
  // виконуємо ту саму послідовність кроків вручну — так видно, на
  // якому саме рядку все ламається.
  const trace = await evalIn(`
    (async () => {
      const log = [];
      const found = appState.decks.find(item => item.id === ${JSON.stringify(L)});
      log.push('знайдено колоду: ' + Boolean(found));
      try {
        const response = await apiFetch('/api/export-deck', {
          method: 'POST', body: JSON.stringify(buildExportPayload(found, appState.decks))
        });
        log.push('fetch ok: ' + response.ok);
        const blob = await response.blob();
        log.push('blob: ' + Boolean(blob) + ' size=' + (blob && blob.byteLength));
        const url = window.URL.createObjectURL(blob);
        log.push('createObjectURL: ' + url);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'x.apkg';
        link.rel = 'noopener';
        document.body.appendChild(link);
        log.push('додано до body');
        link.click();
        log.push('click викликано');
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
        log.push('revoke заплановано');
        return log;
      } catch (e) {
        log.push('ПОМИЛКА: ' + (e && (e.name + ': ' + e.message)));
        log.push(String(e && e.stack).split('\\n').slice(0, 4).join(' | '));
        return log;
      }
    })()
  `);
  console.log('  трасування кроків завантаження:');
  for (const line of trace) console.log(`    ${line}`);

  try {
    await evalIn(`downloadDeck(${JSON.stringify(L)})`);
  } catch (e) {
    fail++; console.log(`  FAIL downloadDeck кинув: ${e.constructor.name}: ${e.message}`);
    process.exit(1);
  }

  const seen = readSeen();
  const notes = readToasts();
  ok('запит пішов на /api/export-deck', seen && seen.url === '/api/export-deck', JSON.stringify(seen));
  ok('метод POST', seen && seen.method === 'POST');
  ok('у payload є subtree', !!(seen && Array.isArray(seen.payload.subtree)));
  ok('у payload є cards', !!(seen && Array.isArray(seen.payload.cards)));
  // Помилка приходить після успішного fetch — тобто десь у коді
  // завантаження файлу. Саме тут користувач і бачить «Не вдалося».
  ok('жодного «Не вдалося»', !notes.some(t => t.msg.includes('Не вдалося')),
     JSON.stringify(notes));
  ok('тост про успіх', notes.some(t => t.msg.includes('завантажено')),
     JSON.stringify(notes));

console.log('\nЕкспорт батька з порожніми картками');
// parent_id — єдине джерело вкладеності. Без нього «університет» і
// «лекція 1» — дві несхожі колоди, і нащадка в гілці немає.
const parent = {
  id: U, title: 'університет', fieldNames: ['Front', 'Back'],
  cards: [], parentId: null
};
const childDeck = { ...deck, parentId: U };
evalIn(`appState.decks = ${JSON.stringify([parent, childDeck])};
        globalThis.__seen = null; globalThis.__toasts = [];`);
  await evalIn(`downloadDeck(${JSON.stringify(U)})`);
  const seen2 = readSeen();
  const notes2 = readToasts();
  ok('запит пішов', !!seen2, 'export не викликано');
  ok('у subtree — нащадок', !!(seen2 && seen2.payload.subtree.some(n => n.deck_id === L)),
     JSON.stringify(seen2 && seen2.payload.subtree));
  ok('жадного блокування «Немає чого експортувати»',
     !notes2.some(t => t.msg.includes('Немає чого')), JSON.stringify(notes2));

  console.log('\nКартка без id отримує стабільний GUID');
  // downloadDeck має сам мігрувати гілку. Якщо міграція зламається,
  // Anki щоразу створював би нову картку замість оновлення.
  // Кликаємо downloadDeck(parent.id), тож у списку мають лишитися обидві.
  evalIn(`appState.decks = ${JSON.stringify([parent, { ...childDeck, cards: [{ values: { Front: '1' } }] }])};
          globalThis.__seen = null; globalThis.__toasts = [];`);
  await evalIn(`downloadDeck(${JSON.stringify(U)})`);
  const seen3 = readSeen();
  const notes3 = readToasts();
  ok('export не заблоковано помилкою', !notes3.some(t => t.kind === 'error'),
     JSON.stringify(notes3));
  const cardNode = seen3 && seen3.payload.subtree.find(n => n.cards.length);
  ok('у нащадку картка отримала id', !!(cardNode && cardNode.cards[0].id),
     JSON.stringify(cardNode && cardNode.cards));

  console.log('\nПомилка сервера показується, а не ховається');
  // Раніше catch повідомляв лише URL — користувач не бачив причини.
  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
  evalIn(`
    apiFetch = async () => { const e = new Error('HTTP 422: некоректний subtree'); e.status = 422; throw e; };
    globalThis.__seen = null; globalThis.__toasts = [];
  `);
  await evalIn(`downloadDeck(${JSON.stringify(U)})`);
  console.error = realError;
  const notes4 = readToasts();
  const errToasts = notes4.filter(t => t.kind === 'error');
  ok('є toast з помилкою', errToasts.length > 0, JSON.stringify(notes4));
  ok('причина потрапила в toast', errToasts.some(t => t.msg.includes('422')),
     JSON.stringify(errToasts));
  ok('причина потрапила в консоль', logged.some(l => l.includes('422')),
     JSON.stringify(logged));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
