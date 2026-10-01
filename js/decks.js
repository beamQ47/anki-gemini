const defaultDecks = [
  {
    id: 'history-ukraine',
    title: 'Історія України',
    modelCss: '.card {\n  font-family: system-ui, sans-serif;\n  font-size: 20px;\n  text-align: center;\n  color: #243044;\n}\n\n#extra {\n  font-size: 15px;\n  color: #64748b;\n}',
    cards: [
      { id: 'history-1', front: 'Коли проголосила незалежність Українська Народна Республіка?', back: '14 грудня 1917 року', extra: 'Це дата входження УНР у фазу формування державності.', createdAt: Date.now() - 86400000 },
      { id: 'history-2', front: 'Яка конституція діяла в УНР у 1918 році?', back: 'Конституція Української Народної Республіки, ухвалена 29 квітня 1918 року Священним Собором Української Православної Церкви.', extra: 'Її часто називають Конституцією Собору Святих.', createdAt: Date.now() - 72000000 },
      { id: 'history-3', front: 'Хто був першим секретарем Центральної Ради?', back: 'Михайло Грушевський', extra: 'Він також очолював першу демократичну Уряд у складі Центральної Ради.', createdAt: Date.now() - 3600000 }
    ],
    updatedAt: Date.now() - 3600000
  },
  {
    id: 'cpp-basic',
    title: 'C++ Basic',
    modelCss: '.card {\n  font-family: ui-monospace, monospace;\n  font-size: 18px;\n  text-align: left;\n  color: #1e293b;\n}\n\n#back {\n  color: #2563eb;\n}',
    cards: [
      { id: 'cpp-1', front: 'Що робить оператор new?', back: 'Виділяє пам’ять для об’єкта та повертає покажчик на цю пам’ять.', extra: 'Після використання пам’ять потрібно звільнити оператором delete.', createdAt: Date.now() - 18000000 },
      { id: 'cpp-2', front: 'Яка різниця між vector та array?', back: 'vector має динамічний розмір і зручні методи, а array має фіксований розмір, відомий під час компіляції.', extra: 'Після створення розмір array змінити не можна.', createdAt: Date.now() - 9000000 },
      { id: 'cpp-3', front: 'Що повертає оператор sizeof?', back: 'Розмір об’єкта або виразу у байтах як std::size_t.', extra: 'Результат sizeof(char) зазвичай дорівнює 1.', createdAt: Date.now() - 3600000 }
    ],
    updatedAt: Date.now() - 3600000
  },
  {
    id: 'osi-model',
    title: 'OSI Model',
    modelCss: '.card {\n  font-family: system-ui, sans-serif;\n  font-size: 20px;\n  text-align: center;\n  color: #172554;\n}\n\n#extra {\n  font-size: 14px;\n}',
    cards: [
      { id: 'osi-1', front: 'Скільки рівнів містить OSI?', back: 'Сім рівнів: прикладний, представлення, сесійний, транспортний, мережевий, канальний і фізичний.', extra: 'OSI — референсна модель міжнародного стандарту ISO 7498.', createdAt: Date.now() - 5400000 },
      { id: 'osi-2', front: 'Який рівень відповідає за маршрутизацію IP-пакетів?', back: 'Мережевий рівень, третій рівень OSI.', extra: 'На ньому працюють протоколи IP, ICMP та маршрутизатори.', createdAt: Date.now() - 1800000 },
      { id: 'osi-3', front: 'Що забезпечує транспортний рівень?', back: 'Надійну або ненадійну доставку даних між процесами, порти та multiplexing.', extra: 'Приклади протоколів: TCP та UDP.', createdAt: Date.now() - 600000 }
    ],
    updatedAt: Date.now() - 600000
  }
];

/** Будь-яка колода -> новий формат: fieldNames + cards[].values */
function migrateDeck(deck) {
  const source = deck && typeof deck === 'object' ? deck : {};
  const names = resolveFieldNames(source.cards, source.fieldNames);
  // id береться з вирівняної картки, а не з source.cards[index]:
  // normalizeCards відкидає порожні картки, тож індекси розходяться.
  const cards = normalizeCards(source.cards, names).map((card) => ({
    id: ensureUuid(card.id),
    values: card.values,
    createdAt: card.createdAt
  }));
  const css = typeof source.modelCss === 'string'
    ? source.modelCss
    : (typeof source.css === 'string' ? source.css : '');
  // Активний стиль — джерело істини для CSS: якщо бібліотека є, modelCss
  // береться з неї. Інакше після перезавантаження екран показував би
  // збережений у колоді CSS, а «Зберегти стиль» перезаписав би його
  // правилом зі стилю, який користувач бачив.
  const styles = sanitizeDeckStyles(source.styles, css);
  const active = styles.items.find(item => item.id === styles.activeId);
  return {
    id: ensureUuid(source.id),
    parentId: normalizeUuid(source.parentId),
    title: typeof source.title === 'string' ? source.title : 'Без назви',
    modelCss: active ? active.css : css,
    styles,
    templates: Array.isArray(source.templates) ? source.templates : [],
    fieldNames: names,
    cards,
    updatedAt: Number(source.updatedAt) || Date.now()
  };
}

function cloneDefaults() {
  return defaultDecks.map(migrateDeck);
}

function isValidDeck(deck) {
  return deck && typeof deck === 'object' && typeof deck.id === 'string' && typeof deck.title === 'string' && Array.isArray(deck.cards);
}

// --- КЕШ, ПРИВ'ЯЗАНИЙ ДО АКАУНТА ---
//
// Ключ localStorage має містити user id. Інакше два акаунти в одному
// браузері ділять кеш: користувач B бачив би колоди користувача A, а
// якщо в акаунті B сервер порожній — syncDecksFromServer() відправив би
// чужі колоди в чужий акаунт.

function currentUserId() {
  try {
    const auth = window.AnkiAuth;
    const session = auth && typeof auth.getSession === 'function' ? auth.getSession() : null;
    const id = session && session.userId;
    return typeof id === 'string' && id ? id : null;
  } catch (error) {
    return null;
  }
}

