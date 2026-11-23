/**
 * Чисті функції моделі даних. Без DOM, без fetch — щоб їх можна було
 * прогнати в Node і перевірити окремо від інтерфейсу.
 *
 * Ключове правило всього застосунку:
 *   порядок полів береться ЗАВЖДИ з fieldNames, а ніколи з Object.keys(values).
 *   Object.keys() для об'єкта не гарантує порядок, тому поламання стає
 *   випадковим: колонки в UI й колонки в .apkg розійдуться.
 */

const DEFAULT_FIELD_NAMES = ['Front', 'Back', 'Extra'];
const LEGACY_KEYS = ['front', 'back', 'extra'];
const STRUCTURAL_KEYS = new Set(['id', 'createdAt', 'position', 'values', 'parentId', ...LEGACY_KEYS]);

/** Роздільник вкладених колод — такий самий, як в Anki. */
const DECK_PATH_SEPARATOR = '::';
const DECK_TITLE_MAX = 80;

/**
 * Та сама форма, що в anki_ids.normalize_uuid.
 *
 * Два незалежні фільтри на один UUID — не дублювання заради краси:
 * JS перетворює клієнтські дані на форму, яку очікує `uuid` PRIMARY KEY
 * у БД, а Python вже не довіряє клієнту і перевіряє знову. Якщо вони
 * розійдуться, помилка вилізе одразу, а не мовчки накопичиться.
 */
const UUID_RE = /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

/** UUID4 завжди у коректному вигляді, навіть без window.crypto.randomUUID. */
function newUuid() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32)
  ].join('-');
}

/** Будь-який запис UUID -> канонічний, або null. Знімає старий 'card-'/'deck-'. */
function normalizeUuid(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();

  if (text.includes('-') && !UUID_RE.test(text)) {
    const tail = text.slice(text.indexOf('-') + 1);
    if (UUID_RE.test(tail)) text = tail;
  }

  const match = text.match(UUID_RE);
  return match ? match.slice(1, 6).join('-').toLowerCase() : null;
}

/** UUID або новий. Використовувати під час міграції старих даних. */
function ensureUuid(value) {
  return normalizeUuid(value) || newUuid();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Прибирає порожні і дубльовані імена, зберігає порядок. */
function sanitizeFieldNames(names) {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Імена полів усього набору: спершу явний список, потім ключі карток. */
function resolveFieldNames(cards, explicit) {
  const explicitNames = sanitizeFieldNames(explicit);
  if (explicitNames.length) return explicitNames;

  const seen = new Set();
  for (const card of cards || []) {
    const values = isPlainObject(card) ? (isPlainObject(card.values) ? card.values : card) : null;
    if (!values) continue;
    for (const key of Object.keys(values)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      if (typeof key === 'string' && key.trim() && !seen.has(key)) seen.add(key);
    }
  }
  const derived = Array.from(seen);
  return derived.length ? derived : DEFAULT_FIELD_NAMES.slice();
}

/**
 * Стара картка {front, back, extra} -> нова {id, values}.
 *
 * Якщо відомі імена полів колоди, старі три значення ставляться на них
 * ПОЗИЦІЙНО (front -> поле 1, back -> поле 2, extra -> поле 3).
 * Інакше картка зникла б, а користувач не зрозумів би чому: у старому
 * форматі полів було рівно три, значить і порядок відомий.
 *
 * id проходить наскрізь: він задає ідентичність картки в Anki, тому
 * міграція не має його втрачати. normalizeUuid, а не сирий рядок —
 * старі 'card-<uuid>' теж мають пройти.
 */
function migrateCard(card, fieldNames) {
  if (!isPlainObject(card)) return null;
  if (isPlainObject(card.values)) {
    return {
      id: normalizeUuid(card.id),
      values: { ...card.values },
      createdAt: Number(card.createdAt) || Date.now()
    };
  }
  const target = sanitizeFieldNames(fieldNames);
  const slots = target.length
    ? target.slice(0, LEGACY_KEYS.length)
    : DEFAULT_FIELD_NAMES;

  const values = {};
  LEGACY_KEYS.forEach((legacyKey, index) => {
    if (card[legacyKey] !== undefined) values[slots[index]] = String(card[legacyKey] ?? '');
  });
  for (const key of Object.keys(card)) {
    if (STRUCTURAL_KEYS.has(key) || key in values) continue;
    values[key] = String(card[key] ?? '');
  }
  return {
    id: normalizeUuid(card.id),
    values,
    createdAt: Number(card.createdAt) || Date.now()
  };
}

const EMPTY_FIELD_PLACEHOLDERS = new Set([
  '—', '–', '-', '―', '‒',
  'немає', 'нема', 'відсутнє', 'відсутня', 'відсутній',
  'н/д', 'n/d', 'n/a', 'na', 'null', 'none',
  'не застосовується', 'немає даних', 'без позначення',
  '.', '…', '...',
]);

/**
 * Перевіряє, чи є поле порожнім або заповненим філером/тире/заглушкою від Gemini.
 */
function isFieldEmpty(value) {
  if (value === null || value === undefined) return true;
  const raw = String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u200b-\u200d\ufeff\u00a0]/g, '')
    .trim();
  if (!raw) return true;
  return EMPTY_FIELD_PLACEHOLDERS.has(raw) || EMPTY_FIELD_PLACEHOLDERS.has(raw.toLowerCase());
}

