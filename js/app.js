const API_BASE_URL = window.ANKI_API_BASE_URL || 'http://127.0.0.1:8000';
const STORAGE_KEY = 'anki-gemini-decks-v1';
const MESSAGES_KEY = 'anki-gemini-messages-v1';
const THEME_KEY = 'anki-gemini-theme-v1';
const MAX_FILE_SIZE = 8 * 1024 * 1024;
// Має збігатися з SUPPORTED_MIME на сервері. .docx прибрано: Gemini не
// розбирає його з байтів, тож файл проходив би перевірку в браузері й падав
// уже всередині запиту.
const ALLOWED_EXTENSIONS = ['txt', 'md', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'];
const desktopQuery = window.matchMedia('(min-width: 768px)');

const elements = {
  sidebar: document.getElementById('sidebar'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  openSidebarButton: document.getElementById('openSidebarButton'),
  closeSidebarButton: document.getElementById('closeSidebarButton'),
  themeToggleButton: document.getElementById('themeToggleButton'),
  myDecksButton: document.getElementById('myDecksButton'),
  deckListPanel: document.getElementById('deckListPanel'),
  deckList: document.getElementById('deckList'),
  deckSummary: document.getElementById('deckSummary'),
  emptyDecksState: document.getElementById('emptyDecksState'),
  editorPanel: document.getElementById('editorPanel'),
  editorBackButton: document.getElementById('editorBackButton'),
  editorDeckTitle: document.getElementById('editorDeckTitle'),
  editorDeckPath: document.getElementById('editorDeckPath'),
  editorCardSelect: document.getElementById('editorCardSelect'),
  previousCardButton: document.getElementById('previousCardButton'),
  nextCardButton: document.getElementById('nextCardButton'),
  editorCardPosition: document.getElementById('editorCardPosition'),
  editorFields: document.getElementById('editorFields'),
  editorModelCss: document.getElementById('editorModelCss'),
  deckStyleToggle: document.getElementById('deckStyleToggle'),
  deckStylePanel: document.getElementById('deckStylePanel'),
  deckStyleChevron: document.getElementById('deckStyleChevron'),
  editorStyleName: document.getElementById('editorStyleName'),
  openStylesButton: document.getElementById('openStylesButton'),
  saveDeckStyleButton: document.getElementById('saveDeckStyleButton'),
  styleModal: document.getElementById('styleModal'),
  styleModalDeckName: document.getElementById('styleModalDeckName'),
  styleList: document.getElementById('styleList'),
  closeStyleModalButton: document.getElementById('closeStyleModalButton'),
  cancelStyleModalButton: document.getElementById('cancelStyleModalButton'),
  newStyleName: document.getElementById('newStyleName'),
  createStyleButton: document.getElementById('createStyleButton'),
  generationStylePicker: document.getElementById('generationStylePicker'),
  generationStyleButton: document.getElementById('generationStyleButton'),
  generationStyleLabel: document.getElementById('generationStyleLabel'),
  generationStyleChevron: document.getElementById('generationStyleChevron'),
  generationStyleList: document.getElementById('generationStyleList'),
  saveCardButton: document.getElementById('saveCardButton'),
  addCardButton: document.getElementById('addCardButton'),
  deleteCardButton: document.getElementById('deleteCardButton'),
  clearDeckButton: document.getElementById('clearDeckButton'),
  messages: document.getElementById('messages'),
  chatSwitcherButton: document.getElementById('chatSwitcherButton'),
  activeChatTitle: document.getElementById('activeChatTitle'),
  chatPanel: document.getElementById('chatPanel'),
  chatList: document.getElementById('chatList'),
  newChatButton: document.getElementById('newChatButton'),
  chatForm: document.getElementById('chatForm'),
  messageInput: document.getElementById('messageInput'),
  sendButton: document.getElementById('sendButton'),
  fileInput: document.getElementById('fileInput'),
  attachButton: document.getElementById('attachButton'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  attachmentName: document.getElementById('attachmentName'),
  attachmentSize: document.getElementById('attachmentSize'),
  removeAttachmentButton: document.getElementById('removeAttachmentButton'),
  deckModal: document.getElementById('deckModal'),
  closeDeckModalButton: document.getElementById('closeDeckModalButton'),
  cancelDeckModalButton: document.getElementById('cancelDeckModalButton'),
  confirmDeckModalButton: document.getElementById('confirmDeckModalButton'),
  confirmDeckModalText: document.getElementById('confirmDeckModalText'),
  deckModalTitle: document.getElementById('deckModalTitle'),
  deckModalDescription: document.getElementById('deckModalDescription'),
  saveDeckOptionsWrap: document.getElementById('saveDeckOptionsWrap'),
  saveDeckOptions: document.getElementById('saveDeckOptions'),
  newDeckFieldWrap: document.getElementById('newDeckFieldWrap'),
  newDeckName: document.getElementById('newDeckName'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalText: document.getElementById('confirmModalText'),
  cancelConfirmButton: document.getElementById('cancelConfirmButton'),
  acceptConfirmButton: document.getElementById('acceptConfirmButton'),
  previewModal: document.getElementById('previewModal'),
  previewModalTitle: document.getElementById('previewModalTitle'),
  closePreviewButton: document.getElementById('closePreviewButton'),
  previewCardStage: document.getElementById('previewCardStage'),
  previewCardFront: document.getElementById('previewCardFront'),
  previewCardBack: document.getElementById('previewCardBack'),
  previewEmptyState: document.getElementById('previewEmptyState'),
  previewPosition: document.getElementById('previewPosition'),
  previewPrevButton: document.getElementById('previewPrevButton'),
  previewNextButton: document.getElementById('previewNextButton'),
  previewFlipButton: document.getElementById('previewFlipButton'),
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toastText'),
  toastIcon: document.getElementById('toastIcon'),
  storageStatusText: document.getElementById('storageStatusText'),
  storageStatusDot: document.getElementById('storageStatusDot')
};

const appState = {
  decks: loadDecks(),
  activeDeckId: 'cpp-basic',
  editorDeckId: null,
  editorCardId: null,
  selectedFile: null,
  drawerOpen: false,
  modalMode: 'create',
  pendingCards: [],
  pendingFieldNames: [],
  pendingModelCss: '',
  pendingTemplates: [],
  // Колода та стиль, які зараз редагуються у вікні стилів. Окремо від
  // editorDeckId, бо вікно стилів можна закрити, а редактор лишається
  // відкритим — і навпаки.
  styleDeckId: null,
  renamingStyleId: null,
  // Стиль, який згоден взяти Gemini для нової генерації ('' = авто).
  generationStyleId: loadGenerationStyleId(),
  selectedModalDeckId: null,
  pendingParentId: null,
  // Згорнуті гілки. Set, а не масив: пошук у ньому відбувається на кожен
  // клік під час рендеру, а не один раз.
  collapsedDeckIds: new Set(),
  pendingConfirm: null,
  toastTimer: null,
  // Список чатів. Перший елемент створюється нижче через loadChatsLocally(),
  // але сам масив має бути в стані вже під час оголошення: до нього
  // звертаються функції з decks.js.
  chats: [],
  activeChatId: null,
  messages: [
    {
      id: 'welcome-message',
      role: 'assistant',
      type: 'text',
      content: '## Привіт! 👋\nЯ допоможу перетворити ваші нотатки на **якісні картки Anki**.\n\nМожна надіслати текст, прикріпити фото дошки або файл `.txt`, `.pdf`, `.md`, `.csv`, а також попросити скласти короткий Markdown-конспект.\n\nКожна тема живе в окремому чаті: створіть новий чат у шапці, щоб не змішувати матеріали з різних предметів.',
      createdAt: Date.now()
    },
    {
      id: 'example-cards-message',
      role: 'assistant',
      type: 'cards',
      content: '### Приклад карток\nНатисніть на картку, щоб побачити відповідь, або збережіть їх у власну колоду.',
      createdAt: Date.now(),
      fieldNames: ['Front', 'Back', 'Extra'],
      cards: [
        { values: { Front: 'Що таке компілятор?', Back: 'Програма, яка перетворює вихідний код мови програмування на машинний код або проміжкове представлення.', Extra: 'Приклади: GCC, Clang, MSVC.' } },
        { values: { Front: 'Де проходить компіляція C++?', Back: 'У компіляторі та компіляторі GCC, після чого готовий виконуваний файл запускається процесором.', Extra: 'Для онлайн-редагування часто використовують сучасний стандарт C++.' } }
      ]
    }
  ]
};

// Приводимо chats/activeChatId/messages у відповідність зі сховищем одразу
// під час старту. messages нижче — це лише привітання для випадку, коли
// збереженої переписки ще немає; loadChatsLocally() підставляє його в
// перший чат і замінює appState.messages на його власний масив.
loadChatsLocally(appState.messages);

/**
 * Ідентифікатор картки/колоди.
 *
 * Повертається гола UUID без префікса: значення потрапляє в
 * notes.id/decks.id, а це uuid PRIMARY KEY. Старі 'card-<uuid>' з
 * localStorage знімаються в migrateDeck через normalizeUuid.
 */
function createId() {
  return newUuid();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function resolveTheme() {
  const attribute = document.documentElement.getAttribute('data-theme');
  if (attribute === 'light' || attribute === 'dark') return attribute;
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.color = 'var(--app-bg)';
  document.documentElement.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  const parts = resolved.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return 'light';
  const luminance = (Number(parts[0]) * 299 + Number(parts[1]) * 587 + Number(parts[2]) * 114) / 1000;
  return luminance < 128 ? 'dark' : 'light';
}

const THEME_COLORS = {
  light: '#f8fafc',
  dark: '#0f172a'
};

function syncThemeButton() {
  const isDark = resolveTheme() === 'dark';
  const icon = elements.themeToggleButton.querySelector('[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    refreshIcons(elements.themeToggleButton);
  }
  const label = isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
  elements.themeToggleButton.setAttribute('aria-label', label);
  elements.themeToggleButton.setAttribute('title', label);
  elements.themeToggleButton.setAttribute('aria-pressed', String(isDark));
}

function syncBrowserThemeColor(theme) {
  const color = THEME_COLORS[theme] || THEME_COLORS.dark;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
  document.documentElement.style.setProperty('--app-chrome', color);
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
  }
  syncBrowserThemeColor(next);
  syncThemeButton();
}

function toggleTheme() {
  applyTheme(resolveTheme() === 'dark' ? 'light' : 'dark');
  haptic();
  showToast(resolveTheme() === 'dark' ? 'Увімкнено темну тему' : 'Увімкнено світлу тему');
}

function showToast(text, type = 'success') {
  window.clearTimeout(appState.toastTimer);
  elements.toastText.textContent = text;
  elements.toastIcon.setAttribute('data-lucide', type === 'error' ? 'circle-x' : type === 'warning' ? 'triangle-alert' : 'check-circle-2');
  elements.toastIcon.className = `h-4 w-4 shrink-0 ${type === 'error' ? 'text-red-500' : type === 'warning' ? 'text-amber-500' : 'text-emerald-500'}`;
  refreshIcons(elements.toast);
  elements.toast.classList.add('is-visible');
  appState.toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2800);
}

function formatRelativeDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= dayStart) {
    return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (date.getTime() >= dayStart - 604800000) {
    return new Intl.DateTimeFormat('uk-UA', { weekday: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short' }).format(date);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function openDrawer() {
  if (desktopQuery.matches) return;
  appState.drawerOpen = true;
  elements.sidebar.classList.add('drawer-open');
  elements.drawerBackdrop.classList.remove('hidden');
  elements.drawerBackdrop.classList.add('fade-enter');
}

function closeDrawer() {
  appState.drawerOpen = false;
  elements.sidebar.classList.remove('drawer-open');
  elements.drawerBackdrop.classList.add('hidden');
}

function openConfirmModal(title, text, action) {
  appState.pendingConfirm = action;
  elements.confirmModalTitle.textContent = title;
  elements.confirmModalText.textContent = text;
  elements.confirmModal.classList.remove('hidden');
  elements.confirmModal.classList.add('flex');
  window.setTimeout(() => elements.cancelConfirmButton.focus(), 80);
}

function closeConfirmModal() {
  elements.confirmModal.classList.add('hidden');
  elements.confirmModal.classList.remove('flex');
  appState.pendingConfirm = null;
}

function getApiUrl(path) {
  const base = String(API_BASE_URL || '').trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

async function getAccessToken() {
  try {
    const module = window.AnkiAuth;
    if (!module || typeof module.getAccessToken !== 'function') return null;
    return await module.getAccessToken();
  } catch (err) {
    return null;
  }
}

/**
 * Текст помилки з тіла відповіді.
 *
 * FastAPI повертає {"detail": "..."}, і без цього користувач бачив би
 * лише «Request failed with status 409». Для ієрархії це різниця між
 * «назва вже зайнята» (треба придумати іншу) і «не можна вкласти
 * колоду в саму себе» (треба обрати іншу гілку) — два різні кроки
 * виправлення за одним і тим самим кодом.
 */
async function readErrorDetail(response) {
  try {
    const data = await response.clone().json();
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === 'string') return data.detail[0].msg;
  } catch (_) {
    // Не JSON або порожнє тіло — не критично, залишимо загальний текст.
  }
  return '';
}

async function apiFetch(path, options = {}) {
  const { body, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const token = await getAccessToken();
  const response = await fetch(getApiUrl(path), {
    ...rest,
    headers: {
      Accept: isFormData ? '*/*' : 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(headers || {})
    },
    body
  });
  if (response.status === 401) {
    window.AnkiAuth?.signOut();
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const error = new Error(detail || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function apiRequestJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : null;
}

async function sendToBackend(type, payload = {}) {
  const path = `/api/${String(type).replace(/_/g, '-')}`;
  try {
    const data = await apiRequestJson(path, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error, status: error.status || 0 };
  }
}

elements.openSidebarButton.addEventListener('click', openDrawer);
elements.themeToggleButton.addEventListener('click', toggleTheme);
elements.closeSidebarButton.addEventListener('click', closeDrawer);
elements.drawerBackdrop.addEventListener('click', closeDrawer);
elements.chatSwitcherButton.addEventListener('click', () => toggleChatPanel());
elements.newChatButton.addEventListener('click', () => {
  createChat();
  renderChatState();
  toggleChatPanel(false);
  elements.messageInput.focus();
  showToast('Новий чат створено');
  haptic();
});

elements.chatList.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const chatId = button.dataset.chatId;
  if (button.dataset.action === 'select-chat') {
    switchChat(chatId);
    toggleChatPanel(false);
    elements.messageInput.focus();
    haptic();
  } else if (button.dataset.action === 'rename-chat') {
    event.stopPropagation();
    startChatRename(chatId);
  } else if (button.dataset.action === 'delete-chat') {
    event.stopPropagation();
    requestChatDelete(chatId);
  }
});

// Клік поза панеллю закриває її. Слухач на документі, а не на main: інакше
// клік у самій панеллю (перемикання чату) вважався б зовнішнім і закривав
// список до того, як користувач встиг би обрати чат.
document.addEventListener('click', event => {
  if (!isChatPanelOpen()) return;
  if (elements.chatPanel.contains(event.target) || elements.chatSwitcherButton.contains(event.target)) return;
  toggleChatPanel(false);
});
elements.myDecksButton.addEventListener('click', () => {
  showDeckList();
  if (!desktopQuery.matches) openDrawer();
});

// Клік поза списком стилів закриває його. Як і з панеллю чатів, слухач на
// документі: клік у самій кнопці має перемикати список, а не закривати його.
document.addEventListener('click', event => {
  if (!isGenerationStyleListOpen()) return;
  if (elements.generationStylePicker.contains(event.target)) return;
  closeGenerationStyleList();
});

elements.deckList.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const deckId = button.dataset.deckId;
  if (button.dataset.action === 'select-deck') {
    appState.activeDeckId = deckId;
    renderDecks();
    showToast(`Обрано: ${appState.decks.find(deck => deck.id === deckId)?.title || 'колоду'}`);
    haptic();
    if (!desktopQuery.matches) closeDrawer();
  } else if (button.dataset.action === 'edit-deck') {
    openEditor(deckId);
  } else if (button.dataset.action === 'preview-deck') {
    openDeckPreview(deckId);
  } else if (button.dataset.action === 'download-deck') {
    downloadDeck(deckId);
  } else if (button.dataset.action === 'delete-deck') {
    requestDeleteDeck(deckId);
  } else if (button.dataset.action === 'toggle-deck-node') {
    // Подія не сходить до select-deck: розкривачка — не вибір колоди,
    // інакше кожне розгортання ще й перемикало б активну.
    event.stopPropagation();
    toggleDeckNode(deckId);
    haptic('light');
  } else if (button.dataset.action === 'new-subdeck') {
    openDeckModal('create', [], {}, deckId);
    if (!desktopQuery.matches) closeDrawer();
  }
});

// Перенесення колоди в іншу гілку. Обробник на 'change', а не на 'click':
// select не повідомляє про зміну при mouse down, тож клік зловив би
// попереднє значення і переніс би колоду не туди.
elements.deckList.addEventListener('change', event => {
  const select = event.target.closest('.deck-parent-select');
  if (!select) return;
  moveDeckToParent(select.dataset.deckId, select.value || null);
});

elements.editorBackButton.addEventListener('click', () => {
  showDeckList();
  if (!desktopQuery.matches) openDrawer();
});

elements.closePreviewButton.addEventListener('click', closeDeckPreview);
elements.previewFlipButton.addEventListener('click', flipPreviewCard);
elements.previewPrevButton.addEventListener('click', () => navigatePreviewCard(-1));
elements.previewNextButton.addEventListener('click', () => navigatePreviewCard(1));

// Клік по самій картці перевертає її — так само, як у решті застосунку.
[elements.previewCardFront, elements.previewCardBack].forEach((side) => {
  side.addEventListener('click', flipPreviewCard);
  side.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flipPreviewCard();
    }
  });
});

elements.previewModal.addEventListener('click', (event) => {
  // Закриття по затемненню, але не коли клікнули всередині модалки.
  if (event.target === elements.previewModal) closeDeckPreview();
});

// Стрілки перемикають картки, як у самому Anki.
document.addEventListener('keydown', (event) => {
  if (!previewState) return;
  if (event.key === 'Escape') {
    closeDeckPreview();
    return;
  }
  if (event.key === 'ArrowLeft') navigatePreviewCard(-1);
  if (event.key === 'ArrowRight') navigatePreviewCard(1);
  if (event.key === ' ' || event.key === 'Enter') {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    event.preventDefault();
    flipPreviewCard();
  }
});
elements.editorCardSelect.addEventListener('change', event => {
  appState.editorCardId = event.target.value;
  renderEditor();
});
elements.previousCardButton.addEventListener('click', () => navigateEditorCard(-1));
elements.nextCardButton.addEventListener('click', () => navigateEditorCard(1));
elements.saveCardButton.addEventListener('click', saveEditorCard);
elements.addCardButton.addEventListener('click', addEditorCard);
elements.deleteCardButton.addEventListener('click', requestDeleteCard);
elements.saveDeckStyleButton.addEventListener('click', saveDeckStyle);
elements.clearDeckButton.addEventListener('click', requestClearDeckCards);
elements.deckStyleToggle.addEventListener('click', toggleDeckStylePanel);
elements.editorModelCss.addEventListener('input', markDeckStyleDirty);

// Стиль для нових карток. Власний список замість <select>, тож події
// делегуємо на контейнер: DOM перемальовується на кожному відкритті.
// Клік поза межами закриває список — інакше він лишався б висити поверх
// чату, якщо користувач клацнув деінде.
elements.generationStyleButton.addEventListener('click', toggleGenerationStyleList);
elements.generationStyleList.addEventListener('click', event => {
  const option = event.target.closest('[data-generation-style]');
  if (!option) return;
  event.stopPropagation();
  pickGenerationStyle(option.dataset.generationStyle);
});
elements.generationStyleList.addEventListener('keydown', handleGenerationStyleListKeydown);
// На закритій кнопці Enter/стрілка вниз відкривають список — інакше з
// клавіатури до нього не достукатися: Tab доходить, а далі глухо.
elements.generationStyleButton.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  openGenerationStyleList();
});