function deckStorageKey() {
  const userId = currentUserId();
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

// --- ЧАТИ ---
//
// Раніше існував один чат на весь акаунт: уся переписка лежала в
// appState.messages. Тому мігінни з матеріалом фізики потрапляли в ту ж
// стрічку, що й запитання з математики, а модель у контексті бачила обидві
// теми. Тепер chats — список діалогів, повідомлення живуть усередині
// кожного, і на сервер іде лише історія активного.
//
// Ключ той самий, що був в одного чату, щоб старий формат можна було
// прочитати без втрати переписки: див. loadChatsLocally.

// Рендер стрічки й списку чатів живе в chat.js. Сполучною точкою є ця
// функція, щоб decks.js не залежав від того, які файли вже підключені:
// частина тестів вантажить тільки сховище.
function renderChatState() {
  if (typeof renderMessages === 'function') renderMessages(true);
  if (typeof renderChatList === 'function') renderChatList();
  if (typeof renderActiveChatTitle === 'function') renderActiveChatTitle();
}


function messagesStorageKey() {
  const userId = currentUserId();
  return userId ? `${MESSAGES_KEY}:${userId}` : MESSAGES_KEY;
}

const MAX_CHATS = 60;

// loading — тимчасовий стан, його відновлювати не треба: на екрані
// з'явиться «думає» без відповіді, яка вже ніколи не прийде.
function isStorableMessage(message) {
  return message && typeof message === 'object' && message.type !== 'loading';
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(isStorableMessage).map((message) => ({
    ...message,
    id: message.id || createId()
  }));
}

function normalizeChat(raw, fallbackMessages) {
  const source = raw && Array.isArray(raw.messages) ? raw.messages : fallbackMessages;
  const messages = normalizeMessages(source);
  let title = raw && typeof raw.title === 'string' ? raw.title : '';
  if (!title) {
    const first = messages.find((message) => message.role === 'user');
    if (first) title = chatTitleFrom(first.content);
  }
  return {
    id: raw && typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    title,
    messages,
    createdAt: raw && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: raw && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
  };
}

function findChat(id) {
  return appState.chats.find((chat) => chat.id === id) || null;
}

function activeChat() {
  return findChat(appState.activeChatId) || appState.chats[0] || null;
}

// Назва за першим запитом: щоб у списку було видно, про що чат, ще до того,
// як його відкриють.
function chatTitleFrom(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

// appState.messages — джерело істини для стрічки активного чату. Функція
// переносить його в messages самого чату перед записом. Саме тому напрямок
// один: chat.messages = appState.messages. Якби було навпаки, то будь-яке
// присвоєння appState.messages (наприклад, скидання стрічки) губилося б, і
// в чат записалася б стара переписка.
function syncActiveChatMessages() {
  const chat = activeChat();
  if (!chat) return null;
  chat.messages = appState.messages;
  chat.updatedAt = Date.now();
  if (!chat.title) {
    const first = appState.messages.find((message) => message.role === 'user');
    if (first) chat.title = chatTitleFrom(first.content);
  }
  return chat;
}

function createChat(options = {}) {
  const chat = {
    id: createId(),
    title: typeof options.title === 'string' ? options.title : '',
    messages: Array.isArray(options.messages) ? normalizeMessages(options.messages) : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  appState.chats.unshift(chat);
  // Обрізання: без нього сховище росте безмежно, а квота localStorage
  // скінчиться — і тоді зникне все відразу, разом з картками.
  if (appState.chats.length > MAX_CHATS) {
    appState.chats.length = MAX_CHATS;
  }
  switchChat(chat.id, { silent: true });
  saveChatsLocally();
  return chat;
}

function switchChat(id, options = {}) {
  const chat = findChat(id);
  if (!chat) return false;
  appState.activeChatId = chat.id;
  appState.messages = chat.messages;
  if (!options.silent) {
    renderChatState();
    saveChatsLocally();
  }
  return true;
}

function deleteChat(id) {
  const index = appState.chats.findIndex((chat) => chat.id === id);
  if (index < 0) return false;
  appState.chats.splice(index, 1);
  if (!appState.chats.length) {
    // Останній чат не зникає: порожня стрічка без жодного способу почати
    // розмову — глухий кут в інтерфейсі.
    const chat = { id: createId(), title: '', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    appState.chats.push(chat);
    appState.activeChatId = chat.id;
  } else if (appState.activeChatId === id) {
    appState.activeChatId = appState.chats[Math.min(index, appState.chats.length - 1)].id;
  }
  appState.messages = activeChat().messages;
  saveChatsLocally();
  return true;
}

function renameChat(id, title) {
  const chat = findChat(id);
  if (!chat) return false;
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return false;
  chat.title = clean;
  saveChatsLocally();
  return true;
}

// Читає список чатів. Старий формат — масив повідомлень без id чату: він
// загортається в один чат, інакше вся накопичена переписка зникла б під час
// першого ж запуску нової версії.
function loadChatsLocally(fallbackMessages) {
  let parsed = null;
  try {
    const saved = localStorage.getItem(messagesStorageKey());
    parsed = saved ? JSON.parse(saved) : null;
  } catch (error) {
    parsed = null;
  }
  const welcome = normalizeMessages(fallbackMessages);
  let chats = [];
  let activeId = null;
  if (parsed && Array.isArray(parsed.chats)) {
    chats = parsed.chats
      .filter((chat) => chat && typeof chat === 'object')
      .map((chat) => normalizeChat(chat, []));
    activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
  } else if (Array.isArray(parsed) && parsed.length) {
    chats = [normalizeChat({ messages: parsed }, [])];
  }
  if (!chats.length) {
    chats = [{ id: createId(), title: '', messages: welcome, createdAt: Date.now(), updatedAt: Date.now() }];
  }
  if (!activeId || !chats.some((chat) => chat.id === activeId)) {
    activeId = chats[0].id;
  }
  appState.chats = chats;
  appState.activeChatId = activeId;
  appState.messages = chats.find((chat) => chat.id === activeId).messages;
  return chats;
}

function saveChatsLocally() {
  try {
    syncActiveChatMessages();
    localStorage.setItem(messagesStorageKey(), JSON.stringify({
      activeId: appState.activeChatId,
      chats: appState.chats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        messages: chat.messages.filter(isStorableMessage),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }))
    }));
    return true;
  } catch (error) {
    // Мовчання: чат не критичний, і не варто лякати користувача помилкою
    // через те, що localStorage переповнений. Колоди в такому разі теж не
    // збережуться, але про це скаже setStorageStatus.
    return false;
  }
}

// Назви цих функцій збережені: submitChat звертається до них після кожної
// зміни стрічки, і перейменовувати всі виклики не потрібно.
function saveMessagesLocally() {
  return saveChatsLocally();
}

// Сумісність зі старим API: раніше функція повертала масив повідомлень
// єдиного чату. Тепер вона повертає повідомлення активного, за потреби
// піднявши chats зі сховища. Сам застосунок користується loadChatsLocally().
function loadMessages(fallback) {
  if (!Array.isArray(appState.chats) || !appState.chats.length) {
    loadChatsLocally(fallback);
  }
  return appState.messages;
}

function clearMessagesLocally() {
  try {
    // Очищаємо лише активний чат. Ключ не видаляємо: інакше на
    // перезавантаженні зникли б і всі інші чати користувача.
    const chat = activeChat();
    if (chat) {
      chat.messages = [];
      appState.messages = chat.messages;
      chat.updatedAt = Date.now();
      saveChatsLocally();
    }
    return true;
  } catch (error) {
    // не критично
  }
}

// Перший вхід на цьому браузері забирає роботу, зроблену офлайн ще до
// входу (див. коментар вище про syncDecksFromServer). Ключ без user id
// привласнюється першому акаунту й видаляється, щоб наступний користувач
// його не вкрав.
function adoptOrphanCache() {
  if (!currentUserId()) return false;
  try {
    const scoped = deckStorageKey();
    if (localStorage.getItem(scoped)) return false;
    const orphan = localStorage.getItem(STORAGE_KEY);
    if (!orphan) return false;
    const parsed = JSON.parse(orphan);
    if (!Array.isArray(parsed) || !parsed.length) return false;
    localStorage.setItem(scoped, orphan);
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

// Викликається одразу після входу, ДО синхронізації: інакше в пам'яті
// ще лежали б колоди попереднього акаунта і могли б зберегтися в новий.
function switchToCurrentUserCache() {
  adoptOrphanCache();
  appState.decks = loadDecks();
  if (!appState.decks.some((deck) => deck.id === appState.activeDeckId)) {
    appState.activeDeckId = appState.decks[0]?.id || null;
  }
  // Разом із колодами перемикаємо й чати: інакше в акаунті B видно було б
  // переписку з акаунтом A, а її вміст пішов би в гісторію запитів.
  loadChatsLocally(appState.messages);
  renderChatState();
  if (pendingPathMaterialization) {
    pendingPathMaterialization = false;
    saveDecksLocally();
  }
  return appState.decks;
}

/**
 * Назви з "::" розкладено у справжнє дерево, але ще не збережено.
 * Прапорець, а не пряма запись: на момент читання кешу appState ще
 * порожній, тож saveDecksLocally() нічого корисного не записав би.
 */
let pendingPathMaterialization = false;

function loadDecks() {
  try {
    const saved = localStorage.getItem(deckStorageKey());
    const source = saved ? JSON.parse(saved) : null;
    if (!Array.isArray(source) || source.length === 0) return cloneDefaults();
    const validDecks = source.filter(isValidDeck).map(migrateDeck);
    if (!validDecks.length) return cloneDefaults();
    // Назви з "::" — спадок старої версії, де ієрархії не було. Розкладаємо
    // їх у справжнє дерево, інакше в Anki пішла б колода з "::" у назві.
    const { decks, created, updated } = materializeDeckPaths(validDecks);
    // Важливо врахувати й updated: коли батьки вже є (другий вхід у
    // браузері після того, як гілку вже синхронізували), created порожній,
    // але розкладена назва листка все одно треба віддати серверу.
    pendingPathMaterialization = created.length > 0 || updated.length > 0;
    return decks;
  } catch (error) {
    return cloneDefaults();
  }
}

function saveDecksLocally() {
  try {
    localStorage.setItem(deckStorageKey(), JSON.stringify(appState.decks));
    setStorageStatus('Дані збережено локально', 'success');
    return true;
  } catch (error) {
    setStorageStatus('Не вдалося зберегти локально', 'error');
    showToast('Недостатньо місця для локального збереження', 'error');
    return false;
  }
}

function setStorageStatus(text, type) {
  elements.storageStatusText.textContent = text;
  elements.storageStatusDot.className = `h-2 w-2 rounded-full ${type === 'error' ? 'bg-red-500' : type === 'remote' ? 'bg-violet-500' : 'bg-emerald-500'}`;
}

// --- СИНХРОНІЗАЦІЯ З СЕРВЕРОМ ---
//
// Джерело істини — сервер, localStorage лише кеш на випадок, коли
// мережа недоступна. Порядок навмисно такий: спочатку читаємо
// сервер, і тільки якщо він порожній — залишаємо локальні дані.
// Інакше перший запуск після входу видалив би всі колоди, які
// користувач напрацював офлайн.

function deckToServerPayload(deck) {
  return {
    id: deck.id,
    parent_id: deck.parentId || null,
    title: deck.title,
    field_names: deck.fieldNames,
    css: deck.modelCss || '',
    templates: deck.templates || [],
    styles: deck.styles || { activeId: '', items: [] }
  };
}

function cardsToServerPayload(deck) {
  return {
    cards: deck.cards.map((card) => ({ id: card.id, values: card.values || {} }))
  };
}

/**
 * Надсилає ланцюг батьків від кореня вниз.
 *
 * Порядок важливий: інакше на сервері колода з'явилася б раніше за
 * свого батька, і та залишилася б у корені назавжди — колода без
 * батьків, яку вже нікуди не перенести.
 */
async function pushDeckChain(decks) {
  const ordered = flattenDeckTree(decks, new Set()).map((row) => row.deck);
  for (const deck of ordered) {
    await pushDeckToServer(deck);
  }
}

async function pushDeckToServer(deck) {
  // POST, а не PUT /api/decks/{id}: для нової колоди рядка на сервері ще
  // немає, тож PUT відповідав би 404 і колода назавжди залишилася б лише
  // в localStorage. POST /api/decks — це upsert (on conflict do update),
  // тож він працює і для нової, і для наявної колоди.
  await apiRequestJson('/api/decks', {
    method: 'POST',
    body: JSON.stringify(deckToServerPayload(deck))
  });
  // Порожня колода теж має доїхати до сервера: інакше видалені
  // локально картки воскресли б при наступному завантаженні.
  await apiRequestJson(`/api/decks/${deck.id}/cards`, {
    method: 'PUT',
    body: JSON.stringify(cardsToServerPayload(deck))
  });
}

async function syncDecksFromServer() {
  const data = await apiRequestJson('/api/decks');
  const remote = (data && data.decks) || [];

  if (remote.length) {
    const migrated = remote.map(migrateDeck);
    // Назви з "::" могли лишитися на сервері ще з часів, коли ієрархії
    // не було. Розкладаємо їх у дерево й відправляємо назад і нових
    // батьків, і самі розкладені листки: без другого сервер лишився б
    // з "A::B::C" і без батька, тож наступна синхронізація створила б
    // ще одну копію гілки з новими uuid.
    const { decks, created, updated } = materializeDeckPaths(migrated);
    appState.decks = decks;
    if (created.length || updated.length) {
      try {
        // Спершу батьки від кореня: листок іде після свого батька, бо
        // create_deck відкидає неіснуючого parent_id, поклавши б його в корінь.
        for (const parent of [...created, ...updated]) await pushDeckToServer(parent);
      } catch (error) {
        showToast(error?.message || 'Не вдалося зберегти ієрархію на сервері', 'error');
        setStorageStatus('Не вдалося зберегти ієрархію на сервері', 'error');
      }
    }
  } else {
    // Сервер порожній. Якщо локально щось є — це не втрата, а
    // перший запуск після входу: відправляємо на сервер.
    const local = appState.decks.filter(isValidDeck).map(migrateDeck);
    const { decks } = materializeDeckPaths(local);
    appState.decks = decks;
    try {
      await pushDeckChain(decks);
    } catch (error) {
      setStorageStatus('Не вдалося зберегти на сервері', 'error');
    }
  }

  if (!appState.decks.some((deck) => deck.id === appState.activeDeckId)) {
    appState.activeDeckId = appState.decks[0]?.id || null;
  }
  saveDecksLocally();
  setStorageStatus('Синхронізовано з акаунтом', 'remote');
  renderDecks();
  renderMessages();
  return appState.decks;
}

function getTotalCards() {
  return appState.decks.reduce((sum, deck) => sum + deck.cards.length, 0);
}

function pluralizeCards(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'картка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'картки';
  return 'карток';
}

function pluralizeDecks(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'колода';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'колоди';
  return 'колод';
}

/** Кількість колод у гілці разом із самою — для підписів у розгорнутому вигляді. */
function countSubtreeDecks(deckId, decks) {
  let total = 0;
  for (const deck of decks) {
    if (normalizeUuid(deck.id) === normalizeUuid(deckId)) continue;
    if (isDescendantDeck(deck.id, deckId, decks)) total += 1;
  }
  return total;
}

/**
 * Рядок дерева: відступ, розкривачка, підпис шляху, вибір батька.
 *
 * Відступ існує inline-стилем, а не класом, бо глибина невідома на
 * етапі розмітки. Вертикальна лінія підказує, що рядок усередині
 * гілки, а не окрема колода.
 */
function renderDeckRow(row) {
  const deck = row.deck;
  const active = deck.id === appState.activeDeckId;
  const initial = deck.title.trim().charAt(0).toUpperCase() || 'A';
  const indent = row.depth * 16;
  const ancestors = deckAncestors(deck, appState.decks);
  const subtree = countSubtreeDecks(deck.id, appState.decks);
  const toggle = row.hasChildren
    ? `<button class="deck-toggle flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-app-hint transition hover:bg-app-link/10" type="button" data-action="toggle-deck-node" data-deck-id="${escapeHtml(deck.id)}" aria-expanded="${row.expanded}" aria-label="${row.expanded ? 'Згорнути' : 'Розгорнути'} ${escapeHtml(deck.title)}">
        <i data-lucide="${row.expanded ? 'chevron-down' : 'chevron-right'}" class="h-4 w-4" aria-hidden="true"></i>
      </button>`
    : '<span class="deck-toggle h-5 w-5 shrink-0" aria-hidden="true"></span>';

  const parentSelect = deckParentOptions(appState.decks, deck.id).map(option => {
    const selected = (deck.parentId || '') === (option.id || '');
    return `<option value="${escapeHtml(option.id || '')}" ${selected ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${'— '.repeat(option.depth)}${escapeHtml(option.title)}</option>`;
  }).join('');

  return `
      <article class="deck-option rounded-2xl border ${active ? 'is-selected' : ''} border-app-hint/10 p-3.5" data-deck-id="${escapeHtml(deck.id)}" style="margin-left:${indent}px">
        <div class="flex items-start gap-2">
          ${toggle}
          <button class="flex min-w-0 flex-1 items-start gap-3 text-left" type="button" data-action="select-deck" data-deck-id="${escapeHtml(deck.id)}" aria-label="Обрати колоду ${escapeHtml(deck.title)}">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-app-button text-app-button-text' : 'bg-app-link/10 text-app-button'} text-sm font-extrabold">${escapeHtml(initial)}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-extrabold">${escapeHtml(deck.title)}</span>
              ${ancestors.length
                ? `<span class="mt-0.5 block truncate text-[10px] font-medium text-app-hint">${escapeHtml(ancestors.map(item => item.title).join(' / '))}</span>`
                : ''}
              <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-app-hint">
                <i data-lucide="layers-2" class="h-3 w-3" aria-hidden="true"></i>
                ${deck.cards.length} ${pluralizeCards(deck.cards.length)} · ${formatRelativeDate(deck.updatedAt)}
                ${row.hasChildren ? `<span class="rounded-full bg-app-link/10 px-1.5 py-0.5 text-[10px] text-app-button">+${subtree} ${pluralizeDecks(subtree)}</span>` : ''}
              </span>
            </span>
            <i data-lucide="check-circle-2" class="h-4 w-4 shrink-0 ${active ? 'text-app-button' : 'hidden'}" aria-hidden="true"></i>
          </button>
        </div>
        <div class="mt-3 space-y-1.5 border-t border-app-hint/10 pt-2.5">
          <button class="action-button flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold text-app-hint transition hover:bg-emerald-500/8 hover:text-emerald-500" type="button" data-action="preview-deck" data-deck-id="${escapeHtml(deck.id)}" title="Переглянути картки як в Anki">
            <i data-lucide="eye" class="h-3.5 w-3.5" aria-hidden="true"></i>
            Переглянути
          </button>
          <div class="grid grid-cols-3 gap-1.5">
            <button class="action-button flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold text-app-hint transition hover:bg-app-link/8 hover:text-app-button" type="button" data-action="edit-deck" data-deck-id="${escapeHtml(deck.id)}" title="Редагувати картки">
              <i data-lucide="pencil" class="h-3.5 w-3.5" aria-hidden="true"></i>
              Редагувати
            </button>
            <button class="action-button flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold text-app-hint transition hover:bg-violet-500/10 hover:text-violet-400" type="button" data-action="download-deck" data-deck-id="${escapeHtml(deck.id)}" title="Завантажити .apkg">
              <i data-lucide="download" class="h-3.5 w-3.5" aria-hidden="true"></i>
              .apkg
            </button>
            <button class="action-button flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold text-app-hint transition hover:bg-red-500/8 hover:text-red-500" type="button" data-action="delete-deck" data-deck-id="${escapeHtml(deck.id)}" title="Видалити колоду">
              <i data-lucide="trash-2" class="h-3.5 w-3.5" aria-hidden="true"></i>
              Видалити
            </button>
          </div>
          <div class="flex items-center gap-1.5">
            <label class="min-w-0 flex-1">
              <span class="sr-only">Вкласти в колоду</span>
              <select class="deck-parent-select w-full appearance-none rounded-lg border muted-surface border-app-hint/10 bg-app-bg px-2 py-1.5 text-[10px] font-bold text-app-hint" data-deck-id="${escapeHtml(deck.id)}">
                ${parentSelect}
              </select>
            </label>
            <button class="action-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-app-hint transition hover:bg-emerald-500/8 hover:text-emerald-500" type="button" data-action="new-subdeck" data-deck-id="${escapeHtml(deck.id)}" title="Створити підколоду" aria-label="Створити підколоду в «${escapeHtml(deck.title)}»">
              <i data-lucide="folder-plus" class="h-3.5 w-3.5" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </article>
    `;
}

function renderDecks() {
  elements.deckList.innerHTML = flattenDeckTree(appState.decks, appState.collapsedDeckIds)
    .map(renderDeckRow).join('');

  const totalCards = getTotalCards();
  elements.deckSummary.textContent = `${totalCards} ${pluralizeCards(totalCards)} у ${appState.decks.length} ${pluralizeDecks(appState.decks.length)}`;
  elements.emptyDecksState.classList.toggle('hidden', appState.decks.length > 0);
  refreshIcons(elements.deckList);
  // Список стилів для генерації будується з тих самих колод, тож він
  // зобов'язаний оновлюватися разом із деревом: інакше в ньому лишалися б
  // стилі колоди, яку вже перейменували чи видалили.
  renderGenerationStyleList();
}

function toggleDeckNode(deckId) {
  if (appState.collapsedDeckIds.has(deckId)) appState.collapsedDeckIds.delete(deckId);
  else appState.collapsedDeckIds.add(deckId);
  renderDecks();
}

/**
 * Перенос колоди в іншу гілку.
 *
 * Перевірка canMoveDeck — не дублювання серверної, а тактильність:
 * без неї select просто нічого не зробив би й користувач не зрозумів
 * би, чому дерево не змінилося.
 */
async function moveDeckToParent(deckId, parentId) {
  const deck = appState.decks.find(item => item.id === deckId);
  if (!deck) return;
  if ((deck.parentId || '') === (parentId || '')) return;
  if (!canMoveDeck(deckId, parentId, appState.decks)) {
    showToast('Не можна вкласти колоду в саму себе', 'warning');
    renderDecks();
    return;
  }

  const previous = deck.parentId || null;
  deck.parentId = parentId || null;
  deck.updatedAt = Date.now();
  saveDecksLocally();
  renderDecks();

  try {
    await apiRequestJson(`/api/decks/${deckId}/parent`, {
      method: 'PATCH',
      body: JSON.stringify({ parent_id: deck.parentId })
    });
    setStorageStatus('Синхронізовано з акаунтом', 'remote');
  } catch (error) {
    deck.parentId = previous;
    saveDecksLocally();
    renderDecks();
    // Текст сервера важливий: 409 «назва вже зайнята» і 409 «цикл» —
    // два різні кроки виправлення, обидва без пояснення виглядали б однаково.
    showToast(error?.message || 'Не вдалося перенести колоду', 'error');
    setStorageStatus('Не вдалося перенести колоду', 'error');
  }
}

function showDeckList() {
  appState.editorDeckId = null;
  appState.editorCardId = null;
  elements.editorPanel.classList.add('hidden');
  elements.deckListPanel.classList.remove('hidden');
  renderDecks();
}

function openEditor(deckId) {
  const deck = appState.decks.find(item => item.id === deckId);
  if (!deck) return;
  appState.activeDeckId = deck.id;
  appState.editorDeckId = deck.id;
  appState.editorCardId = deck.cards[0]?.id || null;
  elements.deckListPanel.classList.add('hidden');
  elements.editorPanel.classList.remove('hidden');
  renderEditor();
  renderDecks();
  if (!desktopQuery.matches) openDrawer();
}

/** Короткий підпис картки для списку: перше непорожнє поле. */
function cardLabel(card, fieldNames) {
  const values = card && card.values ? card.values : {};
  for (const [name, value] of cardEntries(card, fieldNames)) {
    if (value) return value.slice(0, 38);
  }
  const first = Object.values(values).find(text => String(text || '').trim());
  return first ? String(first).slice(0, 38) : 'Без назви';
}

const FIELD_ICONS = ['circle-dot', 'circle-check', 'notebook-tabs', 'book-open', 'link-2', 'lightbulb'];
const FIELD_ICON_COLORS = ['text-app-button', 'text-emerald-500', 'text-violet-500', 'text-teal-400', 'text-amber-500', 'text-rose-500'];

/** Поля редактора будуються з fieldNames, тому їх number не зафіксовано. */
function renderFieldInputs(names, values, disabled) {
  return names.map((name, index) => `
    <label class="block">
      <span class="mb-1.5 flex items-center gap-2 text-xs font-bold">
        <i data-lucide="${FIELD_ICONS[index % FIELD_ICONS.length]}" class="h-3.5 w-3.5 ${FIELD_ICON_COLORS[index % FIELD_ICON_COLORS.length]}" aria-hidden="true"></i>
        ${escapeHtml(name)}${index === 0 ? ' · запитання' : ''}
      </span>
      <textarea class="field-control ${index === 0 ? 'min-h-24' : 'min-h-20'} ${disabled ? 'opacity-50' : ''}" placeholder="Введіть ${escapeHtml(name.toLowerCase())}" ${disabled ? 'disabled' : ''} data-field-name="${escapeHtml(name)}">${escapeHtml(values[name] || '')}</textarea>
    </label>
  `).join('');
}

/**
 * Активний стиль колоди або null, якщо бібліотека порожня.
 *
 * CSS для .apkg, прев'ю й редактора береться саме з нього: одне
 * джерело істини, тому «стиль у списку» та «стиль, який бачить
 * користувач» не можуть розійтися.
 */
function activeDeckStyle(deck) {
  const styles = deck && deck.styles ? deck.styles : { activeId: '', items: [] };
  const items = Array.isArray(styles.items) ? styles.items : [];
  return items.find(item => item.id === styles.activeId) || null;
}

function deckStyleName(deck) {
  const style = activeDeckStyle(deck);
  return style ? style.name : 'Стиль не вибрано';
}

/** Застосувати стиль до колоди: CSS і бібліотека йдуть у паузі. */
function setActiveDeckStyle(deck, styleId) {
  const styles = deck && deck.styles ? deck.styles : { activeId: '', items: [] };
  const items = Array.isArray(styles.items) ? styles.items : [];
  const style = items.find(item => item.id === styleId);
  if (!style) return false;
  deck.styles = { ...styles, activeId: style.id };
  deck.modelCss = style.css;
  return true;
}

/**
 * Розкриває панель стилю колоди.
 *
 * classList.toggle повертає новий стан, тобто після перемикання true —
 * панель схована. Тому «відкрита» = стан, коли 'hidden' уже знято.
 */
function toggleDeckStylePanel() {
  const isOpen = elements.deckStylePanel.classList.toggle('hidden') === false;
  elements.deckStyleToggle.setAttribute('aria-expanded', String(isOpen));
  elements.deckStyleChevron.classList.toggle('rotate-180', isOpen);
}

function renderEditor() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) {
    showDeckList();
    return;
  }
  const fieldNames = deckFieldNames(deck);
  elements.editorDeckTitle.textContent = deck.title;
  const breadcrumb = deckAncestors(deck, appState.decks).map(item => item.title);
  elements.editorDeckPath.textContent = breadcrumb.join(' / ');
  elements.editorDeckPath.classList.toggle('hidden', breadcrumb.length === 0);
  // Не перезаписуємо textarea, поки в ній пишуть: renderEditor() викликається
  // і на перемиканні карток, тож незбережений CSS зник би без будь-якого
  // повідомлення. Значення оновлюємо для іншої колоди, після явного
  // збереження і коли сервер присив колоду — тобто лише тоді, коли в
  // textarea немає незбережених правок.
  const cssValue = deck.modelCss || '';
  const sameDeck = elements.editorModelCss.dataset.deckId === deck.id;
  if (!sameDeck || (!isDeckStyleDirty() && elements.editorModelCss.value !== cssValue)) {
    elements.editorModelCss.value = cssValue;
    elements.editorModelCss.dataset.deckId = deck.id;
    setDeckStyleSaved();
  }
  elements.editorStyleName.textContent = deckStyleName(deck);
  refreshIcons(elements.editorFields);

  if (!deck.cards.length) {
    appState.editorCardId = null;
    elements.editorCardSelect.innerHTML = '<option value="">Немає карток</option>';
    elements.editorCardPosition.textContent = 'Карток 0 з 0';
    elements.editorFields.innerHTML = renderFieldInputs(fieldNames, {}, true);
    elements.previousCardButton.disabled = true;
    elements.nextCardButton.disabled = true;
    elements.deleteCardButton.disabled = true;
    elements.saveCardButton.disabled = true;
    elements.clearDeckButton.disabled = true;
    return;
  }

  let cardIndex = deck.cards.findIndex(card => card.id === appState.editorCardId);
  if (cardIndex < 0) cardIndex = 0;
  const card = deck.cards[cardIndex];
  appState.editorCardId = card.id;
  elements.editorCardSelect.innerHTML = deck.cards.map((item, index) => `<option value="${escapeHtml(item.id)}" ${item.id === card.id ? 'selected' : ''}>Картка ${index + 1} · ${escapeHtml(cardLabel(item, fieldNames))}</option>`).join('');
  elements.editorCardPosition.textContent = `Картка ${cardIndex + 1} з ${deck.cards.length}`;
  elements.editorFields.innerHTML = renderFieldInputs(fieldNames, card.values, false);
  elements.previousCardButton.disabled = cardIndex === 0;
  elements.nextCardButton.disabled = cardIndex === deck.cards.length - 1;
  elements.deleteCardButton.disabled = false;
  elements.saveCardButton.disabled = false;
  elements.clearDeckButton.disabled = false;
}

function navigateEditorCard(direction) {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  const currentIndex = deck.cards.findIndex(card => card.id === appState.editorCardId);
  const nextIndex = Math.max(0, Math.min(deck.cards.length - 1, currentIndex + direction));
  if (deck.cards[nextIndex]) {
    appState.editorCardId = deck.cards[nextIndex].id;
    renderEditor();
  }
}

/** Значення полів редактора -> {ім'я: значення} саме в порядку полів. */
function readFieldInputs() {
  const values = {};
  elements.editorFields.querySelectorAll('[data-field-name]').forEach(node => {
    values[node.dataset.fieldName] = node.value.trim();
  });
  return values;
}

async function saveEditorCard() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  const card = deck?.cards.find(item => item.id === appState.editorCardId);
  if (!deck || !card) return;
  card.values = readFieldInputs();
  // CSS їде разом із карткою, але на сервер потрапляє окремим запитом:
  // PUT /api/notes/{id} оновлює лише значення полів, тож без цього кроку
  // стиль залишився б лише в localStorage до наступного повного збереження.
  const cssChanged = deck.modelCss !== elements.editorModelCss.value;
  deck.modelCss = elements.editorModelCss.value;
  deck.updatedAt = Date.now();
  saveDecksLocally();
  renderDecks();
  renderEditor();
  haptic('success');
  showToast('Картку збережено');
  // deck_id обов'язковий: PUT /api/notes/{id} — це upsert (on conflict do
  // update), і для нової картки сервер мусить знати, у яку колоду її
  // покласти. Без нього запит падав би 404, і карка зникла б разом із
  // перезавантаженням сторінки.
  await persistCardToServer(deck, card);
  if (cssChanged) await saveDeckStyleToServer();
}