/**
 * Картки -> [{id, values, createdAt}], вирівняні під fieldNames.
 *
 * Порожні картки відкидаються, тому позиція у результаті НЕ збігається
 * з позицією у вхідних даних. Через це id дістається з об'єкта картки,
 * а не за індексом: інакше видалена картка змістила б усі наступні id
 * і картки отримали б чужі ідентичності в Anki.
 */
function normalizeCards(cards, fieldNames) {
  if (!Array.isArray(cards)) return [];
  const names = resolveFieldNames(cards, fieldNames);
  const out = [];
  for (const raw of cards) {
    const migrated = migrateCard(raw, names);
    if (!migrated) continue;
    const values = {};
    let filled = false;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const value = migrated.values[name];
      // Формули нормалізуються тут, а не в розрізних місцях: це єдина
      // точка, через яку проходять усі картки — від відповіді Gemini до
      // експорту. Старі колоди з «S = \pi r^2» виправляються при завантаженні.
      let text = value === undefined || value === null ? '' : normalizeMathDelimiters(String(value).trim());
      if (i > 0 && isFieldEmpty(text)) {
        text = '';
      }
      values[name] = text;
      if (text) filled = true;
    }
    if (!filled) continue;
    out.push({ id: migrated.id, values, createdAt: migrated.createdAt });
  }
  return out;
}

/**
 * LaTeX у полі, але без роздільників -> з роздільниками, які розуміє Anki.
 *
 * Навіщо, якщо промпт уже просить про \( ... \): модель все одно частину
 * формул пише без обгортки — «S = \pi r^2». Anki такий текст не малює,
 * користувач бачить сирий слеш. Правило в промпті зменшує кількість таких
 * випадків, але не гарантує нуль, тож ловимо їх тут, на одному місці,
 * звідки проходять усі картки: відповідь Gemini, завантаження колоди,
 * редактор, прев'ю та експорт.
 *
 * Обгортка навмисно консервативна. Спрацьовує лише на явних ознаках
 * математики (команда зі словника або команда з дужкою, степінь/індекс) і
 * лише коли в полі немає жодного роздільника. Звичайний текст не
 * зачіпається: краще недомалювати формулу, ніж перетворити речення на
 * курсивний математичний шрифт.
 */