// Вікно стилів. Кліки делегуємо на список: рядки стилів перемальовуються
// після кожної дії, і слухач на кожному рядку довелося б переписувати.
elements.openStylesButton.addEventListener('click', openStyleModal);
elements.closeStyleModalButton.addEventListener('click', closeStyleModal);
elements.cancelStyleModalButton.addEventListener('click', closeStyleModal);
elements.createStyleButton.addEventListener('click', createDeckStyle);
elements.newStyleName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createDeckStyle();
});
elements.styleList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const styleId = button.dataset.styleId;
  if (button.dataset.action === 'apply-style') applyDeckStyle(styleId);
  else if (button.dataset.action === 'rename-style') startStyleRename(styleId);
  else if (button.dataset.action === 'cancel-rename-style') {
    appState.renamingStyleId = null;
    renderStyleList();
  } else if (button.dataset.action === 'save-style-name') {
    commitStyleRename(styleId, styleNameInputValue(styleId));
  } else if (button.dataset.action === 'delete-style') {
    requestDeleteDeckStyle(styleId);
  }
});

document.getElementById('addDeckButton').addEventListener('click', () => {
  // null, а не активна колода: кнопка «+» поруч зі списком має створювати
  // на верхньому рівні, а підколода — через «folder-plus» у картці.
  openDeckModal('create', [], {}, null);
});
elements.closeDeckModalButton.addEventListener('click', closeDeckModal);
elements.cancelDeckModalButton.addEventListener('click', closeDeckModal);
elements.confirmDeckModalButton.addEventListener('click', confirmDeckModal);
elements.newDeckName.addEventListener('input', () => {
  if (appState.modalMode === 'save' && elements.newDeckName.value.trim()) {
    appState.selectedModalDeckId = null;
    elements.saveDeckOptions.querySelectorAll('.deck-option').forEach(option => {
      option.classList.remove('is-selected');
      const icon = option.querySelector('[data-lucide="check-circle-2"]');
      if (icon) icon.classList.add('hidden');
    });
  }
});
elements.saveDeckOptions.addEventListener('click', event => {
  const option = event.target.closest('.deck-option');
  if (!option) return;
  const radio = option.querySelector('input[type="radio"]');
  if (!radio) return;
  appState.selectedModalDeckId = radio.value;
  elements.newDeckName.value = '';
  renderDeckOptions();
});