function isDeckStyleDirty() {
  return Boolean(elements.saveDeckStyleButton?.classList.contains('is-dirty'));
}

function setDeckStyleSaved() {
  if (!elements.saveDeckStyleButton) return;
  elements.saveDeckStyleButton.classList.remove('is-dirty');
  elements.saveDeckStyleButton.setAttribute('title', 'Стиль збережено');
}

function markDeckStyleDirty() {
  if (!elements.saveDeckStyleButton) return;
  elements.saveDeckStyleButton.classList.add('is-dirty');
  elements.saveDeckStyleButton.setAttribute('title', 'Є незбережені зміни стилю');
}

/** Відправляє лише метадані колоди: CSS, назви полів, шаблони. */
async function saveDeckStyleToServer() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  try {
    await apiRequestJson('/api/decks', {
      method: 'POST',
      body: JSON.stringify(deckToServerPayload(deck))
    });
    setStorageStatus('Синхронізовано з акаунтом', 'remote');
  } catch (error) {
    setStorageStatus('Стиль збережено локально, сервер недоступний', 'error');
  }
}

/**
 * CSS колоди і CSS активного стилю — завжди одне й те саме.
 *
 * Розводити їх не можна: після перезавантаження migrateDeck бере CSS саме
 * з активного стилю, тож правило, записане лише в deck.modelCss, зникло б
 * навіть у localStorage, не дійшовши до Anki.
 */