const MATH_COMMANDS = new Set([
  'pi', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu',
  'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'infty',
  'partial', 'nabla', 'sum', 'prod', 'int', 'oint', 'lim', 'log', 'ln', 'lg',
  'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos',
  'arctan', 'det', 'dim', 'deg', 'gcd', 'max', 'min', 'arg',
  'cdot', 'times', 'div', 'pm', 'mp', 'circ', 'leq', 'geq', 'neq', 'approx',
  'sim', 'simeq', 'cong', 'propto', 'equiv', 'in', 'subset', 'subseteq',
  'cup', 'cap', 'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'mapsto',
  'ldots', 'cdots', 'qquad', 'quad', 'text', 'mathrm', 'mathbf',
  'mathbb', 'operatorname', 'displaystyle', 'begin', 'end', 'left', 'right',
  'pmatrix', 'bmatrix', 'vmatrix', 'matrix', 'cases', 'aligned'
]);

/** \pi, \alpha, ..., \cdot — команда зі словника. */
const MATH_COMMAND_RE = /\\([A-Za-z]+)(\{)?/g;
/**
 * x^2, a_{ij}, R^2 — степінь або індекс, типові для навчальних полів.
 *
 * (?<!\d\.) — інакше під роздільник потрапив би десятковий дріб: у «0.5^3»
 * степінь має саме п'ятка, а не число 0.5.
 */
const MATH_POWER_RE = /(?<!\d\.)[A-Za-z0-9)\]]\s*[\^_]/g;
/**
 * Символи, всередину яких математика має право «заходити».
 * Крапка тут потрібна для десяткових дробів: «0.5 + \pi» має бути цілком
 * формулою. Кирилиці в наборі немає — тому «Площа: S» не затягне слово.
 */