elements.cancelConfirmButton.addEventListener('click', closeConfirmModal);
elements.acceptConfirmButton.addEventListener('click', async () => {
  const action = appState.pendingConfirm;
  closeConfirmModal();
  if (action) await action();
});

elements.messages.addEventListener('click', event => {
  const card = event.target.closest('.flip-card');
  if (card) {
    card.classList.toggle('is-flipped');
    haptic('light');
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'save-message-cards') {
    const message = appState.messages.find(item => item.id === button.dataset.messageId);
    if (message?.cards?.length) {
      openDeckModal('save', message.cards, {
        fieldNames: message.fieldNames,
        css: message.modelCss,
        templates: message.templates
      });
    }
  } else if (button.dataset.action === 'retry-chat') {
    retryChat();
  }
});

elements.chatForm.addEventListener('submit', event => {
  event.preventDefault();
  submitChat();
});

elements.messageInput.addEventListener('input', updateMessageInput);
elements.messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});

elements.attachButton.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    showToast('Підтримуються фото (.png, .jpg, .webp) та файли .txt, .md, .csv, .pdf', 'error');
    elements.fileInput.value = '';
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast(`Файл завеликий. Максимум ${MAX_FILE_SIZE / (1024 * 1024)} МБ`, 'error');
    elements.fileInput.value = '';
    return;
  }
  appState.selectedFile = file;
  showAttachment();
  updateMessageInput();
  haptic();
});
elements.removeAttachmentButton.addEventListener('click', clearAttachment);