function setDeckModelCss(deck, css) {
  if (!deck || !css) return;
  const styles = ensureStyleLibrary(deck);
  const active = styles.items.find(item => item.id === styles.activeId) || styles.items[0];
  deck.modelCss = css;
  if (active) active.css = css;
}

/**
 * Зберігає стиль усієї колоди — незалежно від відкритої картки.
 *
 * Окрема кнопка, бо раніше CSS був побічним ефектом «Зберегти картку»:
 * змінити стиль колоди без картки було неможливо, а на сервер він і
 * зовсім не доїжджав.
 */
async function saveDeckStyle() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  setDeckModelCss(deck, elements.editorModelCss.value);
  deck.updatedAt = Date.now();
  saveDecksLocally();
  setDeckStyleSaved();
  haptic('success');
  showToast('Стиль колоди збережено');
  await saveDeckStyleToServer();
}

// --- БІБЛІОТЕКА СТИЛІВ ---
//
// Один стиль — один CSS на всі поля колоди. Окремих стилів на кожне
// поле немає свідомо: у колоді їх п'ять, і п'ять копій одного правила
// в списку означали б п'ять однакових стилів, які треба тримати
// синхронними вручну (і Anki отримав би п'ять однакових правил у CSS).

function styleLibrary(deck) {
  const styles = deck && deck.styles ? deck.styles : { activeId: '', items: [] };
  return Array.isArray(styles.items) ? styles.items : [];
}

function ensureStyleLibrary(deck) {
  // Колода без стилів (створена до бібліотеки) отримує один стиль із
  // поточним CSS — інакше список стилів був би порожнім, а колода
  // лишилася б стилізованою поза бібліотекою.
  if (styleLibrary(deck).length) return deck.styles;
  const item = { id: createId(), name: 'Основний', css: deck.modelCss || '' };
  deck.styles = { activeId: item.id, items: [item] };
  deck.modelCss = item.css;
  return deck.styles;
}

function openStyleModal() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  appState.styleDeckId = deck.id;
  ensureStyleLibrary(deck);
  elements.styleModalDeckName.textContent = deck.title;
  elements.newStyleName.value = '';
  appState.renamingStyleId = null;
  renderStyleList();
  elements.styleModal.classList.remove('hidden');
  elements.styleModal.classList.add('flex');
  refreshIcons(elements.styleModal);
  elements.newStyleName.focus();
  haptic();
}

function closeStyleModal() {
  elements.styleModal.classList.add('hidden');
  elements.styleModal.classList.remove('flex');
  appState.styleDeckId = null;
  appState.renamingStyleId = null;
}

function renderStyleList() {
  const deck = appState.decks.find(item => item.id === appState.styleDeckId);
  if (!deck) return;
  const items = styleLibrary(deck);
  if (!items.length) {
    elements.styleList.innerHTML = '<p class="rounded-xl border border-dashed border-app-hint/20 px-3 py-4 text-center text-xs text-app-hint">У колоді ще немає стилів. Напишіть CSS і додайте стиль унизу.</p>';
    return;
  }
  const activeId = deck.styles.activeId;
  elements.styleList.innerHTML = items.map((item) => {
    const isActive = item.id === activeId;
    const renaming = appState.renamingStyleId === item.id;
    const head = `
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-bold">${escapeHtml(item.name)}</span>
        ${isActive ? '<span class="style-badge">активний</span>' : ''}
      </span>`;
    const body = renaming
      ? `<span class="flex items-center gap-2">
          <input class="field-control" type="text" maxlength="60" value="${escapeHtml(item.name)}" data-style-name-input="${escapeHtml(item.id)}" aria-label="Нова назва стилю">
          <button class="icon-button border muted-surface border-app-hint/10" type="button" data-action="save-style-name" data-style-id="${escapeHtml(item.id)}" aria-label="Зберегти назву">
            <i data-lucide="check" class="h-4 w-4 text-emerald-500" aria-hidden="true"></i>
          </button>
          <button class="icon-button border muted-surface border-app-hint/10" type="button" data-action="cancel-rename-style" data-style-id="${escapeHtml(item.id)}" aria-label="Скасувати">
            <i data-lucide="x" class="h-4 w-4" aria-hidden="true"></i>
          </button>
        </span>`
      : `<span class="flex items-center gap-1">
          <button class="icon-button border muted-surface border-app-hint/10" type="button" data-action="rename-style" data-style-id="${escapeHtml(item.id)}" aria-label="Перейменувати стиль">
            <i data-lucide="pencil" class="h-3.5 w-3.5" aria-hidden="true"></i>
          </button>
          <button class="icon-button border muted-surface border-app-hint/10 disabled:opacity-40" type="button" data-action="delete-style" data-style-id="${escapeHtml(item.id)}" aria-label="Видалити стиль" ${items.length < 2 ? 'disabled' : ''}>
            <i data-lucide="trash-2" class="h-3.5 w-3.5" aria-hidden="true"></i>
          </button>
        </span>`;
    return `
      <div class="style-item ${isActive ? 'is-active' : ''}" data-style-id="${escapeHtml(item.id)}">
        ${renaming ? body : `<button class="style-item-main" type="button" data-action="apply-style" data-style-id="${escapeHtml(item.id)}">${head}</button>${body}`}
      </div>`;
  }).join('');
  refreshIcons(elements.styleList);
}

/**
 * Поле перейменування у рядку стилю, якщо воно відкрите.
 *
 * Шукаємо рядком, а не через CSS.escape: id стилю — довільний рядок
 * (в базі це звичайний jsonb, а не uuid), тож селектор за ним довелося
 * б екранувати щоразу на кожному кліку.
 */
function styleNameInputValue(styleId) {
  const rows = elements.styleList.querySelectorAll('.style-item');
  for (const row of rows) {
    if (row.getAttribute('data-style-id') !== styleId) continue;
    const input = row.querySelector('[data-style-name-input]');
    if (input) return String(input.value || '');
  }
  return '';
}