const MATH_EDGE_RE = /[A-Za-z0-9^(){}\[\]\\=+\-./<>|'\s]/;
/** Занадто довгий шматок — точно не формула, а випадково спійманий текст. */
const MATH_MAX_LENGTH = 300;

/**
 * Нормалізує одне значення поля. Ідемпотентна: вже обгорнуте не торкається.
 */
function normalizeMathDelimiters(value) {
  const text = String(value == null ? '' : value);
  if (!text) return text;
  // Модель вже вміла — не чіпаємо. Тут же зупиняємось на $: Anki його не
  // розуміє, але розбирати чужі помилки ми не наймемо.
  if (text.includes('\\(') || text.includes('\\[') || text.includes('$')) return text;

  const marks = [];
  MATH_COMMAND_RE.lastIndex = 0;
  for (let m = MATH_COMMAND_RE.exec(text); m; m = MATH_COMMAND_RE.exec(text)) {
    if (m[2] || MATH_COMMANDS.has(m[1].toLowerCase())) {
      marks.push([m.index, m.index + m[0].length]);
    }
  }
  MATH_POWER_RE.lastIndex = 0;
  for (let m = MATH_POWER_RE.exec(text); m; m = MATH_POWER_RE.exec(text)) {
    marks.push([m.index, m.index + m[0].length]);
  }
  if (!marks.length) return text;

  let start = Math.min(...marks.map((mark) => mark[0]));
  let end = Math.max(...marks.map((mark) => mark[1]));

  // Розширюємо межі на сусідні символи математики, але не за кіпцем слово:
  // кирилиця в набір не входить, тож «Площа: S = \pi» не затягне «Площа».
  while (start > 0 && MATH_EDGE_RE.test(text[start - 1])) start--;
  while (end < text.length && MATH_EDGE_RE.test(text[end])) end++;

  // Прибираемо пробіли та пунктуацію, які виявилися усередині, — вони
  // належать звичайному тексту, а не формулі («Формула: x^2»).
  while (start < end && ' \t:;,.'.includes(text[start])) {
    // Крапка — лише тоді, коли це не десятковий дріб: у 0.5 її не чіпаємо.
    if (text[start] === '.' && /\d/.test(text[start + 1] || '')) break;
    start++;
  }
  while (end > start && ' \t:;,.'.includes(text[end - 1])) {
    if (text[end - 1] === '.' && /\d/.test(text[end] || '')) break;
    end--;
  }

  const span = text.slice(start, end);
  if (!span.trim() || span.length > MATH_MAX_LENGTH) return text;
  const [open, close] = span.includes('\n') ? ['\\[', '\\]'] : ['\\(', '\\)'];
  return text.slice(0, start) + open + span + close + text.slice(end);
}

/** [[ім'я, значення], ...] у порядку fieldNames — для рендеру. */
function cardEntries(card, fieldNames) {
  const values = isPlainObject(card) && isPlainObject(card.values) ? card.values : {};
  const names = sanitizeFieldNames(fieldNames).length
    ? sanitizeFieldNames(fieldNames)
    : Object.keys(values);
  return names.map((name) => [name, String(values[name] ?? '')]);
}

function deckFieldNames(deck) {
  return resolveFieldNames(deck && deck.cards, deck && deck.fieldNames);
}

const MAX_STYLES = 30;
const MAX_STYLE_NAME = 60;
const MAX_STYLE_CSS = 20000;

/**
 * Бібліотека іменованих стилів колоди: {activeId, items: [{id, name, css}]}.
 *
 * Один стиль — один CSS на всі поля картки. Окремих стилів «на питання»
 * чи «на відповідь» немає свідомо: у колоді п'ять полів, і п'ять копій
 * одного правила в бібліотеці означали б п'ять однакових стилів, які
 * треба тримати синхронними вручну.
 *
 * fallbackCss потрібен для старих колод, збережених до появи бібліотеки:
 * з їхнього modelCss заводиться один стиль «Основний», інакше колода
 * лишилася б без жодного стилю, а її CSS — поза бібліотекою.
 */
function sanitizeDeckStyles(styles, fallbackCss) {
  const source = isPlainObject(styles) ? styles : {};
  const seen = new Set();
  const items = [];
  const rawItems = Array.isArray(source.items) ? source.items : [];

  for (const item of rawItems) {
    if (items.length >= MAX_STYLES) break;
    if (!isPlainObject(item)) continue;
    const id = String(item.id ?? '').trim().slice(0, 64);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(item.name ?? '').trim().slice(0, MAX_STYLE_NAME);
    items.push({
      id,
      name: name || 'Стиль',
      css: String(item.css ?? '').slice(0, MAX_STYLE_CSS)
    });
  }

  if (!items.length) {
    const css = String(fallbackCss ?? '');
    if (css.trim()) items.push({ id: newUuid(), name: 'Основний', css });
  }

  const activeId = items.some(item => item.id === String(source.activeId ?? ''))
    ? String(source.activeId)
    : (items[0] ? items[0].id : '');

  return { activeId, items };
}

/**
 * Чи можна покласти картки в цю колоду.
 * Різні імена полів означають, що значення не збігаються: переносити не
 * можна, бо картки стануть порожніми. Порядок має збігатися теж.
 */
function canMergeCards(deckNames, incomingNames) {
  const target = sanitizeFieldNames(deckNames);
  const incoming = sanitizeFieldNames(incomingNames);
  if (!incoming.length) return true;
  return target.length === incoming.length && target.every((name, i) => name === incoming[i]);
}

// --- ІЄРАРХІЯ КОЛОД ---
//
// Anki зберігає вкладену колоду як повне ім'я з "::": "університет::математика".
// Тут те саме, але окремими полями: у базі parent_id, у фронтенді parentId.
// Роздільник потрібен лише на експорті — саме з нього Anki відбудовує дерево.

/** 'університет::математика::лекція1' -> ['університет', 'математика', 'лекція1']. */
function splitDeckPath(value) {
  if (typeof value !== 'string') return [];
  const out = [];
  for (const raw of value.split(DECK_PATH_SEPARATOR)) {
    // "A:::B" і "::A::" не повинні давати порожніх сегментів: інакше в базі
    // з'явилися б колоди без назви, а в Anki — порожні підколоди.
    const part = raw.replace(/^[\s:]+/, '').replace(/[\s:]+$/, '').trim();
    if (part) out.push(part.slice(0, DECK_TITLE_MAX));
  }
  return out;
}

function deckById(decks, id) {
  const target = normalizeUuid(id);
  if (!target) return null;
  for (const deck of Array.isArray(decks) ? decks : []) {
    if (isPlainObject(deck) && normalizeUuid(deck.id) === target) return deck;
  }
  return null;
}

/**
 * Ланцюг батьків від кореня до прямого батька.
 *
 * Цикл (A -> B -> A) обривається: інакше while нижче не завершився б, а
 * колода зникла б зі списку або підвісила б рендер.
 */
function deckAncestors(deck, decks) {
  const out = [];
  const self = isPlainObject(deck) ? deck : deckById(decks, deck);
  if (!self) return out;

  const seen = new Set();
  let current = self;
  while (isPlainObject(current)) {
    const parentId = normalizeUuid(current.parentId);
    if (!parentId || seen.has(parentId)) break;
    const parent = deckById(decks, parentId);
    if (!parent) break;
    seen.add(parentId);
    out.unshift({ id: parentId, title: String(parent.title || '').trim() || 'Без назви' });
    current = parent;
  }
  return out;
}

/** 'університет::математика::лекція1' — саме те, що Anki показує як назву. */
function deckPathString(deck, decks) {
  const own = isPlainObject(deck) ? String(deck.title || '').trim() : '';
  return [...deckAncestors(deck, decks).map((item) => item.title), own]
    .filter(Boolean)
    .join(DECK_PATH_SEPARATOR);
}

/** Чи лежить candidateId усередині гілки ancestorId. */
function isDescendantDeck(candidateId, ancestorId, decks) {
  const ancestor = normalizeUuid(ancestorId);
  const candidate = normalizeUuid(candidateId);
  if (!ancestor || !candidate || ancestor === candidate) return false;

  const seen = new Set();
  let current = deckById(decks, candidate);
  while (current) {
    const parentId = normalizeUuid(current.parentId);
    if (!parentId || seen.has(parentId)) return false;
    if (parentId === ancestor) return true;
    seen.add(parentId);
    current = deckById(decks, parentId);
  }
  return false;
}

/**
 * Чи можна перемістити колоду під newParentId.
 *
 * Три відмови: невідома колода, себе саму та власного нащадка. Останнє —
 * найважливіше: інакше A можна було б зробити нащадком B, а B нащадком A,
 * дерево втратило б обидві колоди назавжди.
 */
function canMoveDeck(deckId, newParentId, decks) {
  const self = normalizeUuid(deckId);
  if (!self) return false;
  const parent = normalizeUuid(newParentId);
  if (!parent) return true;
  if (parent === self) return false;
  if (!deckById(decks, parent)) return false;
  return !isDescendantDeck(parent, self, decks);
}

/**
 * Дерево колод: вузли {deck, children}, відсортовано за назвою.
 *
 * Колода з неіснуючим батьком стає коренем, а не губиться: інакче одна
 * битий рядок у localStorage сховав би від користувача цілу колоду.
 */
function buildDeckTree(decks) {
  const nodes = new Map();
  for (const deck of Array.isArray(decks) ? decks : []) {
    if (!isPlainObject(deck)) continue;
    const id = normalizeUuid(deck.id);
    if (!id || nodes.has(id)) continue;
    nodes.set(id, { id, deck: { ...deck, id }, children: [] });
  }

  const chainOf = (startId) => {
    const chain = [];
    const seen = new Set([startId]);
    let current = nodes.get(startId);
    while (current) {
      const parentId = normalizeUuid(current.deck.parentId);
      if (!parentId || !nodes.has(parentId)) break;
      if (seen.has(parentId)) return null;
      seen.add(parentId);
      chain.push(parentId);
      current = nodes.get(parentId);
    }
    return chain;
  };

  const roots = [];
  for (const node of nodes.values()) {
    const chain = chainOf(node.id);
    const parentId = chain && chain.length ? chain[0] : null;
    if (parentId) nodes.get(parentId).children.push(node);
    else roots.push(node);
  }

  const sortNodes = (items) => {
    items.sort((a, b) => String(a.deck.title || '').localeCompare(String(b.deck.title || ''), 'uk'));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

/**
 * Дерево -> плоский список рядків для розмітки: {deck, depth, hasChildren, expanded}.
 * Згорнуті гілки пропускаються разом із нащадками, тому рядок у списку
 * і картка в DOM завжди на одному місці.
 */
function flattenDeckTree(decks, collapsed) {
  const closed = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const out = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const expanded = !closed.has(node.id);
      out.push({ deck: node.deck, depth, hasChildren, expanded });
      if (hasChildren && expanded) walk(node.children, depth + 1);
    }
  };
  walk(buildDeckTree(decks), 0);
  return out;
}

/**
 * Список батьків для select: корінь + усі колоди, де заборонено
 * піднімати колоду під саму себе або під її нащадка.
 */
function deckParentOptions(decks, deckId) {
  const options = [{ id: null, title: '— Корінь —', depth: 0, disabled: false }];
  for (const row of flattenDeckTree(decks, new Set())) {
    const self = normalizeUuid(row.deck.id) === normalizeUuid(deckId);
    options.push({
      id: row.deck.id,
      title: String(row.deck.title || '').trim() || 'Без назви',
      depth: row.depth,
      disabled: self || !canMoveDeck(deckId, row.deck.id, decks)
    });
  }
  return options;
}

/**
 * Чи є вже колода з таким самим ім'ям серед братів і сестер.
 *
 * У базі це унікальний індекс (user_id, parent, lower(title)), тож
 * дублікат відхилений би сервером із 409. Тут та сама перевірка, щоб
 * користувач дістав відповідь до того, як щось створиться, а не після.
 *
 * ignoreId — колода, яку перейменовують: вона не конфліктує сама з собою.
 * Порівняння без урахування регістру — щоб «Лекція 1» не пройшла повз
 * «лекція 1» і не впала потім на сервері.
 */
function duplicateSiblingTitle(title, parentId, ignoreId, decks) {
  const wanted = String(title || '').trim().toLowerCase();
  if (!wanted) return null;
  const parent = normalizeUuid(parentId);
  const self = normalizeUuid(ignoreId);
  return (Array.isArray(decks) ? decks : []).find((deck) => {
    if (!isPlainObject(deck)) return false;
    if (normalizeUuid(deck.id) === self) return false;
    if (normalizeUuid(deck.parentId) !== parent) return false;
    return String(deck.title || '').trim().toLowerCase() === wanted;
  }) || null;
}

/** Назва батька для повідомлення; для кореня — «Корінь». */
function parentTitleOf(parentId, decks) {
  if (!parentId) return 'Корінь';
  const parent = (Array.isArray(decks) ? decks : []).find(
    (deck) => isPlainObject(deck) && normalizeUuid(deck.id) === normalizeUuid(parentId));
  return parent ? (String(parent.title || '').trim() || 'Без назви') : 'Корінь';
}

/**
 * Назви з "::" у старих даних -> справжнє дерево.
 *
 * Повертає {decks, created, updated}.
 *   created — нові колоди-батьки; їх треба одразу зберегти, бо наступний
 *   виклик дав би їм інші uuid, а разом з ними й Anki-ідентифікатори.
 *   updated — наявні колоди, в яких розклали назву: теж треба зберегти.
 *   Без цього сервер лишився б з назвою "A::B::C" і null-батьком, а
 *   наступна синхронізація розкладала б її знову вже з іншими uuid
 *   батьків — тобто гілка щоразу розповзалася б на нові колоди.
 */
function materializeDeckPaths(decks) {
  const list = (Array.isArray(decks) ? decks : []).filter(isPlainObject);
  const out = [];
  const created = [];
  const updated = [];

  for (const deck of list) {
    const parts = splitDeckPath(deck.title);
    if (parts.length < 2) {
      out.push(deck);
      continue;
    }
    let parentId = normalizeUuid(deck.parentId);
    for (const title of parts.slice(0, -1)) {
      const existing = out.find((item) => normalizeUuid(item.parentId) === parentId
        && String(item.title || '').trim().toLowerCase() === title.toLowerCase());
      if (existing) {
        parentId = normalizeUuid(existing.id);
        continue;
      }
      const parent = {
        id: newUuid(),
        title,
        parentId,
        modelCss: '',
        templates: [],
        fieldNames: DEFAULT_FIELD_NAMES.slice(),
        cards: [],
        updatedAt: Number(deck.updatedAt) || Date.now()
      };
      out.push(parent);
      created.push(parent);
      parentId = parent.id;
    }
    const leaf = { ...deck, title: parts[parts.length - 1], parentId };
    out.push(leaf);
    updated.push(leaf);
  }

  return { decks: out, created, updated };
}

/**
 * Тіло запиту на /api/export-deck.
 *
 * Важливо: функція НЕ вигадує id. Вона лише переносить наявні,
 * нормалізуючи старий префікс. Якщо вона генерувала б uuid на
 * кожен виклик, то два експорти однієї колоди дали б різні Anki ID,
 * і кожен імпорт створював би дублікати.
 *
 * Тому ідентичність присвоює migrateDeck (раз, при завантаженні) і
 * зберігається разом із колодою. Перед експортом колода обов'язково
 * проходить migrateDeck — це гарантує, що id є.
 *
 * ancestors — ланцюг батьків від кореня. Сервер будує з нього вкладені
 * колоди Anki ("::"), причому з тими самими стабільними id, що й сама
 * колода: інакше Anki створював би нового батька щоразу після імпорту
 * і втрачав би місце у дереві.
 *
 * subtree — нащадки. Без них експорт батька («університет») давав
 * порожній .apkg: Anki бачив дерево, але «лекції 1» всередині не було.
 */
function buildExportPayload(deck, decks) {
  const names = deckFieldNames(deck);
  const cards = normalizeCards((deck && deck.cards) || [], names);
  const rootId = normalizeUuid(deck && deck.id);
  const styleId = (deck && deck.styleId) || '';
  const styleName = (deck && (deck.style_name || deck.styleName)) || '';

  return {
    deck_id: rootId,
    title: String((deck && deck.title) || 'Моя колода').trim() || 'Моя колода',
    ancestors: deckAncestors(deck, decks).map((item) => ({ id: item.id, title: item.title })),
    field_names: names,
    css: String((deck && deck.modelCss) || ''),
    templates: Array.isArray(deck && deck.templates) ? deck.templates : [],
    cards: cards.map((card) => ({ id: normalizeUuid(card.id), values: card.values })),
    style_id: styleId,
    style_name: styleName,
    // Корінь уже надіслано полями вище, тож subtree — це строго
    // нащадки. Так старий сервер (без поля subtree) лишається сумісним.
    subtree: buildSubtreeExportNodes(deck, decks).filter((node) => node.deck_id !== rootId)
  };
}

/**
 * Вузли піддерева колоди, від кореня вниз, глибшиною в першу чергу.
 *
 * Кожен вузол — самостійна модель для Anki, бо має власні поля,
 * шаблони й CSS. Тому вузол несе не лише картки, а й повний ланцюг
 * своїх батьків: сервер без нього не знав би, у яку гілку покласти
 * картки.
 *
 * Обхід списком дочірніх, а не пошуком у глибину: дерево вже безкінечне,
 * цикл у parentId не може навіть у принципі стати нескінченним.
 */
function buildSubtreeExportNodes(deck, decks) {
  // decks може не прийти: buildExportPayload(deck) викликається в тестах
  // і старими клієнтами без списку. Тоді піддерева немає — це не помилка.
  const list = Array.isArray(decks) ? decks : [];
  const self = isPlainObject(deck) ? deck : deckById(list, deck);
  if (!self) return [];

  const out = [];
  const seen = new Set();
  const childrenOf = new Map();
  for (const item of list) {
    const id = normalizeUuid(item && item.id);
    const parentId = normalizeUuid(item && item.parentId);
    if (!id || !parentId) continue;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(item);
  }

  const visit = (node) => {
    const id = normalizeUuid(node && node.id);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const names = deckFieldNames(node);
    const cards = normalizeCards((node && node.cards) || [], names);
    const styleId = (node && node.styleId) || '';
    const styleName = (node && (node.style_name || node.styleName)) || '';
    out.push({
      deck_id: id,
      title: String((node && node.title) || '').trim() || 'Моя колода',
      ancestors: deckAncestors(node, list).map((item) => ({ id: item.id, title: item.title })),
      field_names: names,
      css: String((node && node.modelCss) || ''),
      templates: Array.isArray(node && node.templates) ? node.templates : [],
      cards: cards.map((card) => ({ id: normalizeUuid(card.id), values: card.values })),
      style_id: styleId,
      style_name: styleName
    });

    for (const child of childrenOf.get(id) || []) visit(child);
  };

  visit(self);
  return out;
}

/**
 * Чи готова колода до експорту: у кожної картки є uuid.
 * Без цієї перевірки колода без id експортувалась би з позиційними
 * GUID, і редагування картки знову створювало б дублікат.
 */
function isExportIdentityReady(deck) {
  if (!deck) return false;
  if (!normalizeUuid(deck.id)) return false;
  const cards = normalizeCards(deck.cards || [], deckFieldNames(deck));
  return cards.every((card) => Boolean(normalizeUuid(card.id)));
}

/**
 * id усіх колод піддерева, без самої колоди.
 *
 * Нужен там, де треба пройти гілку, а не зібрати пакет: наприклад,
 * щоб вирішити, які колоди мігрувати перед експортом. Повертає Set,
 * бо один вузол у дереві може бути досяжним лише один раз, а Set
 * одночасно служить і результатом, і захистом від повторного входу.
 */
function collectSubtreeIds(deck, decks) {
  const out = new Set();
  for (const node of buildSubtreeExportNodes(deck, decks)) {
    const id = normalizeUuid(node.deck_id);
    if (id) out.add(id);
  }
  return out;
}

/**
 * Чи в усьому піддереві картки мають стабільні id.
 *
 * isExportIdentityReady дивиться на одну колоду. Для експорту цього
 * мало: запит несе нащадків, і картка без id у нащадку потрапила б у
 * .apkg з тимчасовим GUID — наступний експорт дав би інший, і Anki
 * створював би дублікати замість оновлення.
 */
function isSubtreeExportIdentityReady(deck, decks) {
  const list = Array.isArray(decks) ? decks : [];
  const byId = new Map();
  for (const item of list) {
    const id = normalizeUuid(item && item.id);
    if (id) byId.set(id, item);
  }
  for (const id of collectSubtreeIds(deck, list)) {
    const item = byId.get(id);
    if (item && !isExportIdentityReady(item)) return false;
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_FIELD_NAMES,
    DECK_PATH_SEPARATOR,
    UUID_RE,
    newUuid,
    normalizeUuid,
    ensureUuid,
    resolveFieldNames,
    sanitizeFieldNames,
    sanitizeDeckStyles,
    migrateCard,
    normalizeCards,
    isFieldEmpty,
    normalizeMathDelimiters,
    cardEntries,
    deckFieldNames,
    canMergeCards,
    isExportIdentityReady,
    buildExportPayload,
    buildSubtreeExportNodes,
    collectSubtreeIds,
    isSubtreeExportIdentityReady,
    splitDeckPath,
    deckById,
    deckAncestors,
    deckPathString,
    isDescendantDeck,
    canMoveDeck,
    buildDeckTree,
    flattenDeckTree,
    deckParentOptions,
    duplicateSiblingTitle,
    parentTitleOf,
    materializeDeckPaths
  };
}