elements.deckModal.addEventListener('click', event => {
  if (event.target === elements.deckModal) closeDeckModal();
});
elements.confirmModal.addEventListener('click', event => {
  if (event.target === elements.confirmModal) closeConfirmModal();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (elements.confirmModal.classList.contains('flex')) closeConfirmModal();
  else if (elements.deckModal.classList.contains('flex')) closeDeckModal();
  else if (isChatPanelOpen()) toggleChatPanel(false);
  else if (appState.drawerOpen) closeDrawer();
});

desktopQuery.addEventListener('change', event => {
  if (event.matches) {
    closeDrawer();
  } else if (appState.editorDeckId) {
    openDrawer();
  }
});

registerRuntimeEvents();

if (!appState.decks.length) {
  appState.decks = cloneDefaults();
}

if (!appState.decks.some(deck => deck.id === appState.activeDeckId)) {
  appState.activeDeckId = appState.decks[0]?.id || null;
}

renderDecks();
renderMessages();
renderChatList();
renderActiveChatTitle();
updateMessageInput();
syncBrowserThemeColor(resolveTheme());
syncThemeButton();

// Вхід. Стартовий рендер вище навмисно залишили без залежності від
// сесії: щоб щось було видно, навіть якщо запит до /api/config
// не пройде. Далі вже показуємо або вхід, або застосунок.
const auth = window.AnkiAuth;
const loginScreen = document.getElementById('loginScreen');
const appRoot = document.getElementById('app');