function startStyleRename(styleId) {
  appState.renamingStyleId = styleId;
  renderStyleList();
  const rows = elements.styleList.querySelectorAll('.style-item');
  for (const row of rows) {
    const input = row.querySelector('[data-style-name-input]');
    if (input) {
      input.focus();
      input.select();
      break;
    }
  }
}

/** Перейменування стилю — окремо від застосування. */
function commitStyleRename(styleId, name) {
  const deck = appState.decks.find(item => item.id === appState.styleDeckId);
  const clean = String(name || '').trim().slice(0, 60);
  if (!deck || !clean) {
    renderStyleList();
    return false;
  }
  deck.styles = {
    ...deck.styles,
    items: deck.styles.items.map(item => (item.id === styleId ? { ...item, name: clean } : item))
  };
  appState.renamingStyleId = null;
  deck.updatedAt = Date.now();
  saveDecksLocally();
  renderStyleList();
  if (appState.editorDeckId === deck.id) elements.editorStyleName.textContent = deckStyleName(deck);
  saveDeckStyleToServer();
  haptic('success');
  showToast('Назву стилю змінено');
  return true;
}

/**
 * Застосування збереженого стилю.
 *
 * CSS береться зі стилю, а не навпаки: застосування не має права
 * перезаписати те, що користувач не зберігав. Якщо в textarea є
 * незбережені правки, їх переносимо в новий стиль — інакше вони
 * просто зникли б разом зі зміною стилю.
 */
async function applyDeckStyle(styleId) {
  const deck = appState.decks.find(item => item.id === appState.styleDeckId);
  if (!deck) return;
  const target = deck.styles.items.find(item => item.id === styleId);
  if (!target) return;

  const edited = elements.editorModelCss.value;
  const previous = activeDeckStyle(deck);
  if (isDeckStyleDirty() && previous && previous.id !== styleId) {
    deck.styles = {
      ...deck.styles,
      items: deck.styles.items.map(item => (item.id === previous.id ? { ...item, css: edited } : item))
    };
    showToast('Правки збережено в попередньому стилі');
  }
  if (!setActiveDeckStyle(deck, styleId)) return;
  deck.updatedAt = Date.now();
  saveDecksLocally();
  setDeckStyleSaved();
  elements.editorModelCss.value = deck.modelCss;
  elements.editorStyleName.textContent = deckStyleName(deck);
  renderStyleList();
  renderDecks();
  haptic('success');
  showToast(`Застосовано стиль «${target.name}»`);
  await saveDeckStyleToServer();
}

/** Новий стиль із поточного CSS редактора. */
async function createDeckStyle() {
  const deck = appState.decks.find(item => item.id === appState.styleDeckId);
  if (!deck) return;
  const name = String(elements.newStyleName.value || '').trim().slice(0, 60);
  if (!name) {
    showToast('Впишіть назву стилю', 'error');
    elements.newStyleName.focus();
    return;
  }
  if (styleLibrary(deck).some(item => item.name.toLowerCase() === name.toLowerCase())) {
    showToast('Стиль із такою назвою вже є', 'error');
    return;
  }
  const previous = activeDeckStyle(deck);
  const edited = elements.editorModelCss.value;
  if (isDeckStyleDirty() && previous) {
    deck.styles = {
      ...deck.styles,
      items: deck.styles.items.map(item => (item.id === previous.id ? { ...item, css: edited } : item))
    };
  }
  // Новий стиль — це те, що користувач бачить на екрані, а не останнє
  // збережене: інакше кнопка «Зберегти поточний CSS» створювала б копію
  // попереднього стилю, а правки зникали б разом із натисканням.
  const item = { id: createId(), name, css: edited };
  deck.styles = { ...deck.styles, activeId: item.id, items: [...styleLibrary(deck), item] };
  deck.modelCss = item.css;
  deck.updatedAt = Date.now();
  saveDecksLocally();
  setDeckStyleSaved();
  elements.newStyleName.value = '';
  elements.editorStyleName.textContent = deckStyleName(deck);
  renderStyleList();
  renderDecks();
  haptic('success');
  showToast(`Стиль «${name}» збережено`);
  await saveDeckStyleToServer();
}

/**
 * Видалення стилю.
 *
 * Останній стиль не видаляється: колода без жодного стилю не має
 * CSS для .apkg, і користувач не зміг би її відновити. Активним після
 * видалення стає перший із решти — інакше колода лишилася б без
 * стилю, який можна редагувати.
 */
function requestDeleteDeckStyle(styleId) {
  const deck = appState.decks.find(item => item.id === appState.styleDeckId);
  if (!deck) return;
  const style = deck.styles.items.find(item => item.id === styleId);
  if (!style) return;
  if (styleLibrary(deck).length < 2) {
    showToast('Має лишитися хоча б один стиль', 'error');
    return;
  }
  openConfirmModal('Видалити стиль?', `Стиль “${style.name}” буде видалено з колоди “${deck.title}”.`, async () => {
    const items = styleLibrary(deck).filter(item => item.id !== styleId);
    const wasActive = deck.styles.activeId === styleId;
    deck.styles = { activeId: wasActive ? items[0].id : deck.styles.activeId, items };
    deck.updatedAt = Date.now();
    if (wasActive) {
      deck.modelCss = items[0].css;
      elements.editorModelCss.value = deck.modelCss;
      setDeckStyleSaved();
    }
    saveDecksLocally();
    renderStyleList();
    if (appState.editorDeckId === deck.id) elements.editorStyleName.textContent = deckStyleName(deck);
    renderDecks();
    haptic('success');
    showToast('Стиль видалено');
    await saveDeckStyleToServer();
  });
}

/**
 * Очищає колоду від карток, зберігаючи її саму.
 *
 * Локально картки просто зникають із deck.cards, а на сервер іде
 * PUT /api/decks/{id}/cards з порожнім списком: db.replace_notes робить
 * це однією транзакцією, тож наступна синхронізація не воскресить
 * видалені картки. DELETE /api/decks/{id} тут не годиться — він
 * видалив би саму колоду разом із полями, стилем і шаблонами.
 */
function requestClearDeckCards() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  if (!deck.cards.length) {
    showToast('У колоді вже немає карток');
    return;
  }
  const count = deck.cards.length;
  openConfirmModal(
    'Очистити колоду?',
    `Карток: ${count}. Буде очищено всі картки з колоди “${deck.title}”, а поля, стиль і шаблони залишаться.`,
    async () => {
      deck.cards = [];
      appState.editorCardId = null;
      deck.updatedAt = Date.now();
      saveDecksLocally();
      renderEditor();
      renderDecks();
      haptic('success');
      showToast('Колоду очищено');
      try {
        await apiRequestJson(`/api/decks/${deck.id}/cards`, {
          method: 'PUT',
          body: JSON.stringify({ cards: [] })
        });
        setStorageStatus('Синхронізовано з акаунтом', 'remote');
      } catch (error) {
        setStorageStatus('Очищено локально, сервер недоступний', 'error');
      }
    }
  );
}

/**
 * Надсилає одну картку на сервер.
 *
 * Окрема функція, бо викликається з двох місць: після редагування та від
 *разу після створення. Колись створення лише додавало картку в
 * appState, і вона жила тільки в пам'яті — жоден запит на сервер не
 * йшов, тож після перезавантаження сторінки картка зникала, а наступне
 * редагування падало з 404.
 */
