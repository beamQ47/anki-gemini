// Тест перегляду карток.
//
// Прев'ю має показувати те саме, що потрапить в Anki: перше поле —
// питання, решта — блоками з підписами на зворотному. Користувацький CSS
// застосовується, але не витікає на весь застосунок.
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
function makeSandbox() {
  const els = new Map();
  // Реальні id бермо з index.html: тоді getElementById повертає null для
  // того, чого на сторінці немає (як у справжньому DOM), а не «все
  // існує». Бонусом тест падає, якщо JS просить неіснуючий елемент.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    if (!els.has(m[1])) els.set(m[1], makeEl(m[1]));
  }

  function makeEl(id) {
    const e = { id, hidden: false, value: '', textContent: '', innerHTML: '', disabled: false,
      dataset: {}, style: { setProperty: noop },
      classList: { _s: new Set(),
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
        contains(c) { return this._s.has(c); } },
      addEventListener: noop, appendChild: noop, removeChild: noop, remove: noop,
      setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
      focus: noop, click: noop, querySelector: () => null, querySelectorAll: () => [] };
    return e;
  }

  const head = { children: [], appendChild(node) { this.children.push(node); } };
  const s = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, Error, URL, URLSearchParams,
    document: {
      getElementById: (id) => (els.has(id) ? els.get(id) : null),
      // Створені елементи реєструються в els, коли їм дають id.
      createElement: (tag) => {
        const e = makeEl(null);
        e.tagName = String(tag).toUpperCase();
        let current = null;
        Object.defineProperty(e, 'id', {
          get() { return current; },
          set(v) { current = v; if (v) els.set(v, e); }
        });
        return e;
      },
      head,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop,
      body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
      documentElement: { style: { setProperty: noop }, dataset: {}, getAttribute: () => null,
        appendChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } } },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) }),
    navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: noop,
    getComputedStyle: () => ({ color: 'rgb(1,2,3)' }),
    IntersectionObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    location: { href: 'http://x/', origin: 'http://x', reload: noop },
    alert: noop, confirm: () => true, addEventListener: noop, removeEventListener: noop, scrollTo: noop
  };
  s.window = s;
  s.document.activeElement = { tagName: 'DIV' };
  vm.createContext(s);
  for (const n of ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', n), 'utf8'), s, { filename: n });
  }
  vm.runInContext('globalThis.__open = openDeckPreview;globalThis.__close = closeDeckPreview;' +
                  'globalThis.__flip = flipPreviewCard;globalThis.__nav = navigatePreviewCard;' +
                  'globalThis.__render = renderPreview;globalThis.__scope = scopePreviewCss;' +
                  'globalThis.__faces = buildPreviewFaces;globalThis.__state = () => previewState;' +
                  'globalThis.__setDecks = (v) => { appState.decks = v; };', s);
  return { s, head, els, el: (id) => els.get(id) };
}

const DECK = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Коди HTTP',
  fieldNames: ['Код', 'Назва', 'Приклад', 'Джерело'],
  modelCss: '.card { background: #123456; color: #fff; }',
  templates: [],
  cards: [
    { id: 'a1111111-1111-4111-8111-111111111111', values: { Код: '200', Назва: 'OK', Приклад: 'HTTP/1.1 200 OK', Джерело: 'RFC 9110' } },
    { id: 'b2222222-2222-4222-8222-222222222222', values: { Код: '404', Назва: 'Not Found', Приклад: 'HTTP/1.1 404', Джерело: 'RFC 9110' } }
  ],
  updatedAt: 1
};