function showLogin(message) {
  if (loginScreen) loginScreen.hidden = false;
  if (appRoot) appRoot.hidden = true;
  const errorBox = document.getElementById('loginError');
  if (errorBox) {
    errorBox.textContent = message || '';
    errorBox.classList.toggle('hidden', !message);
  }
  document.getElementById('loginPassword')?.focus();
}

function showApp() {
  if (loginScreen) loginScreen.hidden = true;
  if (appRoot) appRoot.hidden = false;
}

function initialsOf(email) {
  const name = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name || '?').slice(0, 2).toUpperCase();
}

function renderUserProfile(session) {
  const email = session && session.email ? session.email : '';
  const initials = email ? initialsOf(email) : '—';
  const name = email || 'Не авторизовано';
  const status = email ? 'Синхронізовано з Supabase' : 'Вхід не виконано';

  [['sidebarAvatar', initials], ['headerAvatar', initials],
   ['sidebarUserName', name], ['headerUserName', name],
   ['sidebarUserStatus', status], ['headerUserStatus', status]
  ].forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
}

function setLoginBusy(busy) {
  const button = document.getElementById('loginButton');
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? 'Перевіряємо…' : 'Увійти';
}

if (auth) {
  auth.setSessionLostHandler(() => {
    showLogin('Сесія завершилася. Увійдіть знову.');
  });

  document.getElementById('loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    setLoginBusy(true);
    showLogin('');
    auth.signIn(email, password)
      .then((session) => {
        document.getElementById('loginPassword').value = '';
        renderUserProfile(session);
        // Спершу перемикаємо кеш на цього користувача: у пам'яті ще могли
        // лежати колоди попереднього акаунту. Синхронізація далі.
        switchToCurrentUserCache();
        showApp();
        return syncDecksFromServer().catch((error) => {
          showToast(`Не вдалося оновити колоди: ${error.message || error}`, 'error');
        });
      })
      .catch((error) => showLogin(error.message || 'Не вдалося увійти'))
      .finally(() => setLoginBusy(false));
  });

  document.getElementById('logoutButton')?.addEventListener('click', () => {
    auth.signOutRemotely().finally(() => {
      renderUserProfile(null);
      showLogin('');
    });
  });

  const existing = auth.getSession();
  if (existing) {
    renderUserProfile(existing);
    // Поки токен не підтверджено — показуємо форму входу, щоб не мигав
    // застосунок із простроченою або відкликаною сесією.
    showLogin('');
    auth.getAccessToken()
      .then((token) => {
        if (!token) {
          showLogin('');
          return undefined;
        }
        switchToCurrentUserCache();
        showApp();
        // Помилка синхронізації — це не кінець сесії. Сесія справжня,
        // тож залишаємо користувача в застосунку і показуємо помилку.
        return syncDecksFromServer().catch((error) => {
          showToast(`Не вдалося оновити колоди: ${error.message || error}`, 'error');
        });
      })
      .catch(() => showLogin('Сесія завершилася. Увійдіть знову.'));
  } else {
    renderUserProfile(null);
    showLogin('');
  }
} else {
  showLogin('Не вдалося завантажити модуль входу. Перезавантажте сторінку.');
}
refreshIcons();