async function persistCardToServer(deck, card) {
  try {
    await apiRequestJson(`/api/notes/${card.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        deck_id: deck.id,
        cards: [{ id: card.id, values: card.values }]
      })
    });
    setStorageStatus('Синхронізовано з акаунтом', 'remote');
    return true;
  } catch (error) {
    setStorageStatus('Збережено локально, сервер недоступний', 'error');
    return false;
  }
}
async function addEditorCard() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (!deck) return;
  const fieldNames = deckFieldNames(deck);
  const values = {};
  fieldNames.forEach((name, index) => {
    values[name] = index === 0 ? 'Нове запитання' : (index === 1 ? 'Нова відповідь' : '');
  });
  const card = { id: createId(), values, createdAt: Date.now() };
  deck.cards.push(card);
  deck.updatedAt = Date.now();
  appState.editorCardId = card.id;
  saveDecksLocally();
  renderEditor();
  renderDecks();
  const first = elements.editorFields.querySelector('[data-field-name]');
  if (first) {
    first.focus();
    first.select();
  }
  haptic();
  // Одразу віддаємо картку серверу. Інакше вона існувала б лише в
  // localStorage, а після перезавантаження сторінки її замінив би серверний
  // стан — і картка зникла б, наче її ніколи не було.
  await persistCardToServer(deck, card);
}

function requestDeleteCard() {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  const card = deck?.cards.find(item => item.id === appState.editorCardId);
  if (!deck || !card) return;
  const label = cardLabel(card, deckFieldNames(deck));
  openConfirmModal('Видалити картку?', `Картку “${label}” буде видалено з колоди “${deck.title}”.`, async () => {
    const index = deck.cards.findIndex(item => item.id === card.id);
    deck.cards.splice(index, 1);
    appState.editorCardId = deck.cards[Math.max(0, index - 1)]?.id || null;
    deck.updatedAt = Date.now();
    saveDecksLocally();
    renderEditor();
    renderDecks();
    showToast('Картку видалено');
    haptic('success');
    const removedId = card.id;
    try {
      await apiRequestJson(`/api/notes/${removedId}`, { method: 'DELETE' });
      setStorageStatus('Синхронізовано з акаунтом', 'remote');
    } catch (error) {
      setStorageStatus('Видалено локально, сервер недоступний', 'error');
    }
  });
}

function createDeck(title, fieldNames, parentId = null) {
  const css = '.card {\n  font-family: system-ui, sans-serif;\n  font-size: 20px;\n  text-align: center;\n}';
  // Нова колода одразу має стиль: інакше вікно стилів показувало б
  // порожній список, а користувач не зміг би додати перший.
  const style = { id: createId(), name: 'Основний', css };
  const deck = {
    id: createId(),
    parentId: parentId || null,
    title: title.trim(),
    modelCss: css,
    styles: { activeId: style.id, items: [style] },
    templates: [],
    fieldNames: sanitizeFieldNames(fieldNames).length ? sanitizeFieldNames(fieldNames) : DEFAULT_FIELD_NAMES.slice(),
    cards: [],
    updatedAt: Date.now()
  };
  appState.decks.unshift(deck);
  appState.activeDeckId = deck.id;
  return deck;
}

/**
 * Будує план ланцюга батьків із введених сегментів шляху.
 *
 * appState не чіпає. Повертає {deepestExisting, planned}:
 *   deepestExisting — id найглибшого НАЯВНОГО предка (null, якщо рівень кореневий);
 *   planned — рівні, яких треба створити, від кореня вниз; у кожного
 *   after — ref батька (uuid наявної колоди або 'plan:i' попереднього planned).
 *
 * Наявний родич із такою самою назвою перевикористовується, а не
 * дублюється — саме так поводиться Anki. Інакше "університет::математика"
 * і "університет::фізика" створили б дві колоди "університет".
 *
 * Чому план, а не одразу створення: resolveDeckPathInput має спершу
 * перевірити, що листок не конфліктує з уже наявним сусідом. Створивши
 * проміжні рівні до перевірки, ми лишили б у списки напівстворені колоди,
 * яких на сервері немає.
 */
function ensureDeckParents(segments, parentId) {
  const planned = [];
  let deepestExisting = parentId || null;
  // cursor — ref батька для наступного сегмента: або id наявної колоди,
  // або 'plan:<i>' для вже запланованого рівня.
  let cursor = deepestExisting;

  const matches = (title, parentRef) => String(title || '').trim().toLowerCase();
  const findExisting = (parentRef, wanted) => {
    const key = String(parentRef);
    if (key.startsWith('plan:')) {
      const plan = planned[Number(key.slice(5))];
      return plan && matches(plan.title) === wanted ? key : null;
    }
    const hit = appState.decks.find(deck =>
      (deck.parentId || null) === (key === 'null' ? null : key)
      && matches(deck.title) === wanted);
    return hit ? hit.id : null;
  };

  for (const title of segments) {
    const wanted = matches(title);
    if (!wanted) continue;
    const ref = String(cursor);
    const existing = findExisting(ref === 'null' ? null : cursor, wanted);
    if (existing) {
      if (!String(existing).startsWith('plan:')) deepestExisting = existing;
      cursor = existing;
      continue;
    }
    planned.push({ title, after: ref });
    cursor = `plan:${planned.length - 1}`;
  }
  return { deepestExisting, planned };
}

/**
 * "університет::математика::лекція1" -> ланцюг батьків + листкова колода.
 *
 * parentId — уже обрана батьківська колода. Шлях тоді відносний до неї:
 * під «університет» рядок "математика::лекція1" дає maths у філіалі.
 *
 * existingId — колода, яку перейменовують. Тоді нічого не створюємо:
 * повторне підтвердження модалки інакше плодило б дублікати щоразу
 * з новими uuid.
 */
function resolveDeckPathInput(rawTitle, parentId, existingId) {
  const parts = splitDeckPath(rawTitle);
  if (!parts.length) return { error: 'Введіть назву колоди' };
  const leafTitle = parts[parts.length - 1];

  if (existingId) {
    const deck = appState.decks.find(item => item.id === existingId);
    if (deck) deck.title = leafTitle;
    return { deck, created: [], title: leafTitle };
  }

  // Ланцюг батьків будується в пам'яті, без запису в appState: доки
  // не зрозуміло, чи пройде листок, створювати рівні рано.
  const { deepestExisting, planned } = ensureDeckParents(parts.slice(0, -1), parentId || null);

  // Дублікат перевіряємо проти ФІНАЛЬНОГО батька, а не проти того, що
  // користувач обрав у діалозі: під «університетом» рядок
  // "математика::лекція 1" — це конфлікт із наявною
  // "університет/математика/лекція 1", і перевірка за parentId
  // під «Оранем» пропустила б його повз, а сервер відхилив би запит
  // із 409 — вже після створення проміжного рівня на сервері теж.
  //
  // Якщо ланцюг порожній, батьком листка стає наявна колода і конфлікт
  // реальний. Якщо Planned не порожній, батьком листка стане щойно
  // створена колода, тож першою дитиною в ній конфлікту бути не може —
  // це єдиний випадок, коли перевірка зайва.
  if (!planned.length) {
    const clash = duplicateSiblingTitle(leafTitle, deepestExisting, null, appState.decks);
    if (clash) {
      return {
        error: `Під «${parentTitleOf(deepestExisting, appState.decks)}» вже є колода «${leafTitle}»`
      };
    }
  }

  // Усе чисто — тепер можна створювати.
  //
  // Ланцюг будується в циклі, а не з planned[].after: createDeck сам
  // вигадує id, тому наступний рівень має брати батьком щойно створений
  // об'єкт. Якщо підставити плановий ref, рівень пішов би в корінь
  // на колоду, якої не існує, — дерево розпалося б на корені рівнів.
  const created = [];
  let current = deepestExisting;
  for (const plan of planned) {
    const parent = createDeck(plan.title, [], current);
    created.push(parent);
    current = parent.id;
  }
  return { deck: createDeck(leafTitle, [], current), created, title: leafTitle };
}

function openDeckModal(mode, cards = [], model = {}, parentId) {
  appState.modalMode = mode;
  appState.pendingCards = normalizeCards(cards, model.fieldNames);
  appState.pendingFieldNames = resolveFieldNames(appState.pendingCards, model.fieldNames);
  appState.pendingModelCss = typeof model.css === 'string' ? model.css : '';
  appState.pendingTemplates = Array.isArray(model.templates) ? model.templates : [];
  elements.newDeckName.value = '';
  if (mode === 'create') {
    // За замовчуванням нова колода стає підколодою активної: у дереві
    // це те, що роблять найчастіше. Сам шлях у назві перевизначає
    // будь-який вибір батька.
    appState.pendingParentId = parentId !== undefined
      ? parentId
      : (appState.activeDeckId || null);
    const parent = appState.pendingParentId
      ? appState.decks.find(item => item.id === appState.pendingParentId)
      : null;
    elements.deckModalTitle.textContent = 'Створити нову колоду';
    elements.deckModalDescription.textContent = parent
      ? `Підколода «${parent.title}». Шлях через «::» дозволить створити й вищі рівні.`
      : 'Шлях через «::» створює вкладеність: університет::математика::лекція 1.';
    elements.saveDeckOptionsWrap.classList.add('hidden');
    elements.newDeckFieldWrap.classList.remove('hidden');
    elements.confirmDeckModalText.textContent = 'Створити';
  } else {
    appState.pendingParentId = null;
    elements.deckModalTitle.textContent = 'Зберегти картки';
    elements.deckModalDescription.textContent = `Готово до збереження: ${appState.pendingCards.length} ${pluralizeCards(appState.pendingCards.length)}.`;
    elements.saveDeckOptionsWrap.classList.remove('hidden');
    elements.newDeckFieldWrap.classList.remove('hidden');
    elements.confirmDeckModalText.textContent = 'Збережити';
    renderDeckOptions();
  }
  elements.deckModal.classList.remove('hidden');
  elements.deckModal.classList.add('flex');
  window.setTimeout(() => elements.newDeckName.focus(), 80);
}

// --- СТИЛЬ ДЛЯ ГЕНЕРАЦІЇ ---
//
// Обраний стиль живе окремо від активного стилю колоди. Активний — це «
// що вже застосовано до наявних карток», обраний — «що візьме Gemini для
// наступної генерації». Змішувати їх не можна: генерація в іншу колоду не
// мала б непомітно перемикати стиль тієї, у якій користувач працює.

function generationStyleStorageKey() {
  const userId = currentUserId();
  return userId ? `${STORAGE_KEY}:${userId}:generation-style` : `${STORAGE_KEY}:generation-style`;
}

function loadGenerationStyleId() {
  try {
    return localStorage.getItem(generationStyleStorageKey()) || '';
  } catch (error) {
    return '';
  }
}

function saveGenerationStyleId(styleId) {
  try {
    const key = generationStyleStorageKey();
    if (styleId) localStorage.setItem(key, styleId);
    else localStorage.removeItem(key);
    return true;
  } catch (error) {
    return false;
  }
}

/** Усі стилі всіх колод: [{ deck, style }] — для списку вибору. */
function allDeckStyles() {
  const out = [];
  for (const deck of appState.decks) {
    for (const style of styleLibrary(deck)) {
      if (!style || !style.css) continue;
      out.push({ deck, style });
    }
  }
  return out;
}

/** Обраний стиль як об'єкт або null, коли вибрано «авто». */
function generationStyle() {
  const styleId = appState.generationStyleId;
  if (!styleId) return null;
  for (const deck of appState.decks) {
    const style = styleLibrary(deck).find(item => item.id === styleId);
    if (style && style.css) return { deck, style };
  }
  return null;
}

function setGenerationStyleId(styleId) {
  const next = styleId && generationStyleIdExists(styleId) ? styleId : '';
  appState.generationStyleId = next;
  saveGenerationStyleId(next);
  renderGenerationStyleList();
  return next;
}

function generationStyleIdExists(styleId) {
  return appState.decks.some(deck => styleLibrary(deck).some(item => item.id === styleId));
}

/**
 * Підпис на кнопці: назва обраного стилю й колода, якій він належить.
 *
 * Назва колоди тут не для краси: стиль «Основний» є в кожній, і без неї
 * в підписі не зрозуміло, чий стиль зараз діє.
 */
function generationStyleLabel() {
  const chosen = generationStyle();
  if (!chosen) return 'Авто — стиль підбере Gemini';
  return `${chosen.deck.title} · ${chosen.style.name}`;
}

/**
 * Список «стиль для нових карток».
 *
 * Групується за колодами: стиль «Основний» є в кожній, і без назви
 * колоди в підписі вибір у списку з п'яти однакових «Основний» був би
 * нерозбірливим. Порожній id — «авто»: тоді Gemini вигадує оформлення
 * сам, як раніше.
 */
function renderGenerationStyleList() {
  const list = elements.generationStyleList;
  const label = elements.generationStyleLabel;
  if (!list) return;
  // Стиль могли видалити або перенести — тоді показуємо «авто», а не
  // порожній список, щоб у генерацію не пішов невидимий стиль.
  if (appState.generationStyleId && !generationStyleIdExists(appState.generationStyleId)) {
    appState.generationStyleId = '';
    saveGenerationStyleId('');
  }
  if (label) label.textContent = generationStyleLabel();

  const groups = allDeckStyles();
  const autoSelected = !appState.generationStyleId;
  const auto = `
    <button class="style-option ${autoSelected ? 'is-selected' : ''}" type="button" role="option"
            aria-selected="${autoSelected}" data-generation-style="">
      <span class="style-option-icon"><i data-lucide="wand-2" class="h-4 w-4" aria-hidden="true"></i></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs font-bold">Авто</span>
        <span class="block truncate text-[10px] text-app-hint">стиль підбере Gemini</span>
      </span>
      <i data-lucide="check" class="style-option-check h-4 w-4" aria-hidden="true"></i>
    </button>`;
  if (!groups.length) {
    list.innerHTML = `${auto}<p class="px-3 py-4 text-center text-[11px] text-app-hint">Збережених стилів ще немає. Створи стиль у колоді — і він з'явиться тут.</p>`;
    refreshIcons(list);
    return;
  }
  const byDeck = new Map();
  for (const { deck, style } of groups) {
    if (!byDeck.has(deck.id)) byDeck.set(deck.id, { title: deck.title, items: [] });
    byDeck.get(deck.id).items.push(style);
  }
  const body = [...byDeck.values()].map(({ title, items }) => `
    <div class="style-option-group">
      <p class="style-option-group-label">${escapeHtml(title)}</p>
      ${items.map(style => {
        const selected = style.id === appState.generationStyleId;
        return `
        <button class="style-option ${selected ? 'is-selected' : ''}" type="button" role="option"
                aria-selected="${selected}" data-generation-style="${escapeHtml(style.id)}">
          <span class="style-option-icon"><i data-lucide="paint-bucket" class="h-4 w-4" aria-hidden="true"></i></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-bold">${escapeHtml(style.name)}</span>
            <span class="style-option-preview" aria-hidden="true">${styleColorSwatches(style.css)}</span>
          </span>
          <i data-lucide="check" class="style-option-check h-4 w-4" aria-hidden="true"></i>
        </button>`;
      }).join('')}
    </div>`).join('');
  list.innerHTML = auto + body;
  refreshIcons(list);
}

/**
 * Кольорові плями з CSS стилю.
 *
 * Назва «Темний» нічого не каже про оформлення, а колір — відразу: дві
 * «Темний» з різним фоном користувач не розрізнить. Беремо перші
 * унікальні кольори з реального CSS, тож плями завжди правдиві.
 */
function styleColorSwatches(css) {
  const found = [];
  const seen = new Set();
  for (const match of String(css || '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    // Рахуємо саме цифри після #, а не довжину збігу разом із решіткою:
    // інакше #abc (довжина 4 разом із #) відпадає як «не той формат».
    const hex = match[0].slice(1).toLowerCase();
    // 3 і 6 цифр — реальні кольори; 4 і 8 (з альфа-каналом) у CSS
    // трапляються рідко й виглядали б як напівпрозорий бруд.
    if (hex.length !== 3 && hex.length !== 6) continue;
    const color = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    if (seen.has(color)) continue;
    seen.add(color);
    found.push(color);
    if (found.length === 4) break;
  }
  if (!found.length) return '<span class="text-[10px] text-app-hint">без кольорів</span>';
  return found.map(color =>
    `<span class="style-swatch" style="background: #${color}"></span>`).join('');
}

function isGenerationStyleListOpen() {
  return Boolean(elements.generationStyleList
    && !elements.generationStyleList.classList.contains('hidden'));
}

function openGenerationStyleList() {
  const list = elements.generationStyleList;
  if (!list) return;
  renderGenerationStyleList();
  list.classList.remove('hidden');
  list.classList.add('flex');
  elements.generationStyleButton.setAttribute('aria-expanded', 'true');
  elements.generationStyleChevron.classList.add('rotate-180');
  // Фокус на списку, а не на кнопці: далі працюють стрілки, і клавіатура
  // не губить список після першого натискання Enter.
  list.focus();
}

function closeGenerationStyleList() {
  const list = elements.generationStyleList;
  if (!list) return;
  list.classList.add('hidden');
  list.classList.remove('flex');
  elements.generationStyleButton.setAttribute('aria-expanded', 'false');
  elements.generationStyleChevron.classList.remove('rotate-180');
}

function toggleGenerationStyleList() {
  if (isGenerationStyleListOpen()) closeGenerationStyleList();
  else openGenerationStyleList();
}

/**
 * Вибір із списку.
 *
 * Клік по варіанту не закриває список сам: його закриває pickGenerationStyle.
 * Різниця важлива — інакше клік потою, коли DOM уже перемальовано,
 * летів би у той самий обробник удруге й перемикав стиль на сусідній.
 */
function pickGenerationStyle(styleId) {
  const chosen = setGenerationStyleId(styleId);
  const style = generationStyle();
  closeGenerationStyleList();
  elements.generationStyleButton.focus();
  haptic();
  showToast(style
    ? `Стиль «${style.style.name}» піде в нові картки`
    : 'Стиль нових карток підбере Gemini');
  return chosen;
}

/**
 * Клавіатура у списку стилів.
 *
 * Enter/Space обирають варіант, Escape закриває, стрілки і Home/End
 * пересувають фокус. Фокус рухаємо реальним DOM-фокусом на кнопку
 * варіанта, а не через aria-activedescendant: тоді клавіатура
 * «просто працює», а скринредер бачить справжній focus.
 */
function handleGenerationStyleListKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeGenerationStyleList();
    elements.generationStyleButton.focus();
    return;
  }
  const list = elements.generationStyleList;
  const options = [...list.querySelectorAll('[data-generation-style]')];
  if (!options.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const current = options.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown'
      ? (current + 1) % options.length
      : (current <= 0 ? options.length : current) - 1;
    options[next].focus();
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    options[event.key === 'Home' ? 0 : options.length - 1].focus();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    const option = event.target.closest('[data-generation-style]');
    if (!option) return;
    event.preventDefault();
    pickGenerationStyle(option.dataset.generationStyle);
  }
}

