const M = require('../js/model.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${g}\n         want ${w}`); }
}
function ok(label, value) {
  if (value) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} — очікувалося правдиве значення`); }
}

// Одна й та сама схема в усьому файлі:
// університет -> математика -> лекція 1, лекція 2
//             -> фізика    -> лекція 1
const U = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';
const F1 = '55555555-5555-4555-8555-555555555555';
const L3 = '66666666-6666-4666-8666-666666666666';
const LOOSE = '77777777-7777-4777-8777-777777777777';

const tree = [
  { id: U, title: 'університет', cards: [] },
  { id: M1, title: 'математика', parentId: U, cards: [] },
  { id: L1, title: 'лекція 1', parentId: M1, cards: [] },
  { id: L2, title: 'лекція 2', parentId: M1, cards: [] },
  { id: F1, title: 'фізика', parentId: U, cards: [] },
  { id: L3, title: 'лекція 1', parentId: F1, cards: [] },
  { id: LOOSE, title: 'Оране', cards: [] }
];

console.log('splitDeckPath');
check('повний шлях', M.splitDeckPath('університет::математика::лекція1'),
  ['університет', 'математика', 'лекція1']);
check('без роздільника', M.splitDeckPath('Математика'), ['Математика']);
check('порожні сегменти відкидаються', M.splitDeckPath('::A::::B::'), ['A', 'B']);
check('пробіли вирізано', M.splitDeckPath('  A :: B  '), ['A', 'B']);
check('не рядок', M.splitDeckPath(null), []);
check('дуже довгий сегмент обрізано',
  M.splitDeckPath('x'.repeat(200))[0].length, 80);

console.log('\ndeckPathString');
check('три рівні', M.deckPathString(tree[2], tree), 'університет::математика::лекція 1');
check('корінь без роздільника', M.deckPathString(tree[0], tree), 'університет');
check('дві гілки дають різні шляхи для однакової назви',
  [M.deckPathString(tree[2], tree), M.deckPathString(tree[5], tree)],
  ['університет::математика::лекція 1', 'університет::фізика::лекція 1']);

console.log('\ndeckAncestors');
check('від кореня вниз', M.deckAncestors(tree[2], tree).map(item => item.title),
  ['університет', 'математика']);
check('корінь не має батьків', M.deckAncestors(tree[0], tree), []);
check('батько переданий самим объектом', M.deckAncestors(tree[3], tree).map(item => item.title),
  ['університет', 'математика']);
check('неіснуючий батьк не ламає ланцюг', M.deckAncestors({ id: L1, parentId: M1 }, []), []);

console.log('\nbuildDeckTree');
const built = M.buildDeckTree(tree);
check('корені відсортовано за назвою', built.map(node => node.deck.title), ['Оране', 'університет']);
check('нащадки фізики', built[1].children[1].children.map(n => n.deck.title), ['лекція 1']);
check('гілки університету', built[1].children.map(n => n.deck.title), ['математика', 'фізика']);
check('глибина вкладення', built[1].children[0].children[0].children, []);

console.log('\nflattenDeckTree');
const rows = M.flattenDeckTree(tree, new Set());
check('порядок рядків', rows.map(row => [row.deck.title, row.depth]), [
  ['Оране', 0],
  ['університет', 0],
  ['математика', 1],
  ['лекція 1', 2],
  ['лекція 2', 2],
  ['фізика', 1],
  ['лекція 1', 2]
]);
check('прапорці нащадків', rows.map(row => row.hasChildren), [false, true, true, false, false, true, false]);
check('усе розгорнуто', rows.every(row => row.expanded), true);

const collapsed = M.flattenDeckTree(tree, new Set([U]));
check('згорнута гілка ховає нащадків', collapsed.map(row => [row.deck.title, row.depth]), [
  ['Оране', 0],
  ['університет', 0]
]);
ok('згорнутий вузол має розкривачку', collapsed.find(row => row.deck.id === U).hasChildren === true);
check('глибше згорнутий вузол', M.flattenDeckTree(tree, new Set([M1])).map(row => row.deck.title),
  ['Оране', 'університет', 'математика', 'фізика', 'лекція 1']);

console.log('\nСтійкість до сміття');
check('колода з неіснуючим батьком стає коренем, а не губиться',
  M.flattenDeckTree([{ id: L1, title: 'сирота', parentId: M1 }], new Set())
    .map(row => [row.deck.title, row.depth]),
  [['сирота', 0]]);
const cyclic = [
  { id: L1, title: 'A', parentId: L2 },
  { id: L2, title: 'B', parentId: L1 }
];
check('цикл не з' + 'їдає колоди', M.flattenDeckTree(cyclic, new Set()).map(row => row.deck.title).sort(),
  ['A', 'B']);
check('глибокий ланцюг не ламає while',
  M.deckAncestors({ id: L1, parentId: M1, title: 'x' }, tree).length, 2);

console.log('\nisDescendantDeck');
ok('нащадок', M.isDescendantDeck(L1, M1, tree));
ok('прямий нащадок', M.isDescendantDeck(L1, U, tree));
ok('сусід — не нащадок', !M.isDescendantDeck(L3, M1, tree));
ok('батько — не нащадок', !M.isDescendantDeck(M1, L1, tree));
ok(' себе не нащадок', !M.isDescendantDeck(L1, L1, tree));
ok('неіснуючий кандидат', !M.isDescendantDeck('99999999-9999-4999-8999-999999999999', U, tree));

console.log('\ncanMoveDeck');
ok('у корінь можна завжди', M.canMoveDeck(L1, null, tree));
ok('під іншу гілку можна', M.canMoveDeck(L1, F1, tree));
ok('себе під себе — ні', !M.canMoveDeck(L1, L1, tree));
ok('під власного нащадка — ні', !M.canMoveDeck(U, L1, tree));
ok('під власного онука — ні', !M.canMoveDeck(U, L2, tree));
ok('під неіснуючу колоду — ні', !M.canMoveDeck(L1, '99999999-9999-4999-8999-999999999999', tree));
ok('невідома колода — ні', !M.canMoveDeck(null, U, tree));

console.log('\ndeckParentOptions');
const options = M.deckParentOptions(tree, U);
check('корінь завжди перший', options[0].title, '— Корінь —');
check('кількість = колоди + корінь', options.length, tree.length + 1);
check('себе не можна обрати', options.find(o => o.id === U).disabled, true);
check('нащадка не можна обрати', options.find(o => o.id === L1).disabled, true);
check('сусіда можна', options.find(o => o.id === LOOSE).disabled, false);
check('власного нащадка не можна', options.find(o => o.id === F1).disabled, true);
check('глибина для відступу', options.find(o => o.id === L1).depth, 2);

console.log('\nmaterializeDeckPaths');
const legacy = [
  { id: L1, title: 'університет::математика::лекція 1', cards: [{ id: L2, values: { A: '1' } }] },
  { id: F1, title: 'Оране', cards: [] }
];
const built2 = M.materializeDeckPaths(legacy);
check('назву розкладено', built2.decks.map(d => d.title),
  ['університет', 'математика', 'лекція 1', 'Оране']);
check('створено два батьки', built2.created.map(d => d.title), ['університет', 'математика']);
check('розкладені листки повернуто окремо', built2.updated.map(d => d.title), ['лекція 1']);
check('це саме той самий об\'єкт, що в дереві',
  built2.updated[0] === built2.decks.find(d => d.id === L1), true);
check('лист причепився до останнього батька',
  built2.decks.find(d => d.id === L1).parentId, built2.created[1].id);
check('перший батьк у корені', built2.created[0].parentId, null);
check('картки на місці', built2.decks.find(d => d.id === L1).cards.length, 1);
check('назви без "::" не чіпаються', M.materializeDeckPaths(legacy.slice(1)).created, []);
check('і не вважаються зміненими', M.materializeDeckPaths(legacy.slice(1)).updated, []);
check('оригінальний масив не муситься', M.materializeDeckPaths(legacy).decks.length, 4);

console.log('\nПовторна синхронізація не плодить гілки');
const saved = built2.decks;
const again = M.materializeDeckPaths(saved);
check('уже чисті назви нічого не створюють', again.created, []);
check('і нічого не оновлюють', again.updated, []);
check('батьки зберегли тих самих id',
  again.decks.find(d => d.title === 'математика').id, built2.created[1].id);
check('листок усе ще під тією ж математикою',
  again.decks.find(d => d.id === L1).parentId, built2.created[1].id);

const twice = M.materializeDeckPaths([
  { id: L1, title: 'A::B', cards: [] },
  { id: F1, title: 'A::C', cards: [] }
]);
check('спільний батьк створюється один раз', twice.created.map(d => d.title), ['A']);
check('обидві гілки під ним',
  twice.decks.filter(d => ['B', 'C'].includes(d.title)).map(d => d.parentId),
  [twice.created[0].id, twice.created[0].id]);

console.log('\nduplicateSiblingTitle');
check('сестра з тим самим ім\'ям', M.duplicateSiblingTitle('лекція 2', M1, null, tree).id, L2);
check('та сама назва в іншій гілці — конфлікт лише з тією гілкою',
  M.duplicateSiblingTitle('лекція 1', F1, null, tree).id, L3);
check('вільна назва під фізикою', M.duplicateSiblingTitle('лекція 3', F1, null, tree), null);
check('корінь з тим самим ім\'ям', M.duplicateSiblingTitle('Оране', null, null, tree).id, LOOSE);
check('інший корінь вільний', M.duplicateSiblingTitle('Англійська', null, null, tree), null);
check('регістр не ходить в обхід', M.duplicateSiblingTitle('ЛЕКЦІЯ 2', M1, null, tree).id, L2);
check('перейменування не конфліктує з собою',
  M.duplicateSiblingTitle('лекція 1', M1, L1, tree), null);
check('пробіли ігноруються', M.duplicateSiblingTitle('  лекція 2 ', M1, null, tree).id, L2);
check('порожня назва нікого не знаходить', M.duplicateSiblingTitle('   ', M1, null, tree), null);
check('сміття у списку не ламає', M.duplicateSiblingTitle('x', M1, null, [null, 5, { id: 'нет' }]), null);

console.log('\nparentTitleOf');
check('корінь', M.parentTitleOf(null, tree), 'Корінь');
check('наявний батьк', M.parentTitleOf(M1, tree), 'математика');
check('неіснуючий батьк', M.parentTitleOf(LOOSE, tree), 'Оране');
check('відсутня назва', M.parentTitleOf(
  LOOSE, [{ id: LOOSE, title: '   ' }]), 'Без назви');

console.log('\nbuildExportPayload з ієрархією');
const payload = M.buildExportPayload(tree[2], tree);
check('ancestors від кореня', payload.ancestors,
  [{ id: U, title: 'університет' }, { id: M1, title: 'математика' }]);
check('title — лише листок', payload.title, 'лекція 1');
check('deck_id стабільний', payload.deck_id, L1);
check('без списку колод ancestors порожні',
  M.buildExportPayload(tree[2]).ancestors, []);

console.log('\nЕкспорт батька тягне піддерево');
// Без subtree експорт «університет» давав порожній .apkg: Anki бачив
// дерево, але жодної картки всередині. Кожен нащадок — самостійний
// вузол із власним ланцюгом батьків, інакше сервер не знав би, у яку
// гілку його покласти.
const parentPayload = M.buildExportPayload(tree[0], tree);
check('корінь без карток', parentPayload.cards, []);
check('корінь не дублює себе в subtree',
  parentPayload.subtree.some(n => n.deck_id === U), false);
check('у subtree вся гілка', parentPayload.subtree.map(n => n.deck_id),
  [M1, L1, L2, F1, L3]);
check('сусідня гілка не потрапляє', parentPayload.subtree.some(n => n.deck_id === LOOSE), false);
check('кожен нащадок має повний ланцюг',
  parentPayload.subtree.find(n => n.deck_id === L1).ancestors,
  [{ id: U, title: 'університет' }, { id: M1, title: 'математика' }]);
check('середня ланка має одного батька',
  parentPayload.subtree.find(n => n.deck_id === M1).ancestors,
  [{ id: U, title: 'університет' }]);
const mathNode = parentPayload.subtree.find(n => n.deck_id === M1);
check('у нащадка власні поля, а не батькові',
  mathNode.field_names, M.deckFieldNames(tree[1]));
check('поля нащадка не порожні', mathNode.field_names.length > 0, true);

console.log('\nbuildSubtreeExportNodes');
const nodes = M.buildSubtreeExportNodes(tree[1], tree);
check('від математики вниз', nodes.map(n => n.deck_id), [M1, L1, L2]);
check('корінь не потрапляє у власне піддерево',
  nodes.some(n => n.deck_id === U), false);
check('листок без дітей — один вузол',
  M.buildSubtreeExportNodes(tree[2], tree).map(n => n.deck_id), [L1]);
check('для листочка subtree порожній', M.buildExportPayload(tree[2], tree).subtree, []);
check('неіснуюча колода', M.buildSubtreeExportNodes(null, tree), []);
check('без списку колод — лише сам вузол',
  M.buildSubtreeExportNodes(tree[0], []).map(n => n.deck_id), [U]);

console.log('\nОбхід не зациклюється на кривому parentId');
// A -> B -> A. Обхід має зупинитися, а не впасти на стеку.
const cyclicTree = [
  { id: U, title: 'A', parentId: M1, cards: [] },
  { id: M1, title: 'B', parentId: U, cards: [] }
];
check('цикл не ламає збір', M.buildSubtreeExportNodes(cyclicTree[0], cyclicTree)
  .map(n => n.deck_id), [U, M1]);

console.log('\nСтабільність ідентичності в ієрархії');
const before = M.buildExportPayload(tree[2], tree);
const renamed = tree.map(d => d.id === M1 ? { ...d, title: 'Математика' } : d);
const after = M.buildExportPayload(renamed[2], renamed);
check('deck_id не залежить від назви батька', after.deck_id, before.deck_id);
check('id батька у шляху той самий', after.ancestors[1].id, before.ancestors[1].id);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