(async () => {
  const { s, head, el } = makeSandbox();
  const scope = (code) => vm.runInContext(code, s);

  console.log('\nСтруктура сторін дзеркалить шаблон Anki');
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([DECK])})`, s);
  const f = scope('__faces(appState.decks[0].cards[0], ["Код","Назва","Приклад","Джерело"])');
  checkThat('лицьова — це лише перше поле в .anki-question',
    f.front === '<div class="anki-question anki-field-1" data-field="Код">200</div>', `отримано: ${f.front}`);
  checkThat('на зворотному є #answer', f.back.includes('<hr id="answer">'), '');
  checkThat('кожне інше поле — окремий блок з підписом',
    (f.back.match(/class="anki-field anki-field-/g) || []).length === 3,
    `блоків: ${(f.back.match(/class="anki-field anki-field-/g) || []).length}`);
  checkThat('поле має data-field у зворотній',
    f.back.includes('data-field="Назва"') && f.back.includes('data-field="Джерело"'), '');
  checkThat('значення полів на місці',
    f.back.includes('>OK<') && f.back.includes('>HTTP/1.1 200 OK<') && f.back.includes('>RFC 9110<'), '');
  checkThat('зворотна містить і лицьову сторону ({{FrontSide}})',
    f.back.startsWith(f.front), `отримано: ${f.back.slice(0, 60)}`);

  console.log('\nHTML екранується');
  const evil = { ...DECK, cards: [{ id: 'c3333333-3333-4333-8333-333333333333',
    values: { Код: '<img src=x onerror=alert(1)>', Назва: 'x', Приклад: 'y', Джерело: 'z' } }] };
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([evil])})`, s);
  const ef = scope('__faces(appState.decks[0].cards[0], ["Код","Назва","Приклад","Джерело"])');
  checkThat('теги не потрапляють у розмітку', !ef.front.includes('<img'), `отримано: ${ef.front}`);
  checkThat('екрановано спецсимволи', ef.front.includes('&lt;img'), `отримано: ${ef.front}`);

  console.log('\nCSS не витікає на застосунок');
  const scoped = scope('__scope(".card { color: red; } body { background: blue; }", ".deck-preview-scope")');
  checkThat('селектор отримав префікс', scoped.includes('.deck-preview-scope .card'), `отримано: ${scoped}`);
  checkThat('body всередині прев\'ю не ламає застосунок', !/^\s*body\s*\{/m.test(scoped), `отримано: ${scoped}`);
  const multi = scope('__scope(".a, .b { color: red; }", ".deck-preview-scope")');
  checkThat('список селекторів переписано повністю',
    multi.includes('.deck-preview-scope .a') && multi.includes('.deck-preview-scope .b'), `отримано: ${multi}`);
  const media = scope('__scope("@media (max-width: 500px) { .card { color: red; } }", ".deck-preview-scope")');
  checkThat('всередині @media селектори теж переписані',
    media.includes('.deck-preview-scope .card'), `отримано: ${media}`);
  const frames = scope('__scope("@keyframes spin { from { opacity: 0; } to { opacity: 1; } }", ".deck-preview-scope")');
  checkThat('@keyframes не ламається префіксом',
    frames.includes('from {') && !frames.includes('.deck-preview-scope from'), `отримано: ${frames}`);
  const _e = scope('__scope("", ".deck-preview-scope")');
  // check, а не checkThat: порожній рядок false-істимий і
  // checkThat сприйняв би його як провал
  check('порожній CSS дає порожній результат', _e, '');

  console.log('\nВідкриття, навігація, перевертання');
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([DECK])})`, s);
  scope('__open("11111111-1111-4111-8111-111111111111")');
  check('модалка показана', el('previewModal').classList.contains('flex'), true);
  check('заголовок — назва колоди', el('previewModalTitle').textContent, 'Коди HTTP');
  check('лічильник карток', el('previewPosition').textContent, 'Картка 1 з 2');
  checkThat('питання на місці', el('previewCardFront').innerHTML.includes('200'), el('previewCardFront').innerHTML);
  check('сторона не перевернута', el('previewCardStage').dataset.flipped, 'false');
  checkThat('користувацький CSS застосовано',
    head.children.some((n) => n.id === 'deckPreviewUserCss' && n.textContent.includes('.deck-preview-scope .card')),
    JSON.stringify(head.children.map((n) => n.textContent)));

  scope('__nav(1)');
  check('перейшли на картку 2', el('previewPosition').textContent, 'Картка 2 з 2');
  checkThat('питання оновилося', el('previewCardFront').innerHTML.includes('404'), el('previewCardFront').innerHTML);

  scope('__nav(1)');
  check('перейшли на картку 1 (циклічно)', el('previewPosition').textContent, 'Картка 1 з 2');
  scope('__nav(-1)');
  check('назад теж циклічно', el('previewPosition').textContent, 'Картка 2 з 2');

  scope('__flip()');
  check('картка перевернута', el('previewCardStage').dataset.flipped, 'true');
  check('кнопка пропонує назад', el('previewFlipButton').textContent, 'Показати лицьову');
  scope('__flip()');
  check('знову лицьова', el('previewCardStage').dataset.flipped, 'false');

  console.log('\nПорожня колода');
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([{ ...DECK, cards: [] }])})`, s);
  scope('__open("11111111-1111-4111-8111-111111111111")');
  checkThat('сцена порожня', el('previewCardStage').classList.contains('hidden'), '');
  checkThat('показано підказку', !el('previewEmptyState').classList.contains('hidden'), '');
  check('лічильник', el('previewPosition').textContent, 'Карток немає');
  check('перемикання вимкнено', el('previewPrevButton').disabled, true);
  checkThat('перевертання не падає', (scope('__flip()'), el('previewCardStage').dataset.flipped === 'false'), '');

  console.log('\nЗакриття');
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([DECK])})`, s);
  scope('__open("11111111-1111-4111-8111-111111111111")');
  scope('__close()');
  check('модалка схована', el('previewModal').classList.contains('hidden'), true);
  check('стан скинуто', scope('__state()'), null);
  checkThat('клік після закриття нічого не робить', (scope('__flip()'), scope('__state()') === null), '');

  console.log('\nНевідома колода не відкривається');
  scope('__open("00000000-0000-4000-8000-000000000000")');
  check('модалка лишилась закритою', el('previewModal').classList.contains('hidden'), true);

  console.log('\nФормули LaTeX (MathJax)');
  // Поля екрановані від HTML, але LaTeX-роздільники \( ... \) мають лишитися
  // живим текстом — інакше MathJax не має чого типувати, а користувач у
  // прев'ю бачить сире "\(" замість формули.
  const mathDeck = { ...DECK, cards: [{ id: 'd4444444-4444-4444-8444-444444444444',
    values: { Код: 'Формула', Назва: '\\(a^2 + b^2 = c^2\\)',
      Приклад: '\\[\\frac{1}{n}\\] & x < y', Джерело: 'Anki' } }] };
  vm.runInContext(`globalThis.__setDecks(${JSON.stringify([mathDeck])})`, s);
  const mf = scope('__faces(appState.decks[0].cards[0], ["Код","Назва","Приклад","Джерело"])');
  checkThat('роздільник \\( лишився в розмітці', mf.back.includes('\\(a^2 + b^2 = c^2\\)'),
    `отримано: ${mf.back}`);
  checkThat('блоковий роздільник \\[ лишився', mf.back.includes('\\[\\frac{1}{n}\\]'),
    `отримано: ${mf.back}`);
  checkThat('HTML у формулі екранується', mf.back.includes('x &lt; y'), `отримано: ${mf.back}`);
  checkThat('жодного сирого "<" з формули', !/>\s*x < y/.test(mf.back), `отримано: ${mf.back}`);

  // Без MathJax (ще не підвантажився або взагалі відсутній) прев'ю має
  // працювати тихо — інакше користувач без інтернету не відкриє картку.
  scope('__open("11111111-1111-4111-8111-111111111111")');
  checkThat('без MathJax прев\'ю не падає', el('previewCardStage').dataset.flipped === 'false', '');

  // З MathJax перетиповується стаді (там обидві сторони), і тільки після
  // вставки розмітки. Типсет асинхронний (MathJax обіцяє результат), тому
  // перед перевіркою даємо мікро-task'ам виконатись.
  scope(`globalThis.__calls = (window.__calls = []);
    window.MathJax = { startup: { promise: Promise.resolve() },
      typesetPromise: (nodes) => { window.__calls.push(nodes); return Promise.resolve(); } };`);
  scope('__open("11111111-1111-4111-8111-111111111111")');
  await new Promise((resolve) => setTimeout(resolve, 0));
  checkThat('MathJax викликано один раз на стаді', scope('__calls.length') === 1,
    `викликів: ${scope('__calls.length')}`);
  checkThat('типсетиться саме стаді, а не документ',
    scope('__calls[0].length === 1 && __calls[0][0] === document.getElementById("previewCardStage")'),
    JSON.stringify(scope('__calls.map(n => n.map(x => x.id))')));
  checkThat('роздільники вже в DOM на момент виклику',
    el('previewCardBack').innerHTML.includes('\\(a^2'),
    el('previewCardBack').innerHTML);

  // MathJax ще не готовий: typesetPromise до завершення старту кидає
  // помилку, тож спершу чекаємо startup.promise.
  scope('__calls.length = 0; window.MathJax.startup.promise = new Promise(() => {});');
  let threw = false;
  try { scope('__open("11111111-1111-4111-8111-111111111111")'); } catch (e) { threw = true; }
  checkThat('поки MathJax вантажиться — не падаємо', !threw, '');
  checkThat('і не намагаємось типсетити до готовності', scope('__calls.length') === 0,
    `викликів: ${scope('__calls.length')}`);

  scope('delete window.MathJax');
  threw = false;
  try { scope('__open("11111111-1111-4111-8111-111111111111")'); } catch (e) { threw = true; }
  checkThat('MathJax зник — теж не падаємо', !threw, '');

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); console.error(e && e.stack); process.exit(1); });