function closeDeckModal() {
  elements.deckModal.classList.add('hidden');
  elements.deckModal.classList.remove('flex');
  appState.pendingCards = [];
  appState.selectedModalDeckId = null;
  appState.pendingParentId = null;
}

/**
 * Список колод у модалці — з повним шляхом.
 *
 * Без шляху "Лекція 1" під maths і під фізикою виглядали б однаково, і
 * картки потрапили б не туди, куди користувач хотів.
 */
function renderDeckOptions() {
  if (!appState.decks.length) {
    elements.saveDeckOptions.innerHTML = '<div class="rounded-xl border border-dashed border-app-hint/30 p-4 text-center text-xs text-app-hint">Наявних колод немає. Створіть нову нижче.</div>';
    appState.selectedModalDeckId = null;
    return;
  }
  if (!appState.decks.some(deck => deck.id === appState.selectedModalDeckId)) {
    appState.selectedModalDeckId = appState.activeDeckId && appState.decks.some(deck => deck.id === appState.activeDeckId)
      ? appState.activeDeckId
      : appState.decks[0].id;
  }
  const selected = appState.selectedModalDeckId;
  elements.saveDeckOptions.innerHTML = flattenDeckTree(appState.decks, new Set()).map(row => {
    const deck = row.deck;
    const path = deckAncestors(deck, appState.decks).map(item => item.title).join(' / ');
    return `
    <label class="deck-option flex cursor-pointer items-center gap-3 rounded-xl border border-app-hint/10 p-3 ${deck.id === selected ? 'is-selected' : ''}" style="margin-left:${row.depth * 12}px">
      <input class="sr-only" type="radio" name="targetDeck" value="${escapeHtml(deck.id)}" ${deck.id === selected ? 'checked' : ''}>
      <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-app-link/10 text-app-button">
        <i data-lucide="layers-3" class="h-4 w-4" aria-hidden="true"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-bold">${escapeHtml(deck.title)}</span>
        <span class="block truncate text-[11px] text-app-hint">${path ? escapeHtml(path) + ' / ' : ''}${deck.cards.length} ${pluralizeCards(deck.cards.length)}</span>
      </span>
      <i data-lucide="check-circle-2" class="h-4 w-4 text-app-button ${deck.id === selected ? '' : 'hidden'}" aria-hidden="true"></i>
    </label>
  `;
  }).join('');
  refreshIcons(elements.saveDeckOptions);
}

async function confirmDeckModal() {
  if (appState.modalMode === 'create') {
    const { deck, created, error } = resolveDeckPathInput(elements.newDeckName.value, appState.pendingParentId);
    if (error) {
      elements.newDeckName.focus();
      showToast(error, 'warning');
      return;
    }
    saveDecksLocally();
    renderDecks();
    closeDeckModal();
    const parent = deckAncestors(deck, appState.decks).slice(-1)[0];
    showToast(parent ? `Колоду створено в «${parent.title}»` : 'Колоду створено');
    haptic('success');
    try {
      // Ланцюг від кореня: колода, яка прийшла раніше за свого батька,
      // залишилася б у корені назавжди.
      await pushDeckChain(created.length ? [...created, deck] : [deck]);
      setStorageStatus('Синхронізовано з акаунтом', 'remote');
    } catch (error) {
      showToast(error?.message || 'Колоду збережено локально, сервер недоступний', 'error');
      setStorageStatus('Колоду збережено локально, сервер недоступний', 'error');
    }
    return;
  }

  let targetDeck;
  let createdParents = [];
  const newTitle = elements.newDeckName.value.trim();
  if (newTitle) {
    const resolved = resolveDeckPathInput(newTitle, appState.pendingParentId);
    if (resolved.error) {
      elements.newDeckName.focus();
      showToast(resolved.error, 'warning');
      return;
    }
    targetDeck = resolved.deck;
    createdParents = resolved.created;
    if (appState.pendingModelCss) setDeckModelCss(targetDeck, appState.pendingModelCss);
    targetDeck.templates = appState.pendingTemplates.slice();
  } else {
    targetDeck = appState.decks.find(deck => deck.id === appState.selectedModalDeckId);
  }
  if (!targetDeck) {
    showToast('Створіть або оберіть колоду', 'warning');
    return;
  }

  // Картки не можна переносити в колоду з іншими іменами полів: значення
  // полів не збігаються, і картки мовчки порожніли б. Краще відмовити.
  //
  // Але перевірка має сенс лише для колоди, у якій УЖЕ є картки. Порожня
  // колода нічого не втратить: їй можна просто віддати імена полів тих
  // карток, які до неї кладуть. Без цього користувач не міг зберігти
  // картки в жодну нову колоду — усі нові колоди народжуються з
  // типовими ['Front','Back','Extra'], а модель із чату дає свої імена.
  if (!canMergeCards(deckFieldNames(targetDeck), appState.pendingFieldNames)) {
    const targetIsEmpty = !(targetDeck.cards || []).length;
    if (!targetIsEmpty) {
      showToast('Поля не збігаються — створіть нову колоду', 'warning');
      elements.newDeckName.focus();
      return;
    }
    // Порожня колода приймає імена полів із карток, які в неї кладуть.
    // Модель і шаблони теж: інакше в Anki пішов би типовий вигляд, а
    // користувач очікував той, що бачив у чаті.
    targetDeck.fieldNames = sanitizeFieldNames(appState.pendingFieldNames).slice();
    if (appState.pendingModelCss) setDeckModelCss(targetDeck, appState.pendingModelCss);
    if (appState.pendingTemplates.length) targetDeck.templates = appState.pendingTemplates.slice();
  }

  const cards = appState.pendingCards.map(card => ({ id: createId(), values: card.values, createdAt: Date.now() }));
  targetDeck.cards.push(...cards);
  targetDeck.updatedAt = Date.now();
  appState.activeDeckId = targetDeck.id;
  saveDecksLocally();
  renderDecks();
  closeDeckModal();
  showToast(`Збережено ${cards.length} ${pluralizeCards(cards.length)}`);
  haptic('success');
  try {
    await pushDeckChain(createdParents.length ? [...createdParents, targetDeck] : [targetDeck]);
    setStorageStatus('Синхронізовано з акаунтом', 'remote');
  } catch (error) {
    showToast(error?.message || 'Картки збережено локально, сервер недоступний', 'error');
    setStorageStatus('Картки збережено локально, сервер недоступний', 'error');
  }
}

