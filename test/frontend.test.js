/**
 * Перевіряє реальні функції рендеру з decks.js і chat.js у Node.
 * Браузера тут немає, тому DOM потрібно імітувати — але саме завдяки цьому
 * перевіряються справжні шаблонні рядки, а не абстрактна логіка.
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
function checkThat(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail || ''}`); }
}

const stubElement = () => ({
  innerHTML: '', value: '', textContent: '', disabled: false, className: '',
  classList: { add() {}, remove() {}, toggle() {} },
  querySelectorAll: () => [],
  querySelector: () => null,
  append() {}, remove() {}, focus() {}, select() {},
  addEventListener() {}
});

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  Set,
  Map,
  String,
  Number,
  Boolean,
  isNaN,
  module: undefined,
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); }
  },
  document: {
    getElementById: () => stubElement(),
    createElement: () => stubElement(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
    body: { append() {} }
  },
  window: { setTimeout() {}, URL: { createObjectURL: () => '', revokeObjectURL() {} } },
  navigator: {},
  location: { origin: 'http://127.0.0.1:8000' },
  setTimeout() {},
  STORAGE_KEY: 'test',
  desktopQuery: { matches: false },
  escapeHtml: value => String(value ?? '').replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])),
  createId: prefix => `${prefix}-${Math.random().toString(36).slice(2, 10)}`,
  refreshIcons() {},
  haptic() {},
  showToast() {},
  openConfirmModal() {},
  sendToBackend: async () => ({ ok: false }),
  getApiUrl: p => `http://127.0.0.1:8000${p}`,
  apiFetch: async () => ({ blob: async () => ({}) }),
  pluralizeCards: n => 'карток',
  pluralizeDecks: n => 'колод',
  sanitizeFileName: v => v,
  formatRelativeDate: () => 'щойно',
  escapeHtmlDefined: true
};
sandbox.elements = {
  editorFields: stubElement(),
  editorDeckTitle: stubElement(),
  editorCardSelect: stubElement(),
  editorCardPosition: stubElement(),
  editorModelCss: stubElement(),
  previousCardButton: stubElement(),
  nextCardButton: stubElement(),
  deleteCardButton: stubElement(),
  saveCardButton: stubElement(),
  editorPanel: stubElement(),
  deckListPanel: stubElement(),
  deckList: stubElement(),
  deckSummary: stubElement(),
  emptyDecksState: stubElement(),
  newDeckName: stubElement(),
  saveDeckOptions: stubElement(),
  storageStatusText: stubElement(),
  storageStatusDot: stubElement()
};
sandbox.appState = { decks: [], activeDeckId: null, editorDeckId: null, editorCardId: null };

const ctx = vm.createContext(sandbox);
for (const file of ['js/model.js', 'js/decks.js', 'js/chat.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

console.log('migrateDeck: стара колода з localStorage');
const migrated = sandbox.migrateDeck({
  id: 'legacy-1',
  title: 'Історія України',
  modelCss: '.card{}',
  updatedAt: 1700000000000,
  cards: [
    { id: 'c1', front: 'Питання', back: 'Відповідь', extra: 'Нотатка', createdAt: 1 },
    { id: 'c2', front: 'Питання 2', back: 'Відповідь 2', createdAt: 2 }
  ]
});
// 'legacy-1'/'c1' — не uuid, тож міграція замінює їх на валідні.
// Старі 'card-<uuid>' навпаки зберігаються: це вже готовий формат.
check('невалідний id замінено на uuid', sandbox.normalizeUuid(migrated.id), migrated.id);
check('усі card id — валідні uuid',
  migrated.cards.every((c) => sandbox.normalizeUuid(c.id) === c.id), true);
check('card id різні', new Set(migrated.cards.map((c) => c.id)).size, 2);
check('колода готова до експорту', sandbox.isExportIdentityReady(migrated), true);
check('імена полів', migrated.fieldNames, ['Front', 'Back', 'Extra']);
check('карток', migrated.cards.length, 2);
check('значення 1-ї', migrated.cards[0].values, { Front: 'Питання', Back: 'Відповідь', Extra: 'Нотатка' });
check('старої форми більше немає', 'front' in migrated.cards[0], false);
check('updatedAt збережено', migrated.updatedAt, 1700000000000);

console.log('\nmigrateDeck: стабільність id при повторному завантаженні');
// localStorage перечитується на кожному старті. Якщо міграція щоразу
// видавала б нові id, Anki отримував би дублікати навіть без жодних
// правок — тож ідентичність має бути прив'язана до даних, а не до випадку.
const reloaded = sandbox.migrateDeck(JSON.parse(JSON.stringify(migrated)));
check('deck id той самий', reloaded.id, migrated.id);
check('card id ті самі', reloaded.cards.map((c) => c.id), migrated.cards.map((c) => c.id));

console.log('\nmigrateDeck: старі префіксовані uuid зберігаються');
const prefixed = sandbox.migrateDeck({
  id: 'deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  title: 'Префіксна',
  cards: [
    { id: 'card-550e8400-e29b-41d4-a716-446655440000', values: { Front: 'a', Back: 'b' } }
  ]
});
check('префікс deck- знято, uuid збережено',
  prefixed.id, '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('префікс card- знято, uuid збережено',
  prefixed.cards[0].id, '550e8400-e29b-41d4-a716-446655440000');

console.log('\nmigrateDeck: 5 полів не змінює порядок');
const five = sandbox.migrateDeck({
  id: 'five', title: 'НПЗІБ',
  fieldNames: ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка'],
  cards: [{ id: 'x', values: { Код: '200', Назва: 'OK', Приклад: 'HTTP', Джерело: 'RFC', Нотатка: 'ok' } }]
});
check('поля', five.fieldNames, ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка']);
check('значення', Object.keys(five.cards[0].values), ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка']);

console.log('\nrenderFieldInputs');
const html = sandbox.renderFieldInputs(['Код', 'Назва', 'Приклад'], { Код: '200', Назва: 'OK' }, false);
checkThat('3 поля', (html.match(/data-field-name=/g) || []).length === 3, `знайдено ${(html.match(/data-field-name=/g) || []).length}`);
checkThat('порядок у розмітці', html.indexOf('Код') < html.indexOf('Назва') && html.indexOf('Назва') < html.indexOf('Приклад'));
checkThat('значення підставлено', html.includes('200') && html.includes('OK'));
checkThat('пропущене поле порожнє', /data-field-name="Приклад"[^>]*><\/textarea>/.test(html), html.slice(0, 400));
checkThat('XSS екранується', sandbox.renderFieldInputs(['A'], { A: '</textarea><script>x</script>' }, false).includes('&lt;/textarea&gt;'));
checkThat('disabled виставлено', sandbox.renderFieldInputs(['A'], {}, true).includes('disabled'));

console.log('\nrenderCards: 5 полів');
const cardHtml = sandbox.renderCards({
  id: 'm1',
  fieldNames: ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка'],
  cards: [{ values: { Код: '200', Назва: 'OK', Приклад: 'HTTP 200', Джерело: 'RFC 9110', Нотатка: 'успіх' } }]
});
checkThat('лише 1 flip-card', (cardHtml.match(/class="flip-card"/g) || []).length === 1);
checkThat('на лицьовій стороні лише перше поле',
  /front[\s\S]*?200[\s\S]*?back/.test(cardHtml) && !/front[\s\S]*?RFC/.test(cardHtml.split('flip-face back')[0]));
checkThat('на зворотному 4 поля',
  (cardHtml.split('flip-face back')[1].match(/card-field-value/g) || []).length === 4);
checkThat('усі 5 імен зустрічаються',
  ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка'].every(n => cardHtml.includes(n)));
const backSide = cardHtml.split('flip-face back')[1] || '';
checkThat('зворотна сторона має контейнер полів', backSide.includes('class="card-fields"'));
checkThat('значення полів без вкладеного скролу',
  (backSide.match(/class="card-content/g) || []).length === 0);
checkThat('немає фейкової обгортки', !cardHtml.includes('card-fields-wrap'));

console.log('\nrenderCards: 1 поле (немає чого гортати)');
const single = sandbox.renderCards({
  id: 'm2',
  fieldNames: ['Питання'],
  cards: [{ values: { Питання: 'Що це?' } }]
});
checkThat('є картка', single.includes('flip-card'));
checkThat('порожній бек без краків', single.includes('Немає додаткових полів'));
checkThat('ліцьова показує питання', single.includes('Що це?'));

console.log('\nrenderCards: довгий текст не обрізається структурно');
const long = sandbox.renderCards({
  id: 'm3',
  fieldNames: ['Код', 'Нотатка'],
  cards: [{ values: { Код: '200', 'Нотатка': 'x'.repeat(900) } }]
});
checkThat('довге значення присутнє повністю', long.includes('x'.repeat(900)));
checkThat('є контейнер полів', long.includes('card-fields'));
checkThat('лише одна область прокрутки на зворотній стороні',
  (long.split('flip-face back')[1].match(/class="card-fields"/g) || []).length === 1);

/*
 * Регресія: align-items:center на скрол-контейнері змушує Flexbox
 * центрувати вміст і при переповненні, тож верх стає недоступним для
 * прокрутки. Центрування робимо через margin-block:auto на .card-value.
 */
console.log('\nCSS картки');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const cardContentRule = (css.match(/\.card-content\s*\{[^}]*\}/) || [''])[0];
checkThat('card-content: без align-items:center', !cardContentRule.includes('align-items'));
checkThat('card-content: колонка + overflow-y:auto',
  cardContentRule.includes('flex-direction: column') && cardContentRule.includes('overflow-y: auto'));
checkThat('card-content: min-height:0 потрібен для флекса',
  cardContentRule.includes('min-height: 0'));
checkThat('центрування через margin-block:auto',
  /\.card-value\s*\{[^}]*margin-block:\s*auto/.test(css));
checkThat('лицьове значення обгорнуте в .card-value', cardHtml.includes('class="card-value"'));
checkThat('card-fields: overflow-y:auto',
  /\.card-fields\s*\{[^}]*overflow-y:\s*auto/.test(css));
checkThat('card-fields: без вкладеного card-content',
  !/\.card-fields[^}]*card-content/.test(css));
checkThat('фейковий смужок прибрано', !css.includes('card-fields-wrap'));

/* Картка в чаті має бути компактною: вона живе в стрічці поруч із текстом
 * відповіді, і висока картка з'їдала пів екрана. Тому межа знижена, а
 * шрифт лицьової сторони — не базовий, а компактний. */
const flipFaceRule = (css.match(/\.flip-face\s*\{[^}]*\}/) || [''])[0];
checkThat('flip-face: обмежена висота, не екран',
  /height:\s*clamp\(/.test(flipFaceRule) && /380px/.test(flipFaceRule),
  `отримано: ${flipFaceRule.replace(/\s+/g, ' ')}`);
checkThat('flip-face: щільніші поля', /padding:\s*0\.7rem/.test(flipFaceRule),
  `отримано: ${flipFaceRule.replace(/\s+/g, ' ')}`);
checkThat('лицьова сторона: компактний шрифт',
  cardHtml.includes('class="card-content text-sm font-extrabold leading-5"'),
  cardHtml.slice(cardHtml.indexOf('card-content'), cardHtml.indexOf('card-content') + 60));
checkThat('мобільна мінімальна висота теж зменшена',
  /max-width:\s*640px\)\s*\{[^}]*min-height:\s*170px/.test(css));

console.log('\ncanMergeCards');
check('однакові', sandbox.canMergeCards(['A', 'B'], ['A', 'B']), true);
check('різні імена', sandbox.canMergeCards(['Код', 'Назва'], ['Питання', 'Відповідь']), false);
check('різна кількість', sandbox.canMergeCards(['A'], ['A', 'B']), false);
check('різний порядок', sandbox.canMergeCards(['A', 'B'], ['B', 'A']), false);
check('немає імен у вхідних — пропускаємо', sandbox.canMergeCards(['A'], []), true);

console.log('\nbuildExportPayload на реальній міграції');
const payload = sandbox.buildExportPayload(migrated);
check('field_names', payload.field_names, ['Front', 'Back', 'Extra']);
check('карток', payload.cards.length, 2);
check('значення картки', payload.cards[0].values, { Front: 'Питання', Back: 'Відповідь', Extra: 'Нотатка' });
check('усі поля в кожній картці', payload.cards.map(c => Object.keys(c.values).length), [3, 3]);
// Це те, що бекенд перетворить на Anki deck_id/note.guid. Якщо id
// немає — бекенд відкатиться на позиційний guid, і редагування
// картки знову почне плодити дублікати.
check('deck_id — uuid мігрованої колоди', payload.deck_id, migrated.id);
check('card id — uuid мігрованих карток',
  payload.cards.map(c => c.id), migrated.cards.map(c => c.id));

console.log('\nbuildExportPayload на 5 полях');
const payload5 = sandbox.buildExportPayload(five);
check('усі поля', Object.keys(payload5.cards[0].values), ['Код', 'Назва', 'Приклад', 'Джерело', 'Нотатка']);
check('5 полів у картці', Object.keys(payload5.cards[0].values).length, 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
