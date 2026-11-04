/**
 * UI ієрархії: звіряє розмітку index.html з тим, що шукає код, і
 * проганяє справжні сценарії decks.js.
 *
 * Чому не jsdom: у проєкта немає жодної залежності й немає кроку
 * npm install. Тому браузер тут не запускається, а перевіряються дві
 * речі, які ламаються найчастіше:
 *
 *   1. Розрив дрітінгу. Рядок у decks.js каже data-action="toggle-deck-node",
 *      а в обробнику в app.js такого рядка немає — кнопка мовчки
 *      нічого не робить, жодного помилки в консолі, тести функцій
 *      проходять. Тому кожен data-action з розустанованого HTML
 *      звіряється з обробником, а кожен elements.X — з id у index.html.
 *   2. Справжній вивід renderDecks/renderDeckOptions на трирівневому
 *      дереві: вкладення, breadcrumbs, заборонені варіанти батька.
 *
 * Стан DOM тут справжній настільки, наскільки потрібен: елементи
 * живі, innerHTML зберігається, тому можна читати розустановану
 * розмітку і робити вибірки.
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
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail || ''}`); }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const decksSource = fs.readFileSync(path.join(ROOT, 'js', 'decks.js'), 'utf8');

// --- 1. Розрив дрітінгу -------------------------------------------------
console.log('id в index.html vs keys в elements');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const elementsBlock = appSource.slice(
  appSource.indexOf('const elements = {'),
  appSource.indexOf('\n};', appSource.indexOf('const elements = {')));
const elementKeys = [...elementsBlock.matchAll(/^\s{2}([A-Za-z]\w*):\s*document\.getElementById\('([^']+)'\)/gm)]
  .map(m => ({ key: m[1], id: m[2] }));
ok('розмітку розібрано', htmlIds.size > 40, `знайдено ${htmlIds.size} id`);
ok('елементів у elements не порожньо', elementKeys.length > 20, `знайдено ${elementKeys.length}`);
const missingIds = elementKeys.filter(e => !htmlIds.has(e.id));
check('кожен elements.X має такий самий id у розмітці',
  missingIds.map(e => e.id), []);
// Зворотний бік: ids, до яких звертаються напряму через getElementById
const directIds = [...appSource.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
check('і прямі getElementById не блукають',
  [...new Set(directIds)].filter(id => !htmlIds.has(id)), []);

console.log('\ndata-action з розустанованого HTML має обробник');
// Стан DOM тут справжній настільки, наскільки потрібен: елементи живі
// (той самий екземпляр на той самий id), innerHTML зберігається, classList
// пам'ятає класи. Це дозволяє читати розустановану розмітку і робити
// вибірки. Чого тут немає — таксономії та layout.
// sandbox.document.activeElement у стабі: фокус треба відстежувати, бо вся
// клавіатурна навігація списком стилів побудована на ньому.
const focusState = { active: null };
const makeStub = () => {
  const classes = new Set();
  const el = {
    innerHTML: '', value: '', textContent: '', disabled: false, className: '',
    attrs: {},
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      // Повертає новий стан, як у справжньому DOM: на ньому тримається
      // логіка розкриття секції стилю.
      toggle: (c, force) => {
        const next = force === undefined ? !classes.has(c) : Boolean(force);
        if (next) classes.add(c); else classes.delete(c);
        return next;
      },
      contains: c => classes.has(c)
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    setSelectionRange() {},
    // Обираємо реальні варіанти з намальованого innerHTML, а не порожній
    // масив: інакше перевірки клавіатури списку проходили б, нічого не
    // торкаючись, і стрілки/Enter зламалися б непомітно.
    querySelectorAll(selector) { return matchOptions(this, selector); },
    querySelector(selector) { return matchOptions(this, selector)[0] || null; },
    // closest спершу перевіряє сам елемент, а потім предків: Enter має
    // підхопити той варіант, на якому стоїть фокус, а не перший у списку.
    closest(selector) {
      if (matchesSelf(this, selector)) return this;
      return this.parentNode ? this.parentNode.closest(selector) : null;
    },
    append() {}, remove() {}, select() {}, click() {},
    addEventListener() {},
    focus() { focusState.active = this; },
    contains(node) {
      let cur = node;
      while (cur) { if (cur === this) return true; cur = cur.parentNode; }
      return false;
    },
    parentNode: null,
    dataset: {}, files: []
  };
  return el;
};

// Чи підходить сам вузол під селектор із data-атрибутом. Вузли списку
// стилів не мають власного innerHTML, тож matchOptions їх не знайде.
function matchesSelf(el, selector) {
  if (selector !== '[data-generation-style]') return false;
  return Object.prototype.hasOwnProperty.call(el.dataset, 'generationStyle');
}

// DOM-вузли, вирізані з рядка innerHTML. Повний парсер тут не потрібен:
// список стилів — це плоскі кнопки з одним data-атрибутом, і саме їх
// перевіряють стрілки та Enter. Вузли кешуються: кожен виклик
// querySelectorAll має повертати ті самі об'єкти, інакше порівняння
// document.activeElement === варіант завжди давало б false.
const optionCache = new WeakMap();
function matchOptions(root, selector) {
  if (selector !== '[data-generation-style]') return [];
  const ids = [...String(root.innerHTML || '').matchAll(/data-generation-style="([^"]*)"/g)]
    .map(m => m[1]);
  let cache = optionCache.get(root);
  if (!cache || cache.innerHTML !== root.innerHTML) {
    cache = { innerHTML: root.innerHTML, nodes: new Map() };
    optionCache.set(root, cache);
  }
  return ids.map(value => {
    if (!cache.nodes.has(value)) {
      const el = makeStub();
      el.dataset = { generationStyle: value };
      el.parentNode = root;
      cache.nodes.set(value, el);
    }
    return cache.nodes.get(value);
  });
}
const liveElements = new Map();
const toasts = [];
const confirmCalls = [];
// Запити до сервера: без них не перевірити головне в очищенні колоди —
// що пішов PUT карток із порожнім списком, а не видалення колоди.
const apiCalls = [];
let idSeq = 0;

// Один Recorder на весь файл: сценарії нижче підміняють sandbox.apiRequestJson
// своїми заглушками, і без відновлення наступний сценарій писав би не туди.
const recordApi = async (path, options = {}) => {
  apiCalls.push({ path, method: options.method || 'GET', body: options.body || '' });
  return { decks: [], cards: [] };
};

const sandbox = {
  console, Date, Math, JSON, Object, Array, Set, Map, String, Number, Boolean, isNaN,
  module: undefined,
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  },
  document: {
    getElementById(id) {
      if (!liveElements.has(id)) liveElements.set(id, makeStub());
      return liveElements.get(id);
    },
    createElement: () => makeStub(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
    body: { append() {} },
    get activeElement() { return focusState.active; },
    addEventListener() {}
  },
  window: { setTimeout: fn => { if (typeof fn === 'function') fn(); }, URL: { createObjectURL: () => '', revokeObjectURL() {} } },
  navigator: {}, location: { origin: 'http://127.0.0.1:8000' },
  setTimeout() {},
  STORAGE_KEY: 'test', desktopQuery: { matches: false },
  escapeHtml: value => String(value ?? '').replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])),
  // Унікальні id, як у createId у браузері: спільний для всіх колід
  // ідентифікатор змусив би кожну перевірку батька «успішною».
  createId: () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
  // currentUserId() з auth.js: ключ вибору стилю прив'язаний до акаунта.
  currentUserId: () => 'test-user',
  refreshIcons() {}, haptic() {},
  showToast: (text, kind) => toasts.push({ text, kind }),
  // decks.js кличе openConfirmModal(title, text, onConfirm) — зберігаємо
  // всі аргументи, а не перший.
  openConfirmModal: (...args) => confirmCalls.push(args),
  sendToBackend: async () => ({ ok: false }),
  getApiUrl: p => `http://127.0.0.1:8000${p}`,
  apiFetch: async () => ({ blob: async () => ({}) }),
  apiRequestJson: recordApi,
  pluralizeCards: () => 'карток', pluralizeDecks: () => 'колод',
  sanitizeFileName: v => v, formatRelativeDate: () => 'щойно'
};
sandbox.appState = {
  decks: [], activeDeckId: null, editorDeckId: null, editorCardId: null,
  collapsedDeckIds: new Set(), pendingParentId: null, selectedModalDeckId: null,
  modalMode: null, pendingCards: [], pendingFieldNames: [], pendingModelCss: '',
  pendingTemplates: [], generationStyleId: ''
};
for (const id of ['editorDeckPath', 'deckModal', 'deckModalTitle', 'deckModalDescription',
  'confirmDeckModalText', 'newDeckFieldWrap', 'saveDeckOptionsWrap', 'messages',
  'confirmModal', 'confirmModalText', 'acceptConfirmButton']) {
  sandbox.document.getElementById(id);
}
// Стартовий стан меню стилів беремо з index.html: стаб сам розмітку не читає,
// тож без цього перевірялося б те, чого на екрані спершу немає.
seedInitialState('generationStyleList', { classes: ['hidden'] });
seedInitialState('generationStyleButton', { attrs: { 'aria-expanded': 'false', 'aria-haspopup': 'listbox', 'aria-controls': 'generationStyleList' } });

// Розмічає один елемент index.html: класи й атрибути з рядка, де він оголошений.
function seedInitialState(id, { classes = [], attrs = {} } = {}) {
  const tag = [...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].find(m => m[1] === id);
  if (!tag) throw new Error(`seedInitialState: у index.html немає id="${id}"`);
  const el = sandbox.document.getElementById(id);
  for (const cls of [...String(tag[0]).matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/))) {
    el.classList.add(cls);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
// У браузері elements — це const у app.js, а decks.js користується ним як
// глобальним. Тут app.js не запускається (він слухає події й малює все
// одразу), тому elements — Proxy на ті самі живі елементи, які дає
// document.getElementById. Ключі й id звірені вище.
sandbox.elements = new Proxy({}, {
  get: (_t, key) => sandbox.document.getElementById(String(key))
});

const ctx = vm.createContext(sandbox);
for (const file of ['js/model.js', 'js/decks.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const U = '11111111-1111-4111-8111-111111111111';
const MATH = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';
const PHYS = '55555555-5555-4555-8555-555555555555';
const LOOSE = '66666666-6666-4666-8666-666666666666';
const STYLE = '77777777-7777-4777-8777-777777777777';
sandbox.appState.decks = [
  { id: U, title: 'університет', parentId: null, fieldNames: ['Питання'], cards: [{ id: L1, values: { Питання: 'a' } }] },
  { id: MATH, title: 'математика', parentId: U, fieldNames: ['Питання'], cards: [] },
  { id: L1, title: 'лекція 1', parentId: MATH, fieldNames: ['Питання'], cards: [{ id: L2, values: { Питання: 'b' } }] },
  { id: L2, title: 'лекція 2', parentId: MATH, fieldNames: ['Питання'], cards: [] },
  { id: PHYS, title: 'фізика', parentId: U, fieldNames: ['Питання'], cards: [] },
  { id: LOOSE, title: 'Оране', parentId: null, fieldNames: ['Питання'], cards: [] }
];
sandbox.appState.activeDeckId = L1;
sandbox.renderDecks();
const deckHtml = sandbox.elements.deckList.innerHTML;

const renderedActions = [...new Set([...deckHtml.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]))].sort();
const handledActions = [...new Set(
  [...appSource.matchAll(/dataset\.action\s*===\s*'([^']+)'/g)].map(m => m[1]))].sort();
check('кожна намальована кнопка має обробник',
  renderedActions.filter(a => !handledActions.includes(a)), []);
ok('обробники не покидають мертвих кнопок', renderedActions.length >= 6, renderedActions.join(', '));
check('намальовані дії саме ті, що очікували', renderedActions,
  ['delete-deck', 'download-deck', 'edit-deck', 'new-subdeck', 'preview-deck',
    'select-deck', 'toggle-deck-node'].filter(a => renderedActions.includes(a)).sort());
ok('перенесення слухається на change, а не click',
  /closest\('\.deck-parent-select'\)/.test(appSource) && /addEventListener\('change'/.test(appSource));
ok('select має клас, який шукає обробник',
  deckHtml.includes('deck-parent-select') && deckHtml.includes('data-deck-id'));

// --- 2. Справжній рендер дерева ---------------------------------------

console.log('\nrenderDecks: трирівневе дерево');
const rowOf = id => {
  const at = deckHtml.indexOf(`data-action="select-deck" data-deck-id="${id}"`);
  return at === -1 ? null : deckHtml.slice(0, at);
};
ok('університет надруковано', rowOf(U) !== null);
ok('математика надруковано', rowOf(MATH) !== null);
ok('лекція 1 надруковано', rowOf(L1) !== null);
ok('фізика надруковано', rowOf(PHYS) !== null);
ok('корінь поза «Оране» надруковано', rowOf(LOOSE) !== null);
ok('рядки йдуть батько -> дитина', deckHtml.indexOf(`"${U}"`) < deckHtml.indexOf(`"${MATH}"`));
ok('вкладення йде вглиб', deckHtml.indexOf(`"${MATH}"`) < deckHtml.indexOf(`"${L1}"`));
// Точкова перевірка розкриття саме для цієї колоди: префікс до її рядка
// міг би містити розкриття батька, тож шукаємо по data-deck-id.
const hasToggleFor = (id, src) => src.includes(`data-action="toggle-deck-node" data-deck-id="${id}"`);
ok('у вузла з дітьми є розкриття', hasToggleFor(U, deckHtml));
ok('листок без нащадків не має розкриття', !hasToggleFor(L2, deckHtml));
ok('корінь без дітей не має розкриття', !hasToggleFor(LOOSE, deckHtml));
ok('«::» не потрапляє в розмітку як назва', !/>[^<]*::[^<]*<\/button>/.test(deckHtml));

console.log('\nзгортання гілки');
ok('немає розкриття у кореня без дітей', !rowOf(LOOSE).includes('toggle-deck-node'));
sandbox.toggleDeckNode(U);
const collapsedHtml = sandbox.elements.deckList.innerHTML;
ok('після згортання нащадки кореня зникли з розустанованого HTML',
  !collapsedHtml.includes(`data-deck-id="${MATH}"`) && !collapsedHtml.includes(`data-deck-id="${L1}"`));
ok('корінь лишився', collapsedHtml.includes(`data-deck-id="${U}"`));
sandbox.toggleDeckNode(U);
ok('повторне розгортання повернуло все', sandbox.elements.deckList.innerHTML.includes(`data-deck-id="${L1}"`));

console.log('\nrenderDeckRow: breadcrumbs підколоди');
const physRow = rowOf(PHYS);
ok('підпис батьківського ланцюга', physRow.includes('університет'), 'рядок фізики');
sandbox.appState.activeDeckId = L1;
sandbox.renderDecks();
const l1Row = (() => {
  const at = sandbox.elements.deckList.innerHTML.indexOf(`data-action="select-deck" data-deck-id="${L1}"`);
  return sandbox.elements.deckList.innerHTML.slice(0, at);
})();
ok('у ланцюзі видно і кореня, і проміжний рівень',
  l1Row.includes('університет') && l1Row.includes('математика'), 'рядок лекції 1');
ok('кореня немає, коли листок у корені', !rowOf(LOOSE).includes('університет'));

console.log('\nrenderDeckOptions: вибір батька');
sandbox.renderDeckOptions();
const optionsHtml = sandbox.elements.saveDeckOptions.innerHTML;
ok('корінь — перший варіант', optionsHtml.indexOf('Корінь') < optionsHtml.indexOf('університет'));
ok('назви батьків повністю уточнені шляхом',
  optionsHtml.includes('університет') && optionsHtml.includes('математика'));
ok('кількість варіантів = колод + корінь',
  (optionsHtml.match(/class="deck-option/g) || []).length, 7);

// --- 3. Сценарій: створення через "::" --------------------------------
// (синхронний)
console.log('\nСценарій: створити "університет::Історія::Лекція 1"');
const before = sandbox.appState.decks.length;
const created = sandbox.resolveDeckPathInput('університет::Історія::Лекція 1', null);
ok('без помилки', !created.error, created.error || '');
// "університет" уже є корень, тож створюється лише "Історія" — і вона
// одразу під ним, а не окремим коренем.
check('створено тільки неіснуючий рівень', created.created.map(d => d.title), ['Історія']);
ok('листок має назву без шляху', created.deck.title === 'Лекція 1', created.deck.title);
check('листок під щойноствореною Історією', created.deck.parentId, created.created[0].id);
check('Історія під наявним університетом', created.created[0].parentId, U);
ok('університет не продубльовано',
  sandbox.appState.decks.filter(d => d.title === 'університет').length, 1);
check('усього додано дві колоди', sandbox.appState.decks.length, before + 2);
ok('листок у списку', sandbox.appState.decks.some(d => d.id === created.deck.id));

console.log('\nСценарій: дубль назви відсікається до створення');
const countBefore = sandbox.appState.decks.length;
// Шлях відносний до "університет", тож "математика" знаходиться і
// конфлікт уже з "математика/лекція 1". Перевіряти треба проти
// ФІНАЛЬНОГО батька, а не проти того, що обрано в діалозі.
const dupe = sandbox.resolveDeckPathInput('математика::лекція 1', U);
ok('конфлікт знайдено', !!dupe.error, dupe.error || 'помилки немає');
ok('названо конфліктну', (dupe.error || '').includes('лекція 1'), dupe.error);
ok('названо правильного батька', (dupe.error || '').includes('математика'), dupe.error);
ok('нічого не створилось', sandbox.appState.decks.length === countBefore);
ok('регістр теж конфліктує', !!sandbox.resolveDeckPathInput('математика::ЛЕКЦІЯ 1', U).error);
ok('вільне місце проходить',
  !sandbox.resolveDeckPathInput('математика::лекція 3', U).error);

console.log('\nШлях відносний батька, а не глобальний');
// "фізика" є лише під "університетом". Під "математикою" це інша
// колода — так само, як в Anki: два однаково названі вузли в різних гілках.
const rel = sandbox.resolveDeckPathInput('фізика::лекція 1', MATH);
ok('без помилки', !rel.error, rel.error || '');
check('створено фізику саме під математикою', rel.created.map(d => d.title), ['фізика']);
check('не перекористано чужу', rel.created[0].parentId, MATH);
check('фізик у базі тепер дві', sandbox.appState.decks.filter(d => d.title === 'фізика').length, 2);

console.log('\nНові проміжні рівні створюються одним кроком');
const beforeNew = sandbox.appState.decks.length;
const chain = sandbox.resolveDeckPathInput('Хімія::Органіка::Лекція 1', null);
ok('без помилки', !chain.error, chain.error || '');
check('створено два рівні від кореня вниз', chain.created.map(d => d.title), ['Хімія', 'Органіка']);
check('батьки ланцюга зв\'язані', chain.created[1].parentId, chain.created[0].id);
check('корінь у корені', chain.created[0].parentId, null);
check('листок під останнім рівнем', chain.deck.parentId, chain.created[1].id);
check('у списку всі три', sandbox.appState.decks.length, beforeNew + 3);
ok('Хімія в списку рівно одна',
  sandbox.appState.decks.filter(d => d.title === 'Хімія').length, 1);
ok('усі три зв\'язані в одному дереві',
  chain.created[0].parentId === null && chain.created[1].parentId === chain.created[0].id
  && chain.deck.parentId === chain.created[1].id);
const paths = sandbox.flattenDeckTree(sandbox.appState.decks, new Set())
  .map(r => sandbox.deckPathString(r.deck, sandbox.appState.decks));
ok('повний шлях склеївся', paths.includes('Хімія::Органіка::Лекція 1'),
  paths.join(' | '));

// --- 4. Сценарій: перенесення і відмова сервера ------------------------
// В async-функції, бо require не поєднується з top-level await.
async function moveScenarios() {
console.log('\nСценарій: перенесення у гілку, яку сервер відхилив');
sandbox.appState.decks = sandbox.appState.decks.filter(d => d.id !== created.deck.id);
toasts.length = 0;
const sent = [];
sandbox.apiRequestJson = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body) });
  const err = new Error('У цієї колоди вже є така підколода');
  err.status = 409;
  throw err;
};
const looseBefore = (sandbox.appState.decks.find(d => d.id === LOOSE) || {}).parentId;
await sandbox.moveDeckToParent(LOOSE, MATH);
check('PATCH пішов на /parent', sent.map(s => s.url), [`/api/decks/${LOOSE}/parent`]);
check('у запиті новий батьк', sent[0].body, { parent_id: MATH });
check('локально відкочено', (sandbox.appState.decks.find(d => d.id === LOOSE) || {}).parentId, looseBefore);
ok('користувач бачить причину, а не код',
  toasts.some(t => t.kind === 'error' && t.text === 'У цієї колоди вже є така підколода'),
  JSON.stringify(toasts));

console.log('\nСценарій: успішне перенесення');
sandbox.apiRequestJson = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return {}; };
sent.length = 0;
await sandbox.moveDeckToParent(LOOSE, PHYS);
check('PATCH з новим батьком', sent[0].body, { parent_id: PHYS });
check('локально перенесено', (sandbox.appState.decks.find(d => d.id === LOOSE) || {}).parentId, PHYS);
await sandbox.moveDeckToParent(LOOSE, null);
check('перенесення в корінь', (sandbox.appState.decks.find(d => d.id === LOOSE) || {}).parentId, null);

console.log('\nСценарій: цикл відсікається до запиту');
sent.length = 0;
await sandbox.moveDeckToParent(U, L1);
check('запиту не пішло', sent.length, 0);
ok('показано попередження', toasts.some(t => t.kind === 'warning'));
// check, а не ok: null — це і є очікуваний батько, а ok трактує його як «умова не виконалася».
check('університет не зрухався', (sandbox.appState.decks.find(d => d.id === U) || {}).parentId, null);
}

// --- 5. Сценарій: каскадне видалення ----------------------------------

console.log('\nСценарій: видалення батька попереджає про нащадків');
sandbox.appState.decks = [
  { id: U, title: 'університет', parentId: null, fieldNames: ['Питання'], cards: [] },
  { id: MATH, title: 'математика', parentId: U, fieldNames: ['Питання'], cards: [] },
  { id: L1, title: 'лекція 1', parentId: MATH, fieldNames: ['Питання'], cards: [] },
  { id: L2, title: 'лекція 2', parentId: MATH, fieldNames: ['Питання'], cards: [] }
];
sandbox.renderDecks();
confirmCalls.length = 0;
sandbox.requestDeleteDeck(MATH);
ok('модалка викликана', confirmCalls.length === 1, `викликів: ${confirmCalls.length}`);
// openConfirmModal(title, text, onConfirm) — саме у такому порядку.
const modalTitle = (confirmCalls[0] || [])[0] || '';
const modalText = (confirmCalls[0] || [])[1] || '';
ok('питання в шапці', /Видалити/.test(modalTitle), modalTitle);
ok('названо колоду, а не тільки кількість', modalText.includes('математика'), modalText);
ok('згадано про нащадків — їх 2', /ще 2\b/.test(modalText), modalText);
ok('нащадків не перелічують, лише рахують — їх не видно в діалозі',
  !/лекція/.test(modalText), modalText);
sandbox.requestDeleteDeck(L1);
ok('листок без нащадків — без згадки про гілку',
  !/ще \d/.test((confirmCalls[1] || [])[1] || ''), (confirmCalls[1] || [])[1]);

// Повертаємо дерево для наступного сценарію: перенесення має знайти «Оране».
sandbox.appState.decks = [
  { id: U, title: 'університет', parentId: null, fieldNames: ['Питання'], cards: [] },
  { id: MATH, title: 'математика', parentId: U, fieldNames: ['Питання'], cards: [] },
  { id: L1, title: 'лекція 1', parentId: MATH, fieldNames: ['Питання'], cards: [] },
  { id: PHYS, title: 'фізика', parentId: U, fieldNames: ['Питання'], cards: [] },
  { id: LOOSE, title: 'Оране', parentId: null, fieldNames: ['Питання'], cards: [] }
];

  async function styleScenarios() {
  // Сценарії перенесення підмінили sandbox.apiRequestJson — повертаємо
  // запис запитів, щоб перевірити, що саме пішло на сервер.
  sandbox.apiRequestJson = recordApi;

  console.log('\nСинхронізація: локальна копія «Основного» отримує серверний id');
  // Реальний випадок із логів: у двох вкладках «Основний» створився з
  // різними id. Після перезавантаження локальна копія йшла на POST і
  // отримувала 409, а колода лишалася з style_id, якого на сервері немає.
  const remoteMainId = '11111111-1111-4111-8111-111111111111';
  const localMainId = '22222222-2222-4222-8222-222222222222';
  const syncCalls = [];
  sandbox.apiRequestJson = async (path, options = {}) => {
    syncCalls.push({ path, method: options.method || 'GET', body: options.body || '' });
    if (path === '/api/styles' && (options.method || 'GET') === 'GET') {
      return { styles: [{
        id: remoteMainId, name: 'Основний', css: '.card { color: #111; }', updatedAt: 1
      }] };
    }
    if (path === '/api/styles' && options.method === 'POST') {
      const error = new Error('duplicate');
      error.status = 409;
      throw error;
    }
    return {};
  };
  sandbox.appState.styleLibrary = [{
    id: localMainId, name: 'Основний', css: '.card { color: #111; }', updatedAt: 1
  }];
  sandbox.appState.decks = [{
    id: '33333333-3333-4333-8333-333333333333', title: 'Локальна', parentId: null,
    styleId: localMainId, modelCss: '.card { color: #111; }',
    fieldNames: ['Питання'], cards: []
  }];
  sandbox.appState.selectedStyleId = localMainId;
  sandbox.appState.generationStyleId = localMainId;
  await sandbox.syncStylesFromServer();
  check('у бібліотеці одна «Основний», а не дві', sandbox.styleLibrary().length, 1);
  check('лишився серверний id', sandbox.styleLibrary()[0].id, remoteMainId);
  check('колода переприв’язана на серверний id',
    sandbox.appState.decks[0].styleId, remoteMainId);
  check('вибір стилю теж переприв’язано', sandbox.appState.selectedStyleId, remoteMainId);
  check('стиль для генерації теж', sandbox.appState.generationStyleId, remoteMainId);
  ok('локальну копію не відправляли на сервер',
    !syncCalls.some(call => call.method === 'POST' && call.path === '/api/styles'),
    JSON.stringify(syncCalls));
  const reboundPosts = syncCalls.filter(call =>
    call.path === '/api/decks' && call.method === 'POST');
  check('переприв’язана колода дійшла до сервера', reboundPosts.length, 1);
  check('у ній уже серверний styleId',
    JSON.parse(reboundPosts[0].body).style_id, remoteMainId);
  sandbox.apiRequestJson = recordApi;
  sandbox.appState.styleLibrary = [];
  sandbox.appState.decks = [];
  sandbox.appState.selectedStyleId = null;
  sandbox.appState.generationStyleId = '';

  console.log('\nНова колода: спільний стиль за замовчуванням');
  sandbox.appState.styleLibrary = [];
  sandbox.appState.decks = [];
  const firstNewDeck = sandbox.createDeck('Нова', []);
  ok('нова колода одразу має styleId', Boolean(firstNewDeck.styleId), String(firstNewDeck.styleId));
  check('стиль додано до бібліотеки акаунта', sandbox.styleLibrary().length, 1);
  check('styleId вказує саме на стиль бібліотеки',
    firstNewDeck.styleId, sandbox.styleLibrary()[0].id);
  check('CSS колоди — знімок стилю',
    firstNewDeck.modelCss, sandbox.styleLibrary()[0].css);
  const secondNewDeck = sandbox.createDeck('Друга', []);
  check('друга колода не плодить копію «Основного»', sandbox.styleLibrary().length, 1);
  check('друга колода прив\'язана до того ж стилю',
    secondNewDeck.styleId, firstNewDeck.styleId);
  apiCalls.length = 0;
  await sandbox.pushDeckStyles([firstNewDeck, secondNewDeck]);
  ok('стиль надіслано на сервер один раз і до колод', apiCalls.length === 1
    && apiCalls[0].path === '/api/styles' && apiCalls[0].method === 'POST',
    JSON.stringify(apiCalls));

  console.log('\nCSS із чату для нової колоди не переписує спільний стиль');
  const sharedStyle = sandbox.styleLibrary()[0];
  const sharedCssBefore = sharedStyle.css;
  apiCalls.length = 0;
  await sandbox.applyFreshDeckModelCss(firstNewDeck, '.card { color: #abcdef; }');
  check('«Основний» не переписано', sharedStyle.css, sharedCssBefore);
  check('нова колода отримала власний стиль', sandbox.styleLibrary().length, 2);
  check('власний стиль містить CSS із чату',
    sandbox.findLibraryStyle(firstNewDeck.styleId).css, '.card { color: #abcdef; }');
  check('друга колода лишилась на «Основному»',
    secondNewDeck.styleId, sharedStyle.id);
  ok('окремий стиль пішов на сервер раніше за колоду', apiCalls.some(call =>
    call.path === '/api/styles' && call.method === 'POST'), JSON.stringify(apiCalls));

  // --- 6. Спільна бібліотека стилів і очищення карток ----------------------

  console.log('\nСтиль колоди: один CSS на всі поля');
  // Стара колода зі styles.items проходить міграцію в спільну бібліотеку:
  // саме так поводиться застосунок під час першого входу після оновлення.
  const styleDeck = sandbox.migrateDeck({
    id: STYLE, title: 'HTTP', parentId: null,
    fieldNames: ['Код', 'Назва', 'Приклад'], modelCss: '.card { color: #123456; }',
    cards: []
  });
  sandbox.appState.styleLibrary = [];
  sandbox.appState.decks = [styleDeck];
  sandbox.migrateLegacyDeckStyles();
  sandbox.bindDecksToStyles();
  sandbox.appState.editorDeckId = STYLE;
  sandbox.appState.editorCardId = null;
  sandbox.appState.styleDeckId = STYLE;
  sandbox.renderEditor();
  check('стиль колоди показано в textarea',
    sandbox.elements.editorModelCss.value, '.card { color: #123456; }');
  check('у редакторі видно назву активного стилю',
    sandbox.elements.editorStyleName.textContent, 'Основний');
  check('старий стиль переїхав у спільну бібліотеку', sandbox.styleLibrary().length, 1);
  check('колода посилається на стиль із бібліотеки', styleDeck.styleId,
    sandbox.styleLibrary()[0].id);
  ok('кнопок-селекторів полів більше немає', !decksSource.includes('data-field-selector'), '');
  ok('розмітка більше не містить контейнера чіпів', !html.includes('deckStyleFields'), '');
  ok('жодного селектора конкретного поля не вставляється',
    !decksSource.includes('insertFieldSelector'), '');

  console.log('\nБібліотека стилів: редагування назви й CSS');
  sandbox.openStyleModal();
  ok('вікно стилів відкрите', !sandbox.elements.styleModal.classList.contains('hidden'), '');
  ok('у вікні названо контекст бібліотеки',
    sandbox.elements.styleModalDeckName.textContent.includes('HTTP'),
    sandbox.elements.styleModalDeckName.textContent);
  ok('стиль видно в списку',
    sandbox.elements.styleList.innerHTML.includes('Основний'),
    sandbox.elements.styleList.innerHTML.slice(0, 200));
  ok('активний стиль позначено',
    sandbox.elements.styleList.innerHTML.includes('style-badge'), '');
  const mainId = sandbox.styleLibrary()[0].id;
  sandbox.selectStyleForEditing(mainId);
  sandbox.elements.styleEditorName.value = '  Основний чорний  ';
  sandbox.elements.styleEditorCss.value = '.card { color: #abcdef; }';
  apiCalls.length = 0;
  await sandbox.saveStyleEditor();
  check('назву обрізано й витрізано',
    sandbox.styleLibrary()[0].name, 'Основний чорний');
  check('у редакторі видно нову назву',
    sandbox.elements.editorStyleName.textContent, 'Основний чорний');
  check('CSS оновлено в бібліотеці',
    sandbox.styleLibrary()[0].css, '.card { color: #abcdef; }');
  check('CSS колоди — знімок того самого стилю',
    styleDeck.modelCss, '.card { color: #abcdef; }');
  ok('редагування пішло на сервер окремим запитом', apiCalls.length === 1
    && apiCalls[0].path === `/api/styles/${mainId}`
    && apiCalls[0].method === 'PUT',
    JSON.stringify(apiCalls));

  console.log('\nСпільна бібліотека: один стиль на кілька колод');
  const secondDeck = sandbox.migrateDeck({
    id: MATH, title: 'математика', fieldNames: ['Питання'],
    modelCss: '.card { color: #000; }', cards: []
  });
  sandbox.appState.decks = [styleDeck, secondDeck];
  sandbox.applyStyleToDeck(secondDeck, mainId);
  sandbox.selectStyleForEditing(mainId);
  sandbox.elements.styleEditorCss.value = '.card { color: #fedcba; }';
  await sandbox.saveStyleEditor();
  check('CSS оновився в першій колоді', styleDeck.modelCss, '.card { color: #fedcba; }');
  check('CSS оновився і в другій колоді', secondDeck.modelCss, '.card { color: #fedcba; }');

  console.log('\nБібліотека стилів: новий стиль і застосування');
  sandbox.appState.decks = [styleDeck];
  sandbox.appState.styleDeckId = STYLE;
  sandbox.elements.editorModelCss.value = '.card { background: #000; }';
  sandbox.markDeckStyleDirty();
  sandbox.elements.newStyleName.value = 'Темний';
  apiCalls.length = 0;
  await sandbox.createDeckStyle();
  check('стилів стало два', sandbox.styleLibrary().length, 2);
  const dark = sandbox.styleLibrary().find(style => style.name === 'Темний');
  check('новий стиль створено з CSS редактора',
    dark.css, '.card { background: #000; }');
  check('новий стиль застосовано до колоди', styleDeck.styleId, dark.id);
  check('CSS колоди синхронізовано', styleDeck.modelCss, '.card { background: #000; }');
  ok('стиль і привʼязка колоди поїхали на сервер', apiCalls.some(call => call.path === '/api/styles' && call.method === 'POST')
    && apiCalls.some(call => call.path === '/api/decks' && call.method === 'POST'),
    JSON.stringify(apiCalls));
  sandbox.elements.newStyleName.value = 'темний';
  apiCalls.length = 0;
  await sandbox.createDeckStyle();
  check('дубль назви (навіть іншим регістром) не створює стиль',
    sandbox.styleLibrary().length, 2);
  ok('про дубль повідомлено', toasts.some(t => /вже є/.test(t.text)),
    JSON.stringify(toasts.slice(-1)));
  check('дубль не пішов на сервер', apiCalls.length, 0);

  console.log('\nЗастосування стилю до колоди з картками');
  // Головна регресія: раніше колоду з картками не можна було перестилізувати.
  const darkId = dark.id;
  sandbox.elements.editorModelCss.value = '.card { background: #fff; }';
  sandbox.markDeckStyleDirty();
  await sandbox.applyDeckStyle(mainId);
  check('застосування переносить CSS у редактор',
    sandbox.elements.editorModelCss.value, '.card { color: #fedcba; }');
  check('активним став обраний стиль', styleDeck.styleId, mainId);
  check('CSS колоди теж перемкнувся', styleDeck.modelCss, '.card { color: #fedcba; }');
  check('незбережений CSS іншого стилю не постраждав',
    sandbox.styleLibrary().find(style => style.id === darkId).css, '.card { background: #000; }');

  console.log('\nБібліотека стилів: видалення');
  confirmCalls.length = 0;
  sandbox.requestDeleteDeckStyle(darkId);
  ok('запитано підтвердження', confirmCalls.length === 1, `викликів: ${confirmCalls.length}`);
  check('до підтвердження нічого не видалено', sandbox.styleLibrary().length, 2);
  await (confirmCalls[0] || [])[2]();
  check('стиль видалено з бібліотеки', sandbox.styleLibrary().length, 1);
  check('активний стиль не зник', styleDeck.styleId, mainId);
  ok('видалення пішло на сервер',
    apiCalls.some(call => call.path === `/api/styles/${darkId}` && call.method === 'DELETE'),
    JSON.stringify(apiCalls));

  console.log('\nСтиль колоди: збереження');
  sandbox.elements.editorModelCss.value = '[data-field="Код"] { color: red; }';
  sandbox.markDeckStyleDirty();
  ok('кнопка знає про незбережені зміни',
    sandbox.elements.saveDeckStyleButton.classList.contains('is-dirty'), '');
  apiCalls.length = 0;
  await sandbox.saveDeckStyle();
  check('CSS збережено в модель колоди',
    styleDeck.modelCss, '[data-field="Код"] { color: red; }');
  check('правка потрапила в активний стиль, а не кудись убік',
    sandbox.styleLibrary()[0].css, '[data-field="Код"] { color: red; }');
  ok('стиль доїхав до сервера окремим запитом', apiCalls.length === 1
    && apiCalls[0].path === `/api/styles/${mainId}`
    && apiCalls[0].method === 'PUT'
    && JSON.parse(apiCalls[0].body).css === '[data-field="Код"] { color: red; }',
    JSON.stringify(apiCalls));
  ok('після збереження кнопка не «брудні»',
    !sandbox.elements.saveDeckStyleButton.classList.contains('is-dirty'), '');

  console.log('\nБібліотека стилів: переживає перезавантаження');
  const reloaded = sandbox.migrateDeck(JSON.parse(JSON.stringify(styleDeck)));
  check('CSS після перезавантаження лишається знімком стилю',
    reloaded.modelCss, '[data-field="Код"] { color: red; }');
  check('посилання на стиль пережило перезавантаження', reloaded.styleId, mainId);
  const orphans = sandbox.migrateDeck({
    id: '88888888-8888-4888-8888-888888888888', title: 'стара', cards: [],
    modelCss: '.card { color: #00ff00; }'
  });
  check('стара колода без бібліотеки отримує спадковий стиль', orphans.styles.items.length, 1);
  check('CSS старої колоди не змінився', orphans.modelCss, '.card { color: #00ff00; }');

  console.log('\nНезбережений стиль не губиться при перемиканні карток');
  sandbox.appState.decks = [styleDeck];
  sandbox.appState.editorDeckId = STYLE;
  sandbox.elements.editorModelCss.value = '.card { color: #00ff00; }';
  sandbox.markDeckStyleDirty();
  sandbox.renderEditor();
  check('textarea лишився з правками', sandbox.elements.editorModelCss.value, '.card { color: #00ff00; }');
  console.log('\nСтиль колоди: секція розкривається');
  // Стартовий стан з index.html: панель прихована.
  sandbox.elements.deckStylePanel.classList.add('hidden');
  sandbox.toggleDeckStylePanel();
  ok('панель показано', !sandbox.elements.deckStylePanel.classList.contains('hidden'), '');
  check('aria-expanded оновився', sandbox.elements.deckStyleToggle.getAttribute('aria-expanded'), 'true');
  ok('стрілка повернута', sandbox.elements.deckStyleChevron.classList.contains('rotate-180'), '');
  sandbox.toggleDeckStylePanel();
  ok('панель знову схована', sandbox.elements.deckStylePanel.classList.contains('hidden'), '');
  check('aria-expanded назад', sandbox.elements.deckStyleToggle.getAttribute('aria-expanded'), 'false');

  console.log('\nОчищення колоди від карток');
  const clearDeck = {
    id: MATH, title: 'математика', parentId: null,
    fieldNames: ['Питання', 'Відповідь'], modelCss: '.card { color: red; }',
    templates: [{ name: 'Картка 1', qfmt: '{{Питання}}' }], cards: [
      { id: 'c1', values: { Питання: '2+2', Відповідь: '4' } },
      { id: 'c2', values: { Питання: '3+3', Відповідь: '6' } }
    ]
  };
  sandbox.appState.decks = [clearDeck];
  sandbox.appState.editorDeckId = MATH;
  sandbox.appState.editorCardId = 'c1';
  sandbox.renderEditor();
  ok('кнопка очищення активна, поки є картки',
    sandbox.elements.clearDeckButton.disabled === false, '');
  confirmCalls.length = 0;
  sandbox.requestClearDeckCards();
  ok('запитано підтвердження', confirmCalls.length === 1, `викликів: ${confirmCalls.length}`);
  const clearTitle = (confirmCalls[0] || [])[0] || '';
  const clearText = (confirmCalls[0] || [])[1] || '';
  ok('у заголовку — про очищення', /Очистити/.test(clearTitle), clearTitle);
  ok('зазначено кількість карток', /Карток: 2/.test(clearText), clearText);
  ok('пояснено, що колода лишається', /поля, стиль і шаблони залишаться/.test(clearText), clearText);
  ok('до підтвердження нічого не видалено', clearDeck.cards.length === 2, `${clearDeck.cards.length}`);
  apiCalls.length = 0;
  await (confirmCalls[0] || [])[2]();
  check('картки зникли', clearDeck.cards.length, 0);
  ok('колода лишилась в списку', sandbox.appState.decks.includes(clearDeck), '');
  check('поля колоди не змінились', clearDeck.fieldNames, ['Питання', 'Відповідь']);
  check('стиль колоди не змінився', clearDeck.modelCss, '.card { color: red; }');
  check('шаблони колоди не змінились', clearDeck.templates.length, 1);
  ok('на сервер пішов PUT карток із порожнім списком', apiCalls.length === 1
    && apiCalls[0].method === 'PUT'
    && apiCalls[0].path === `/api/decks/${MATH}/cards`
    && JSON.parse(apiCalls[0].body).cards.length === 0,
    JSON.stringify(apiCalls));
  ok('колоду не видаляли', !apiCalls.some(call => call.method === 'DELETE'), JSON.stringify(apiCalls));
  sandbox.renderEditor();
  check('редактор показує порожню колоду', sandbox.elements.editorCardPosition.textContent, 'Карток 0 з 0');
  ok('кнопку очищення вимкнено', sandbox.elements.clearDeckButton.disabled === true, '');

  console.log('\nОчищення порожньої колоди');
  confirmCalls.length = 0;
  sandbox.requestClearDeckCards();
  ok('без карток діалог не показується', confirmCalls.length === 0, `викликів: ${confirmCalls.length}`);
  ok('пояснено, що карток немає', toasts.some(t => /вже немає карток/.test(t.text)),
    JSON.stringify(toasts.slice(-1)));

}

// .then, а не await: у файлі є require, і Node не дає поєднати його
// з top-level await — довелося б або додавати "type": "module", або
// переписувати все на import, а решта тестів лишається на require.
// Стиль для генерації. Обраний стиль — «що візьме Gemini», тому він
// живе окремо від активного стилю колоди: генерація в іншу колоду не
// мала б непомітно перемикати стиль тої, у якій користувач працює.
async function generationStyleScenarios() {
  sandbox.apiRequestJson = recordApi;
  sandbox.appState.styleLibrary = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Світлий', css: '.card { color: #111; }', updatedAt: 1 },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Темний', css: '.card { color: #222; }', updatedAt: 2 }
  ];
  sandbox.appState.decks = [sandbox.migrateDeck({
    id: U, title: 'університет', fieldNames: ['Питання'], cards: []
  })];
  sandbox.renderDecks();
  const list = sandbox.elements.generationStyleList;
  const label = sandbox.elements.generationStyleLabel;

  check('за замовчуванням стиль не обрано', sandbox.appState.generationStyleId, '');
  check('немає обраного стилю', sandbox.generationStyle(), null);
  ok('у списку є авто', list.innerHTML.includes('Авто'),
    list.innerHTML.slice(0, 200));
  ok('підпис пояснює, що робить авто',
    label.textContent.includes('стиль підбере Gemini'), label.textContent);
  check('стилі не групуються за колодами',
    (list.innerHTML.match(/style-option-group"/g) || []).length, 0);
  check('кожен варіант має роль option',
    (list.innerHTML.match(/role="option"/g) || []).length, 3);
  check('кожен варіант має гапку для обраного',
    (list.innerHTML.match(/style-option-check/g) || []).length, 3);

  // Стиль без CSS не показуємо: Gemini все одно нічого не отримає, а в
  // переліку порожній пункт виглядає як помилка, а не як «ще не задано».
  sandbox.appState.styleLibrary.push({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Порожній', css: '', updatedAt: 3
  });
  sandbox.renderDecks();
  ok('стиль без CSS не потрапляє у список',
    !list.innerHTML.includes('Порожній'), list.innerHTML.slice(0, 400));
  check('лишились тільки два варіанти з id',
    (list.innerHTML.match(/data-generation-style="[0-9a-f-]{36}"/g) || []).length, 2);
  sandbox.appState.styleLibrary = sandbox.appState.styleLibrary.filter(style => style.css);

  const styleId = sandbox.appState.styleLibrary[0].id;
  check('стиль обрано', sandbox.setGenerationStyleId(styleId), styleId);
  check('вибір збережено', sandbox.appState.generationStyleId, styleId);
  check('повернувся саме обраний CSS', sandbox.generationStyle().css, '.card { color: #111; }');
  ok('обраний варіант позначено для скринрідера',
    list.innerHTML.includes('aria-selected="true"'), list.innerHTML.slice(0, 400));
  ok('у підписі є назва спільного стилю',
    label.textContent.includes('Світлий'), label.textContent);
  ok('обране збережено в localStorage',
    Object.values(sandbox.localStorage._data).some(v => String(v).includes(styleId)),
    JSON.stringify(sandbox.localStorage._data));
  ok('колірні плями беремо з реального CSS',
    sandbox.styleColorSwatches('.card { color: #111; }').includes('#111111'),
    sandbox.styleColorSwatches('.card { color: #111; }'));
  ok('короткий колір розгортаємо до повного',
    sandbox.styleColorSwatches('a{background:#abc}').includes('#aabbcc'),
    sandbox.styleColorSwatches('a{background:#abc}'));
  ok('без кольорів не малюємо порожні плями',
    sandbox.styleColorSwatches('.card { font-size: 1em; }').includes('без кольорів'),
    sandbox.styleColorSwatches('.card { font-size: 1em; }'));

  check('вибір чужого/неіснуючого id скидається',
    sandbox.setGenerationStyleId('99999999-9999-4999-8999-999999999999'), '');
  check('після чужого номера не лишається хвоста', sandbox.appState.generationStyleId, '');

  // Стиль видалили, а вибір про нього пам'ятає: показуємо «Авто»,
  // щоб у генерацію не пішов невидимий стиль.
  sandbox.setGenerationStyleId(styleId);
  sandbox.appState.styleLibrary = sandbox.appState.styleLibrary.filter(style => style.id !== styleId);
  sandbox.renderDecks();
  check('вибір скинуто після видалення', sandbox.appState.generationStyleId, '');
  ok('підпис повернувся до авто', label.textContent.includes('Авто'), label.textContent);
  check('обраним лишився тільки авто',
    (list.innerHTML.match(/aria-selected="true"/g) || []).length, 1);

  const otherId = sandbox.appState.styleLibrary[0].id;
  check('перемикання між стилями працює', sandbox.setGenerationStyleId(otherId), otherId);
  check('його CSS повертається', sandbox.generationStyle().css, '.card { color: #222; }');
}

// Власне меню замість нативного select: стан, фокус і клавіатура.
function generationStyleDropdownScenarios() {
  const button = sandbox.elements.generationStyleButton;
  const list = sandbox.elements.generationStyleList;
  const chevron = sandbox.elements.generationStyleChevron;
  const picker = sandbox.elements.generationStylePicker;

  ok('на старті список закритий', list.classList.contains('hidden'));
  check('aria-expanded=false на старті', button.getAttribute('aria-expanded'), 'false');
  ok('кнопка оголошує, що відкриває список',
    button.getAttribute('aria-haspopup') === 'listbox'
    && button.getAttribute('aria-controls') === 'generationStyleList');

  sandbox.openGenerationStyleList();
  ok('відкрився список', list.classList.contains('flex') && !list.classList.contains('hidden'));
  check('aria-expanded=true', button.getAttribute('aria-expanded'), 'true');
  ok('стрілка повернулась догори', chevron.classList.contains('rotate-180'));
  check('фокус на списку, а не на кнопці', sandbox.document.activeElement, list);

  sandbox.closeGenerationStyleList();
  ok('закрився список', list.classList.contains('hidden'));
  ok('hidden і flex не живуть одночасно', !list.classList.contains('flex'));
  check('aria-expanded повернулась', button.getAttribute('aria-expanded'), 'false');
  ok('стрілка повернулась вниз', !chevron.classList.contains('rotate-180'));

  sandbox.toggleGenerationStyleList();
  ok('перемикач відкриває', sandbox.isGenerationStyleListOpen());
  sandbox.toggleGenerationStyleList();
  ok('перемикач закриває', !sandbox.isGenerationStyleListOpen());

  // Клік поза меню закриває його: інакше список лишався б висити поверх
  // чату, і наступний клік у поле введення потрапив би в нього.
  sandbox.openGenerationStyleList();
  const outside = { target: sandbox.elements.messages };
  ok('клік поза пікером закриває список',
    !picker.contains(outside.target));
  sandbox.closeGenerationStyleList();

  // Enter на варіанті обирає саме його. Клік обробляється делегуванням,
  // тому перевіряємо саме pickGenerationStyle: подвійний клік по тому
  // самому рядку не мав би перемкнути на сусідній стиль.
  const options = list.querySelectorAll('[data-generation-style]');
  const target = options[0].dataset.generationStyle;
  sandbox.pickGenerationStyle(target);
  check('клік обрав саме той стиль', sandbox.appState.generationStyleId, target);
  ok('меню закрилось після вибору', !sandbox.isGenerationStyleListOpen());
  check('фокус повернувся на кнопку', sandbox.document.activeElement, button);

  sandbox.openGenerationStyleList();
  const key = (keyName, target) => {
    const event = { key: keyName, target, preventDefault() {} };
    sandbox.handleGenerationStyleListKeydown(event);
  };
  key('ArrowDown', list);
  check('стрілка вниз пересунула фокус', sandbox.document.activeElement, options[0]);
  key('ArrowDown', options[0]);
  check('стрілка вниз йде далі', sandbox.document.activeElement, options[1]);
  key('ArrowUp', options[1]);
  check('стрілка вгору повертає', sandbox.document.activeElement, options[0]);
  key('End', options[0]);
  check('End переходить на останній', sandbox.document.activeElement, options[options.length - 1]);
  key('Home', options[options.length - 1]);
  check('Home повертає на перший', sandbox.document.activeElement, options[0]);
  key('Escape', list);
  ok('Escape закриває список', !sandbox.isGenerationStyleListOpen());
  check('Escape повертає фокус на кнопку', sandbox.document.activeElement, button);

  // Enter обирає варіант, на якому стоїть фокус, а не перший у списку:
  // інакше з клавіатури можна було б вибрати не те, що видно.
  sandbox.openGenerationStyleList();
  key('ArrowDown', list);
  key('ArrowDown', options[0]);
  const focused = sandbox.document.activeElement.dataset.generationStyle;
  key('Enter', sandbox.document.activeElement);
  check('Enter обрав варіант під фокусом', sandbox.appState.generationStyleId, focused);
}

moveScenarios().then(styleScenarios).then(generationStyleScenarios)
  .then(generationStyleDropdownScenarios).then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });