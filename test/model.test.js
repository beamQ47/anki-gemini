const M = require('../js/model.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${g}\n         want ${w}`); }
}

console.log('sanitizeFieldNames');
check('порожні + дублікати', M.sanitizeFieldNames(['A', '  ', 'A', ' B ', '', 5]), ['A', 'B']);
check('не масив', M.sanitizeFieldNames(null), []);
check('порядок зберігається', M.sanitizeFieldNames(['Z', 'A', 'M']), ['Z', 'A', 'M']);

console.log('\nresolveFieldNames');
check('явний список має пріоритет',
  M.resolveFieldNames([{ values: { X: '1' } }], ['A', 'B']), ['A', 'B']);
check('виводиться з карток коли немає списку',
  M.resolveFieldNames([{ values: { Код: '1', Значення: '2' } }]), ['Код', 'Значення']);
check('фолбек', M.resolveFieldNames([]), ['Front', 'Back', 'Extra']);
check('службові ключі не стають іменами полів',
  M.resolveFieldNames([{ id: 'x', createdAt: 1, front: 'f', back: 'b' }]),
  ['Front', 'Back', 'Extra']);
check('обєднання двох карток',
  M.resolveFieldNames([{ values: { A: '1' } }, { values: { B: '2' } }]), ['A', 'B']);

console.log('\nmigrateCard');
check('legacy front/back/extra',
  M.migrateCard({ front: 'f', back: 'b', extra: 'e', id: 'x', createdAt: 5 }).values,
  { Front: 'f', Back: 'b', Extra: 'e' });
check('новий формат без змін',
  M.migrateCard({ values: { Код: '200' }, createdAt: 7 }),
  { id: null, values: { Код: '200' }, createdAt: 7 });
check('id проходить наскрізь',
  M.migrateCard({ id: 'card-3f2504e0-4f89-41d3-9a0c-0305e82c3301', values: { Код: '200' } }).id,
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('невалідний id стає null, а не мусором',
  M.migrateCard({ id: 'legacy-1', values: { Код: '200' } }).id, null);
check('не обєкт', M.migrateCard(null), null);
check('довільні ключі',
  M.migrateCard({ Код: '200', Приклад: 'x' }).values, { Код: '200', Приклад: 'x' });
check('legacy ставиться позиційно на кастомні поля',
  M.migrateCard({ front: 'f', back: 'b' }, ['Код', 'Значення', 'Приклад']).values,
  { Код: 'f', Значення: 'b' });

console.log('\nnormalizeCards');
check('5 полів, друга картка неповна',
  M.normalizeCards([
    { values: { A: '1', B: '2', C: '3', D: '4', E: '5' } },
    { values: { A: '6', B: '7' } }
  ], ['A', 'B', 'C', 'D', 'E']).map((c) => c.values),
  [
    { A: '1', B: '2', C: '3', D: '4', E: '5' },
    { A: '6', B: '7', C: '', D: '', E: '' }
  ]);
check('null стає ""', M.normalizeCards([{ values: { A: null, B: 'b' } }], ['A', 'B'])[0].values.A, '');
check('пробіли обрізано', M.normalizeCards([{ values: { A: '  x  ' } }], ['A'])[0].values.A, 'x');
check('картка з усіма порожніми відкидається',
  M.normalizeCards([{ values: { A: '', B: '' } }], ['A', 'B']), []);
check('не масив', M.normalizeCards(null), []);

// Формули без роздільників. Модель частину пише так, і Anki такий текст не
// малює: користувач бачить «S = \pi r^2» замість кола. Тому normalizeCards
// домовляється роздільники — на одному місці для всіх карток.
console.log('\nLaTeX без роздільників');
const n = M.normalizeMathDelimiters;
check('готова формула не змінюється', n('\\(S = \\pi r^2\\)'), '\\(S = \\pi r^2\\)');
check('LaTeX-команда обгортається', n('S = \\pi r^2'), '\\(S = \\pi r^2\\)');
check('степінь обгортається', n('a^2 + b^2 = c^2'), '\\(a^2 + b^2 = c^2\\)');
check('індекс обгортається', n('Обчислення: x_1 + x_2 = 3'), 'Обчислення: \\(x_1 + x_2 = 3\\)');
check('мітка з двоеточчям лишається текстом', n('Формула: S = \\pi r^2'), 'Формула: \\(S = \\pi r^2\\)');
check('крапка в кінці речення — не в формулі', n('Площа дорівнює \\pi r^2.'), 'Площа дорівнює \\(\\pi r^2\\).');
check('десятковий дріб не розривається', n('x = 0.5 + \\pi r^2'), '\\(x = 0.5 + \\pi r^2\\)');
check('степінь після десяткового — не формула', n('V = 0.5^3 одиниці'), 'V = 0.5^3 одиниці');
check('багаторядковий блок — display', n('Формула:\nE = mc^2'), 'Формула:\\[\nE = mc^2\\]');
check('звичайний текст не зачепито', n('Площа круга дорівнює добутку квадрата радіуса на число пі.'),
  'Площа круга дорівнює добутку квадрата радіуса на число пі.');
check('нумерація питання не формула', n('Питання 2) 3) і 4)'), 'Питання 2) 3) і 4)');
check('гроші не формула', n('Ціна: 100$'), 'Ціна: 100$');
check('шлях у стилі Windows не формула', n('A\\B файли'), 'A\\B файли');
check('порожнє не змінюється', n(''), '');
check('null стає порожнім', n(null), '');
const twice = n('Формула: \\frac{1}{n}');
check('повторний виклик нічого не псує', n(twice), twice);
check('картка з моделі одразу отримує роздільники',
  M.normalizeCards([{ values: { A: 'S = \\pi r^2' } }], ['A'])[0].values.A, '\\(S = \\pi r^2\\)');

console.log('\ncardEntries');
check('порядок береться з fieldNames, не з ключів',
  M.cardEntries({ values: { B: 'b', A: 'a' } }, ['A', 'B']), [['A', 'a'], ['B', 'b']]);
check('пропущене поле стає ""',
  M.cardEntries({ values: { A: 'a' } }, ['A', 'B', 'C']), [['A', 'a'], ['B', ''], ['C', '']]);

console.log('\nміграція старої колоди з localStorage');
const legacy = M.normalizeCards([
  { id: 'a', front: 'Питання', back: 'Відповідь', extra: 'Нотатка', createdAt: 1 }
], undefined);
check('поле названо не "front"', M.resolveFieldNames(legacy), ['Front', 'Back', 'Extra']);
check('дані на місці', legacy[0].values, { Front: 'Питання', Back: 'Відповідь', Extra: 'Нотатка' });

console.log('\nbuildExportPayload');
const deck = {
  title: '  НПЗІБ Лекція 1  ',
  modelCss: '.card{}',
  fieldNames: ['Код', 'Значення', 'Приклад'],
  templates: [{ name: 'Ретро', qfmt: '{{Код}}', afmt: '{{FrontSide}}{{Значення}}' }],
  cards: [
    { values: { Код: '200', Значення: 'OK' } },
    { front: 'legacy', back: 'row', extra: 'e' }
  ]
};
const p = M.buildExportPayload(deck);
check('title обрізано', p.title, 'НПЗІБ Лекція 1');
check('field_names', p.field_names, ['Код', 'Значення', 'Приклад']);
check('css', p.css, '.card{}');
check('templates', p.templates.length, 1);

// buildExportPayload не вигадує id: колода без id експортується без них,
// а ідентичність присвоює migrateDeck. Інакше два експорти дали б різні
// GUID і кожен імпорт плодив би дублікати.
check('deck_id = null, коли колода без id', p.deck_id, null);
check('card id = null, коли картки без id', p.cards.map((c) => c.id), [null, null]);

// Картки тепер {id, values}: значення лишаються рівно ті самі.
check('values у форматі {імя: значення}', p.cards.map((c) => c.values), [
  { Код: '200', Значення: 'OK', Приклад: '' },
  { Код: 'legacy', Значення: 'row', Приклад: 'e' }
]);
check('кожна картка має всі поля',
  p.cards.map((c) => Object.keys(c.values).length), [3, 3]);

// Готова до експорту колода = усі id є. Саме це перевіряє decks.js
// перед запитом, щоб не відправити позиційні GUID.
check('колода без id не готова', M.isExportIdentityReady(deck), false);

console.log('\nСтабільність id між двома експортами');
// Найважливіша вимога: повторний експорт тієї самої колоди мусить дати
// ті самі Anki ID, інакше кожен імпорт плодитиме дублікати.
const ready = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  title: 'НПЗІБ Лекція 1',
  modelCss: '.card{}',
  fieldNames: ['Код', 'Значення', 'Приклад'],
  cards: [
    { id: '550e8400-e29b-41d4-a716-446655440000', values: { Код: '200', Значення: 'OK' } },
    { id: 'dc768abe-e8d4-4736-b210-0628c765a9d1', values: { Код: 'legacy', Значення: 'row' } }
  ]
};
check('готова колода проходить перевірку', M.isExportIdentityReady(ready), true);

const a = M.buildExportPayload(ready);
const b = M.buildExportPayload(ready);
check('deck_id стабільний', b.deck_id, a.deck_id);
check('card ids стабільні', b.cards.map((c) => c.id), a.cards.map((c) => c.id));

// Редагування тексту не змінює ідентичність — це і робить імпорт
// оновленням, а не створенням дубліката.
const edited = M.buildExportPayload({
  ...ready,
  title: 'НПЗІБ Лекція 1 (оновлено)',
  cards: [{ id: ready.cards[0].id, values: { Код: '201', Значення: 'OK' } }]
});
check('deck_id не залежить від назви', edited.deck_id, a.deck_id);
check('card id не залежить від вмісту', edited.cards[0].id, a.cards[0].id);

// Реордер карток теж не псує ідентичність.
const reordered = M.buildExportPayload({ ...ready, cards: [ready.cards[1], ready.cards[0]] });
check('id не залежать від порядку', reordered.cards.map((c) => c.id), [a.cards[1].id, a.cards[0].id]);

console.log('\nМіграція старих префіксних id');
const legacyIds = M.buildExportPayload({
  title: 'Стара',
  fieldNames: ['A', 'B'],
  cards: [
    { id: 'card-3f2504e0-4f89-41d3-9a0c-0305e82c3301', values: { A: '1', B: '2' } },
    { id: 'deck-550e8400-e29b-41d4-a716-446655440000', values: { A: '3', B: '4' } }
  ]
});
check('префікс card- знято', legacyIds.cards[0].id, '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('префікс deck- знято', legacyIds.cards[1].id, '550e8400-e29b-41d4-a716-446655440000');
check('усі id валідні uuid',
  legacyIds.cards.every((c) => M.normalizeUuid(c.id)), true);

console.log('\nnormalizeUuid');
check('канонічний uuid', M.normalizeUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('без дефісів', M.normalizeUuid('3f2504e04f8941d39a0c0305e82c3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('фигурні дужки', M.normalizeUuid('{3f2504e0-4f89-41d3-9a0c-0305e82c3301}'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
check('префікс знімається', M.normalizeUuid('card-3f2504e0-4f89-41d3-9a0c-0305e82c3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
for (const bad of ['', 'legacy-1', 'not-a-uuid', '12345', 'deck-zzzzzzzz', null, 42, undefined]) {
  check(`відхилено ${JSON.stringify(bad)}`, M.normalizeUuid(bad), null);
}

console.log('\nnewUuid');
const generated = M.newUuid();
check('newUuid — валідний uuid', M.normalizeUuid(generated), generated);
check('newUuid унікальний', new Set(Array.from({ length: 50 }, () => M.newUuid())).size, 50);
check('newUuid version 4', generated[14], '4');
check('ensureUuid підставляє новий для сміття', M.normalizeUuid(M.ensureUuid('legacy-1')) !== null, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