function requestDeleteDeck(deckId) {
  const deck = appState.decks.find(item => item.id === deckId);
  if (!deck) return;
  // ON DELETE CASCADE в базі знесе й нащадків, тому про це треба сказати
  // до натискання, а не після: відновити таке неможливо.
  const subtree = countSubtreeDecks(deck.id, appState.decks);
  const nested = subtree
    ? ` Разом з нею буде видалено ще ${subtree} ${pluralizeDecks(subtree)} з її гілки.`
    : '';
  const cards = deck.cards.length;
  openConfirmModal('Видалити колоду?', `Колоду “${deck.title}”${cards ? ` та всі ${cards} ${pluralizeCards(cards)}` : ''} буде видалено.${nested}`, async () => {
    const doomed = new Set([deckId]);
    for (const row of appState.decks) {
      if (row.id !== deckId && isDescendantDeck(row.id, deckId, appState.decks)) doomed.add(row.id);
    }
    appState.decks = appState.decks.filter(item => !doomed.has(item.id));
    for (const id of doomed) appState.collapsedDeckIds.delete(id);
    if (doomed.has(appState.activeDeckId)) appState.activeDeckId = appState.decks[0]?.id || null;
    if (doomed.has(appState.editorDeckId)) showDeckList();
    saveDecksLocally();
    renderDecks();
    showToast(subtree ? `Видалено колоду і ${subtree} ${pluralizeDecks(subtree)}` : 'Колоду видалено');
    haptic('success');
    try {
      // Каскад на сервері знесе нащадків і сам, тож окремих запитів не
      // потрібно — лише кореневу колоду.
      await apiRequestJson(`/api/decks/${deckId}`, { method: 'DELETE' });
      setStorageStatus('Синхронізовано з акаунтом', 'remote');
    } catch (error) {
      setStorageStatus('Видалено локально, сервер недоступний', 'error');
    }
  });
}

  async function downloadDeck(deckId) {
    const found = appState.decks.find(item => item.id === deckId);
    if (!found) return;
    showToast('Готую .apkg...');
    try {
      // migrateDeck присвоює id тим карткам, що їх ще не мають, і
      // одразу зберігає колоду. Без цього кроку id жили б лише
      // у цьому виклику, наступний експорт дав би інші GUID, і Anki
      // щоразу створював би дублікати замість оновлення.
      // Треба мігрувати не лише корінь, а й усю гілку: buildExportPayload
      // бере нащадків нижче, і картка без id у нащадку потрапила б у
      // .apkg з тимчасовим GUID. Наступний експорт дав би інший GUID, тож
      // Anki створював би дублікати замість оновлення.
      const subtreeIds = new Set(collectSubtreeIds(found, appState.decks));
      const targetIds = new Set([found.id, ...subtreeIds]);
      let changed = false;
      let renamedDeck = null;

      for (const item of appState.decks) {
        if (!targetIds.has(item.id) || isExportIdentityReady(item)) continue;
        const migrated = migrateDeck(item);
        const index = appState.decks.findIndex(deckItem => deckItem.id === item.id);
        if (index !== -1) appState.decks[index] = migrated;
        changed = true;
        if (item === found) renamedDeck = migrated;
      }

      if (changed) {
        saveDecksLocally();
        // Міграція могла замінити id — усі посилання мають піти за ним,
        // інакше редактор та список втратять активну колоду.
        const current = renamedDeck
          || appState.decks.find(item => item.id === found.id)
          || found;
        if (appState.activeDeckId === found.id) appState.activeDeckId = current.id;
        if (appState.editorDeckId === found.id) appState.editorDeckId = current.id;
      }

      const deck = renamedDeck
        || appState.decks.find(item => item.id === found.id)
        || found;
      if (!isExportIdentityReady(deck)) {
        showToast('Не вдалося призначити стабільні ID карткам', 'error');
        return;
      }
      if (!isSubtreeExportIdentityReady(deck, appState.decks)) {
        showToast('Не вдалося призначити стабільні ID карткам у вкладених колодах', 'error');
        return;
      }

      const payload = buildExportPayload(deck, appState.decks);
      // Порожні картки в самій колоді — норма для батька, його сенс у
      // нащадках. Відмовитися варто лише тоді, коли порожня вся гілка.
      const subtreeCards = payload.subtree.reduce((sum, node) => sum + node.cards.length, 0);
      if (!payload.cards.length && !subtreeCards) {
        showToast('Немає чого експортувати', 'warning');
        return;
      }

      const response = await apiFetch('/api/export-deck', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFileName(deck.title)}.apkg`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
      showToast('Файл .apkg завантажено');
      haptic('success');
    } catch (error) {
      // Причину не ковтаємо: без неї користувач бачить лише
      // «Не вдалося завантажити» і не може зрозуміти, чи це сервер,
      // браузер чи дані колоди.
      console.error('[export-deck]', error);
      showToast(`Не вдалося завантажити .apkg: ${error.message || error}`, 'error');
      haptic('error');
    }
  }

function sanitizeFileName(value) {
  return String(value || 'anki-deck').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim().replace(/\s+/g, '-') || 'anki-deck';
}

// --- ПЕРЕГЛЯД КАРТОК ---
//
// Мета — показати картку рівно так, як вона виглядатиме в Anki. Тому
// структура сторін дзеркалить build_card_templates() з main.py: перше
// поле — питання, решта — блоками з підписами на зворотному.
//
// Користувацький CSS не можна вставляти в документ як є: правило
// `body { ... }` або `.card { ... }` перефарбувало б увесь застосунок.
// Тому кожен селектор отримує префікс .deck-preview-scope — всередині
// прев'ю це працює точно так само, а назовні не витікає.

let previewState = null;

const PREVIEW_SCOPE = '.deck-preview-scope';

function prefixSelectorList(selectorText, scope) {
  return String(selectorText)
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      return trimmed ? `${scope} ${trimmed}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

function scopePreviewCss(css, scope) {
  const source = String(css || '');
  if (!source.trim()) return '';

  const parse = (src) => {
    let pos = 0;
    const out = [];

    // Читає вміст фігурних дужок, починаючи з відкритої '{'.
    const readBlock = () => {
      const start = ++pos;
      let depth = 0;
      while (pos < src.length) {
        const ch = src[pos];
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          if (depth === 0) {
            const content = src.slice(start, pos);
            pos++;
            return content;
          }
          depth--;
        }
        pos++;
      }
      return src.slice(start);
    };

    while (pos < src.length) {
      if (/\s/.test(src[pos])) {
        pos++;
        continue;
      }
      if (src[pos] === '@') {
        let end = pos;
        while (end < src.length && src[end] !== '{' && src[end] !== ';') end++;
        const head = src.slice(pos, end).trim();
        pos = end;
        if (src[pos] === '{') {
          const body = readBlock();
          // У media/supports селектори треба переписати всередині, у
          // keyframes та font-face — ні (там немає селекторів).
          out.push(/^@(media|supports|layer|container|scope)\b/i.test(head)
            ? `${head} {${parse(body)}}`
            : `${head} {${body}}`);
        } else {
          pos++;
          out.push(`${head};`);
        }
        continue;
      }
      const selectorEnd = src.indexOf('{', pos);
      if (selectorEnd === -1) break;
      const selectors = src.slice(pos, selectorEnd);
      pos = selectorEnd;
      const body = readBlock();
      out.push(`${prefixSelectorList(selectors, scope)}{${body}}`);
    }
    return out.join('\n');
  };

  return parse(source).trim();
}

function previewCardEntries(card, fieldNames) {
  const names = resolveFieldNames([card], fieldNames);
  const values = card && card.values && typeof card.values === 'object' ? card.values : {};
  return names.map((name) => [name, String(values[name] == null ? '' : values[name])]);
}

/**
 * Розмітка полів у прев'ю дзеркалить build_card_templates у main.py.
 *
 * Гачки data-field і .anki-field-N мають бути тут ті самі, що в Anki:
 * інакше CSS, який користувач пише для окремих полів, у прев'ю не
 * спрацював би — і здавалося б, що стилізація зламана.
 */
function buildPreviewFaces(card, fieldNames) {
  const entries = previewCardEntries(card, fieldNames);
  if (!entries.length) return { front: '', back: '' };

  const [head, ...tail] = entries;
  const front = `<div class="anki-question anki-field-1" data-field="${escapeHtml(head[0])}">${escapeHtml(head[1])}</div>`;
  const blocks = tail.map(([name, value], index) => (
    `<div class="anki-field anki-field-${index + 2}" data-field="${escapeHtml(name)}">` +
    `<div class="anki-field-name">${escapeHtml(name)}</div>` +
    `<div class="anki-field-value">${escapeHtml(value)}</div>` +
    '</div>'
  ));
  // На зворотному {{FrontSide}} — це вже відрендерена лицьова сторона.
  const back = front + '<hr id="answer">' + blocks.join('');
  return { front, back };
}

function renderPreview() {
  if (!previewState) return;
  const { deck, index, flipped } = previewState;
  const stage = elements.previewCardStage;
  if (!stage) return;

  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  // Повний шлях: "Лекція 1" під maths і під фізикою — різні картки.
  elements.previewModalTitle.textContent = deckPathString(deck, appState.decks) || 'Перегляд карток';

  if (!cards.length) {
    stage.classList.add('hidden');
    elements.previewEmptyState.classList.remove('hidden');
    elements.previewPosition.textContent = 'Карток немає';
    elements.previewPrevButton.disabled = true;
    elements.previewNextButton.disabled = true;
    elements.previewFlipButton.disabled = true;
    return;
  }

  stage.classList.remove('hidden');
  elements.previewEmptyState.classList.add('hidden');
  elements.previewPrevButton.disabled = cards.length < 2;
  elements.previewNextButton.disabled = cards.length < 2;
  elements.previewFlipButton.disabled = false;

  const names = resolveFieldNames(cards, deck.fieldNames);
  const { front, back } = buildPreviewFaces(cards[index], names);
  elements.previewCardFront.innerHTML = front;
  elements.previewCardBack.innerHTML = back;
  // Поля екрановані від HTML, але LaTeX-роздільники лишились живими текстом,
  // тож MathJax дотипується саме сюди — і прев'ю показує формули так само,
  // як Anki після імпорту. Типсетимо стаді: там лежать обидві сторони.
  typesetMath(stage);
  stage.dataset.flipped = flipped ? 'true' : 'false';
  elements.previewPosition.textContent = `Картка ${index + 1} з ${cards.length}`;
  elements.previewFlipButton.textContent = flipped ? 'Показати лицьову' : 'Перевернути';

  // Користувацький CSS — лише тут і лише під прев'ю.
  applyPreviewCss(deck.modelCss);
}

function applyPreviewCss(css) {
  let style = document.getElementById('deckPreviewUserCss');
  if (!style) {
    style = document.createElement('style');
    style.id = 'deckPreviewUserCss';
    document.head.appendChild(style);
  }
  style.textContent = scopePreviewCss(css, PREVIEW_SCOPE);
}

function openDeckPreview(deckId) {
  const deck = appState.decks.find((item) => item.id === deckId);
  if (!deck) {
    showToast('Колоду не знайдено', 'error');
    return;
  }
  previewState = { deck, index: 0, flipped: false };
  elements.previewModal.classList.remove('hidden');
  elements.previewModal.classList.add('flex');
  renderPreview();
  refreshIcons(elements.previewModal);
  elements.closePreviewButton.focus();
  haptic();
}

function closeDeckPreview() {
  if (!elements.previewModal) return;
  elements.previewModal.classList.add('hidden');
  elements.previewModal.classList.remove('flex');
  previewState = null;
}

function flipPreviewCard() {
  if (!previewState || !(previewState.deck.cards || []).length) return;
  previewState.flipped = !previewState.flipped;
  renderPreview();
  haptic();
}

function navigatePreviewCard(direction) {
  if (!previewState) return;
  const cards = previewState.deck.cards || [];
  if (!cards.length) return;
  const next = (previewState.index + direction + cards.length) % cards.length;
  previewState.index = next;
  previewState.flipped = false;
  renderPreview();
  haptic();
}
