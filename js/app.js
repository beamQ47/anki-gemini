// Адреса бекенду. Локально index.html і API віддає один процес, тож
// достатньо same-origin. На GitHub Pages бекенд окремий — Render.
// Для інших випадків лишається ручний override:
//   window.ANKI_API_BASE_URL = 'http://127.0.0.1:8000';
const LOCAL_API_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const API_BASE_URL = window.ANKI_API_BASE_URL ||
  (typeof location !== 'undefined' && LOCAL_API_HOSTS.has(location.hostname)
    ? ''
    : 'https://anki-gemini-api.onrender.com');
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
  stylesNavButton: document.getElementById('stylesNavButton'),
  deckWindow: document.getElementById('deckWindow'),
  editorPanel: document.getElementById('editorPanel'),
  editorBackButton: document.getElementById('editorBackButton'),
  editorDeckTitle: document.getElementById('editorDeckTitle'),
  editorDeckPath: document.getElementById('editorDeckPath'),
  deckTabs: document.getElementById('deckTabs'),
  deckTabCards: document.getElementById('deckTabCards'),
  deckTabStyle: document.getElementById('deckTabStyle'),
  deckTabSettings: document.getElementById('deckTabSettings'),
  deckCardsPane: document.getElementById('deckCardsPane'),
  deckStylePane: document.getElementById('deckStylePane'),
  deckSettingsPane: document.getElementById('deckSettingsPane'),
  deckSettingsCardCount: document.getElementById('deckSettingsCardCount'),
  deckSettingsStyleName: document.getElementById('deckSettingsStyleName'),
  deckSettingsPreviewButton: document.getElementById('deckSettingsPreviewButton'),
  deckSettingsDownloadButton: document.getElementById('deckSettingsDownloadButton'),
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
  deckStyleNameInput: document.getElementById('deckStyleNameInput'),
  deckStyleList: document.getElementById('deckStyleList'),
  createDeckStyleButton: document.getElementById('createDeckStyleButton'),
  openStylesButton: document.getElementById('openStylesButton'),
  saveDeckStyleButton: document.getElementById('saveDeckStyleButton'),
  styleModal: document.getElementById('styleModal'),
  styleModalDeckName: document.getElementById('styleModalDeckName'),
  styleList: document.getElementById('styleList'),
  styleEditorWrap: document.getElementById('styleEditorWrap'),
  styleEditorName: document.getElementById('styleEditorName'),
  styleEditorCss: document.getElementById('styleEditorCss'),
  saveStyleEditorButton: document.getElementById('saveStyleEditorButton'),
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
  storageStatusDot: document.getElementById('storageStatusDot'),
  processDrawer: document.getElementById('processDrawer'),
  processDrawerBackdrop: document.getElementById('processDrawerBackdrop'),
  openProcessDrawerButton: document.getElementById('openProcessDrawerButton'),
  closeProcessDrawerButton: document.getElementById('closeProcessDrawerButton'),
  sidebarProcessButton: document.getElementById('sidebarProcessButton'),
  processDrawerStateBadge: document.getElementById('processDrawerStateBadge'),
  processActiveModelBadge: document.getElementById('processActiveModelBadge'),
  processCurrentStatusText: document.getElementById('processCurrentStatusText'),
  processCurrentDetailsText: document.getElementById('processCurrentDetailsText'),
  processModelChainList: document.getElementById('processModelChainList'),
  processModelChainCount: document.getElementById('processModelChainCount'),
  processEventLog: document.getElementById('processEventLog'),
  clearProcessLogButton: document.getElementById('clearProcessLogButton'),
  processLastLatency: document.getElementById('processLastLatency'),
  processHeaderPing: document.getElementById('processHeaderPing'),
  processHeaderDot: document.getElementById('processHeaderDot'),
  sidebarProcessBadge: document.getElementById('sidebarProcessBadge'),
  stepRequest: document.getElementById('stepRequest'),
  stepModelSearch: document.getElementById('stepModelSearch'),
  stepGeneration: document.getElementById('stepGeneration'),
  stepDone: document.getElementById('stepDone'),
  processControlCard: document.getElementById('processControlCard'),
  processRunningBadge: document.getElementById('processRunningBadge'),
  processControlIdleState: document.getElementById('processControlIdleState'),
  processControlActiveState: document.getElementById('processControlActiveState'),
  processActiveElapsed: document.getElementById('processActiveElapsed'),
  processActivePromptSnippet: document.getElementById('processActivePromptSnippet'),
  abortGenerationButton: document.getElementById('abortGenerationButton')
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
  // Колода та стиль, які зараз редагуються. deckStyleId не потрібен:
  // бібліотека спільна для акаунта, тож «колода, з якої відкрили стилі»
  // зберігається в styleDeckId лише для підпису й застосування.
  styleDeckId: null,
  // Спільна бібліотека стилів акаунта і вибраний для редагування рядок.
  styleLibrary: loadStylesLocally(),
  selectedStyleId: null,
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
  const { body, headers, retries = 2, retryDelayMs = 2000, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const token = await getAccessToken();
  const requestHeaders = {
    Accept: isFormData ? '*/*' : 'application/json',
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(headers || {})
  };

  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(getApiUrl(path), {
        ...rest,
        headers: requestHeaders,
        body
      });
      if (response.status === 401) {
        window.AnkiAuth?.signOut();
      }
      if (!response.ok) {
        // Якщо сервер повертає 502/503 (Render прокидається або перезапускається):
        if ((response.status === 502 || response.status === 503) && attempt < retries) {
          attempt++;
          await new Promise(r => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        const detail = await readErrorDetail(response);
        const error = new Error(detail || `Request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response;
    } catch (err) {
      // Мережевий обрив (Failed to fetch або Render router disconnect):
      const isNetworkError = err && (err.name === 'TypeError' || /failed to fetch/i.test(err.message));
      if (isNetworkError && attempt < retries) {
        attempt++;
        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
        continue;
      }
      throw err;
    }
  }
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

// --- МОНІТОР ПРОЦЕСІВ ТА СТАНУ МОДЕЛЕЙ ШІ ---
function getModelTag(name, idx, total) {
  if (idx === 0) return 'Основна';
  if (idx === total - 1) return 'Фулбек';
  if (name.includes('hydrogen')) return 'Hydrogen';
  if (name.includes('3.8-flash')) return 'Розумна';
  if (name.includes('flash-lite')) return 'Швидка';
  return `Резерв ${idx}`;
}

const processState = {
  isOpen: false,
  status: 'idle',
  activeModel: 'gemini-flash-lite-latest',
  stepDescription: 'Система готова до роботи',
  lastModel: 'gemini-flash-lite-latest',
  lastLatencyMs: 600,
  step: 0,
  isGenerating: false,
  activeTaskPrompt: null,
  activeTaskStartTime: null,
  modelChain: [
    { name: 'gemini-flash-lite-latest', tag: 'Основна' },
    { name: 'gemini-3.5-flash-lite', tag: 'Швидка' },
    { name: 'gemini-3.1-flash-lite', tag: 'Зір/Файли' },
    { name: 'gemini-3.8-flash', tag: 'Розумна' },
    { name: 'gemini-3.6-flash', tag: 'Резерв' },
    { name: 'gemini-4-hydrogen', tag: 'Фулбек' }
  ],
  events: [
    {
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: 'Монітор процесів активовано. Черга моделей готова.',
      level: 'info'
    }
  ],
  pollTimer: null
};

function openProcessDrawer() {
  processState.isOpen = true;
  if (elements.processDrawer) {
    elements.processDrawer.classList.remove('-translate-x-full');
    elements.processDrawer.classList.add('translate-x-0');
  }
  if (elements.processDrawerBackdrop) {
    elements.processDrawerBackdrop.classList.remove('hidden');
  }
  if (appState.drawerOpen && typeof closeDrawer === 'function') {
    closeDrawer();
  }
  renderProcessDrawer();
  fetchProcessStatus();
  startProcessPolling();
}

function closeProcessDrawer() {
  processState.isOpen = false;
  if (elements.processDrawer) {
    elements.processDrawer.classList.add('-translate-x-full');
    elements.processDrawer.classList.remove('translate-x-0');
  }
  if (elements.processDrawerBackdrop) {
    elements.processDrawerBackdrop.classList.add('hidden');
  }
  stopProcessPolling();
}

function toggleProcessDrawer() {
  if (processState.isOpen) closeProcessDrawer();
  else openProcessDrawer();
}

function updateStepUI(stepId, isComplete, isActive) {
  const el = elements[stepId];
  if (!el) return;
  const dot = el.querySelector('.step-dot');
  if (isActive) {
    el.className = 'flex items-center gap-2.5 text-xs text-violet-400 font-bold';
    if (dot) {
      dot.className = 'step-dot flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-extrabold ring-2 ring-violet-500/50 animate-pulse';
    }
  } else if (isComplete) {
    el.className = 'flex items-center gap-2.5 text-xs text-emerald-400 font-medium';
    if (dot) {
      dot.className = 'step-dot flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold';
      dot.textContent = '✓';
    }
  } else {
    el.className = 'flex items-center gap-2.5 text-xs text-app-hint';
    if (dot) {
      dot.className = 'step-dot flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app-hint/15 text-app-hint text-[10px] font-bold';
      const num = stepId === 'stepRequest' ? '1' : stepId === 'stepModelSearch' ? '2' : stepId === 'stepGeneration' ? '3' : '4';
      dot.textContent = num;
    }
  }
}

function renderProcessDrawer() {
  if (!elements.processDrawer) return;

  const isBusy = processState.status === 'searching' || processState.status === 'generating';
  const isErr = processState.status === 'error';

  let badgeText = 'Вільний';
  let badgeClasses = 'bg-emerald-500/15 text-emerald-500';
  let dotColor = 'bg-emerald-500';

  if (isBusy) {
    badgeText = processState.status === 'searching' ? 'Пошук моделі...' : 'Генерація...';
    badgeClasses = 'bg-violet-500/15 text-violet-400';
    dotColor = 'bg-violet-400';
  } else if (isErr) {
    badgeText = 'Помилка';
    badgeClasses = 'bg-red-500/15 text-red-500';
    dotColor = 'bg-red-500';
  }

  if (elements.processDrawerStateBadge) {
    elements.processDrawerStateBadge.textContent = badgeText;
    elements.processDrawerStateBadge.className = `rounded-full px-2 py-0.5 text-[10px] font-extrabold ${badgeClasses}`;
  }
  if (elements.sidebarProcessBadge) {
    elements.sidebarProcessBadge.textContent = isBusy ? 'Активний' : 'Готовий';
    elements.sidebarProcessBadge.className = `rounded-full px-2 py-0.5 text-[10px] font-extrabold ${badgeClasses}`;
  }
  if (elements.processHeaderDot) {
    elements.processHeaderDot.className = `relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`;
  }
  if (elements.processHeaderPing) {
    if (isBusy) elements.processHeaderPing.classList.remove('hidden');
    else elements.processHeaderPing.classList.add('hidden');
  }

  if (elements.processModelChainCount) {
    elements.processModelChainCount.textContent = `черга 1 → ${processState.modelChain.length}`;
  }
  if (elements.processActiveModelBadge) {
    elements.processActiveModelBadge.textContent = processState.activeModel || processState.lastModel || 'gemini-flash-lite-latest';
  }
  if (elements.processCurrentStatusText) {
    elements.processCurrentStatusText.textContent = processState.stepDescription || 'Очікування запиту';
  }
  if (elements.processCurrentDetailsText) {
    if (isBusy) {
      elements.processCurrentDetailsText.textContent = 'Здійснюється опитування моделей. При виникненні 503 чи затримок система автоматично перемикається на наступну в ланцюжку.';
    } else if (isErr) {
      elements.processCurrentDetailsText.textContent = 'Останній запит завершився з помилкою. Перевірте мережу або квоту.';
    } else {
      elements.processCurrentDetailsText.textContent = 'Система готова. При відправці запиту тут відобразиться пошук доступної моделі в реальному часі.';
    }
  }

  // Оновлення картки керування генерацією
  const isGenerating = Boolean(appState.isGenerating || processState.isGenerating || isBusy);
  if (elements.processRunningBadge) {
    if (isGenerating) {
      elements.processRunningBadge.classList.remove('hidden');
    } else {
      elements.processRunningBadge.classList.add('hidden');
    }
  }
  if (elements.processControlIdleState && elements.processControlActiveState) {
    if (isGenerating) {
      elements.processControlIdleState.classList.add('hidden');
      elements.processControlActiveState.classList.remove('hidden');
      if (elements.processActivePromptSnippet) {
        const snippet = appState.activeGenerationPrompt || processState.activeTaskPrompt || 'Запит обробляється...';
        elements.processActivePromptSnippet.textContent = snippet;
      }
      if (elements.processActiveElapsed) {
        const start = appState.activeGenerationStartTime || processState.activeTaskStartTime || Date.now();
        const sec = Math.max(0, Math.round((Date.now() - start) / 1000));
        elements.processActiveElapsed.textContent = `${sec} с`;
      }
    } else {
      elements.processControlIdleState.classList.remove('hidden');
      elements.processControlActiveState.classList.add('hidden');
    }
  }

  updateStepUI('stepRequest', processState.step >= 1, processState.step === 1);
  updateStepUI('stepModelSearch', processState.step >= 2, processState.step === 2);
  updateStepUI('stepGeneration', processState.step >= 3, processState.step === 3);
  updateStepUI('stepDone', processState.step >= 4, false);

  if (elements.processModelChainList) {
    elements.processModelChainList.innerHTML = processState.modelChain.map(m => {
      const isCurrent = (processState.activeModel === m.name && isBusy) || (processState.lastModel === m.name && !isBusy);
      const bg = isCurrent ? 'border-violet-500/40 bg-violet-500/10' : 'border-app-hint/10 bg-app-surface';
      const indicator = isCurrent
        ? '<span class="inline-flex h-2 w-2 rounded-full bg-violet-400 animate-pulse"></span>'
        : '<span class="inline-flex h-1.5 w-1.5 rounded-full bg-app-hint/30"></span>';
      return `
        <div class="flex items-center justify-between p-2 rounded-xl border ${bg} transition">
          <div class="flex items-center gap-2 min-w-0">
            ${indicator}
            <span class="font-mono text-[11px] font-bold truncate text-app-text">${m.name}</span>
          </div>
          <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${isCurrent ? 'bg-violet-500/20 text-violet-300' : 'text-app-hint bg-app-hint/10'}">${m.tag}</span>
        </div>
      `;
    }).join('');
  }

  if (elements.processEventLog) {
    elements.processEventLog.innerHTML = processState.events.map(ev => {
      let colorClass = 'text-app-hint';
      let icon = '•';
      if (ev.level === 'success') { colorClass = 'text-emerald-400 font-semibold'; icon = '✓'; }
      else if (ev.level === 'warning') { colorClass = 'text-amber-400'; icon = '▲'; }
      else if (ev.level === 'error') { colorClass = 'text-red-400 font-semibold'; icon = '✕'; }
      else if (ev.level === 'searching') { colorClass = 'text-violet-400'; icon = '🔍'; }
      const displayTime = ev.timestamp
        ? new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : (ev.time || '--:--:--');
      return `<div class="flex items-start gap-1.5 leading-snug"><span class="text-app-hint opacity-70 shrink-0">[${displayTime}]</span><span class="${colorClass}">${icon} ${escapeHtml(ev.text)}</span></div>`;
    }).join('');
  }

  if (elements.processLastLatency) {
    const lat = processState.lastLatencyMs ? (processState.lastLatencyMs / 1000).toFixed(2) + ' с' : '—';
    elements.processLastLatency.textContent = lat;
  }

  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

function addProcessEvent(text, level = 'info', model = null, timestamp = null) {
  const ts = typeof timestamp === 'number' ? timestamp : Date.now();
  const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isDuplicate = processState.events.slice(0, 3).some(e => e.text === text && Math.abs((e.timestamp || 0) - ts) < 2000);
  if (!isDuplicate) {
    processState.events.unshift({ timestamp: ts, time, text, level, model });
    processState.events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (processState.events.length > 50) processState.events.length = 50;
  }
  if (processState.isOpen) renderProcessDrawer();
}

function setProcessState(status, stepDesc, details) {
  processState.status = status;
  if (stepDesc) processState.stepDescription = stepDesc;
  renderProcessDrawer();
}

function setProcessStep(num) {
  processState.step = num;
  renderProcessDrawer();
}

function clearProcessLog() {
  processState.events = [];
  renderProcessDrawer();
}

async function fetchProcessStatus() {
  try {
    const token = typeof getAccessToken === 'function' ? await getAccessToken() : null;
    const res = await fetch(getApiUrl('/api/system/process-status'), {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;
    if (data.status && data.status !== 'idle') {
      processState.status = data.status;
    }
    if (data.active_model) processState.activeModel = data.active_model;
    if (data.step_description) processState.stepDescription = data.step_description;
    if (data.last_model) processState.lastModel = data.last_model;
    if (data.last_latency_ms) processState.lastLatencyMs = data.last_latency_ms;
    if (Array.isArray(data.model_chain) && data.model_chain.length) {
      processState.modelChain = data.model_chain.map((name, idx) => ({
        name,
        tag: getModelTag(name, idx, data.model_chain.length)
      }));
    }
    if (Array.isArray(data.events) && data.events.length) {
      let changed = false;
      for (const ev of data.events) {
        const evTs = typeof ev.timestamp === 'number' ? ev.timestamp : null;
        const exists = processState.events.some(e => {
          if (evTs && e.timestamp && Math.abs(e.timestamp - evTs) < 2000 && e.text === ev.text) return true;
          return e.text === ev.text && (e.time === ev.time || (e.text.includes('Монітор процесів') && ev.text.includes('Монітор процесів')));
        });
        if (!exists) {
          const displayTime = evTs
            ? new Date(evTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : (ev.time || '--:--:--');
          processState.events.push({
            timestamp: evTs || (Date.now() - 5000),
            time: displayTime,
            text: ev.text,
            level: ev.level || 'info',
            model: ev.model || null
          });
          changed = true;
        }
      }
      if (changed) {
        processState.events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (processState.events.length > 50) processState.events.length = 50;
      }
    }
    if (typeof data.is_generating === 'boolean') {
      processState.isGenerating = data.is_generating;
    }
    if (data.active_task) {
      processState.activeTaskPrompt = data.active_task.prompt || null;
      processState.activeTaskStartTime = data.active_task.start_time || null;
    } else if (!appState.isGenerating) {
      processState.activeTaskPrompt = null;
      processState.activeTaskStartTime = null;
    }
    renderProcessDrawer();
  } catch (_) {}
}

async function abortActiveGeneration() {
  // 1. Локальне переривання браузерного fetch
  if (appState.activeChatAbortController) {
    try {
      appState.activeChatAbortController.abort();
    } catch (_) {}
    appState.activeChatAbortController = null;
  }

  appState.isGenerating = false;
  appState.activeGenerationChatId = null;
  appState.activeGenerationPrompt = null;
  appState.activeGenerationStartTime = null;

  // Оновлення ProcessMonitor одразу, не чекаючи мережевої відповіді
  processState.status = 'idle';
  processState.stepDescription = 'Генерацію перервано користувачем';
  processState.isGenerating = false;
  processState.activeTaskPrompt = null;
  processState.activeTaskStartTime = null;
  addProcessEvent('Генерацію зупинено користувачем', 'warning');
  renderProcessDrawer();

  // 2. Сповіщення бекенду для зупинки асинхронного таску
  try {
    await apiFetch('/api/chat/cancel', { method: 'POST', retries: 0 });
  } catch (_) {}
}

function startProcessPolling() {
  stopProcessPolling();
  processState.pollTimer = setInterval(fetchProcessStatus, 800);
}

function stopProcessPolling() {
  if (processState.pollTimer) {
    clearInterval(processState.pollTimer);
    processState.pollTimer = null;
  }
}

window.ProcessMonitor = {
  open: openProcessDrawer,
  close: closeProcessDrawer,
  toggle: toggleProcessDrawer,
  addEvent: addProcessEvent,
  setState: setProcessState,
  setStep: setProcessStep,
  fetchStatus: fetchProcessStatus,
  render: renderProcessDrawer,
  abortGeneration: abortActiveGeneration,
  isBusy: () => Boolean(appState.isGenerating || processState.status === 'searching' || processState.status === 'generating')
};

elements.openSidebarButton.addEventListener('click', openDrawer);
elements.themeToggleButton.addEventListener('click', toggleTheme);
elements.closeSidebarButton.addEventListener('click', closeDrawer);
elements.drawerBackdrop.addEventListener('click', closeDrawer);
if (elements.openProcessDrawerButton) elements.openProcessDrawerButton.addEventListener('click', openProcessDrawer);
if (elements.closeProcessDrawerButton) elements.closeProcessDrawerButton.addEventListener('click', closeProcessDrawer);
if (elements.processDrawerBackdrop) elements.processDrawerBackdrop.addEventListener('click', closeProcessDrawer);
if (elements.sidebarProcessButton) elements.sidebarProcessButton.addEventListener('click', openProcessDrawer);
if (elements.clearProcessLogButton) elements.clearProcessLogButton.addEventListener('click', clearProcessLog);
if (elements.abortGenerationButton) elements.abortGenerationButton.addEventListener('click', abortActiveGeneration);
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

// Вікно колоди: вкладки, стилі, закриття. Кліки делегуємо на списки:
// рядки перемальовуються після кожної дії, і слухач на кожному рядку
// довелося б переписувати.
elements.editorBackButton.addEventListener('click', () => showDeckList());
elements.deckTabs.addEventListener('click', event => {
  const tab = event.target.closest('[data-deck-tab]');
  if (!tab) return;
  selectDeckTab(tab.dataset.deckTab);
  haptic('light');
});
elements.deckWindow.addEventListener('click', event => {
  if (event.target === elements.deckWindow) showDeckList();
});
elements.deckSettingsPreviewButton.addEventListener('click', () => {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (deck) openDeckPreview(deck.id);
});
elements.deckSettingsDownloadButton.addEventListener('click', () => {
  const deck = appState.decks.find(item => item.id === appState.editorDeckId);
  if (deck) downloadDeck(deck.id);
});

// Бібліотека стилів. openStylesButton викликає функцію напряму, тому
// openStyleModal сама відрізняє подію від id колоди.
elements.openStylesButton.addEventListener('click', openStyleModal);
elements.stylesNavButton.addEventListener('click', () => {
  showDeckList();
  openStyleModal('');
  if (!desktopQuery.matches) closeDrawer();
});
elements.closeStyleModalButton.addEventListener('click', closeStyleModal);
elements.cancelStyleModalButton.addEventListener('click', closeStyleModal);
elements.createStyleButton.addEventListener('click', createDeckStyle);
elements.createDeckStyleButton.addEventListener('click', createDeckStyle);
elements.saveStyleEditorButton.addEventListener('click', saveStyleEditor);
elements.newStyleName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createDeckStyle();
});
elements.styleList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const styleId = button.dataset.styleId;
  if (button.dataset.action === 'edit-style') selectStyleForEditing(styleId);
  else if (button.dataset.action === 'apply-style') applyDeckStyle(styleId);
  else if (button.dataset.action === 'generation-style') setGenerationStyleId(styleId);
  else if (button.dataset.action === 'delete-style') requestDeleteDeckStyle(styleId);
});
elements.deckStyleList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const styleId = button.dataset.styleId;
  if (button.dataset.action === 'apply-deck-style') applyDeckStyleToEditor(styleId);
  else if (button.dataset.action === 'generation-deck-style') setGenerationStyleId(styleId);
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

let cardPointerDown = null;

elements.messages.addEventListener('pointerdown', event => {
  const card = event.target.closest('.flip-card');
  if (card) {
    cardPointerDown = {
      x: event.clientX,
      y: event.clientY,
      target: event.target
    };
  }
});

elements.messages.addEventListener('click', event => {
  const card = event.target.closest('.flip-card');
  if (card) {
    // 1. Якщо користувач виділяв текст, не перевертати
    if (window.getSelection && window.getSelection().toString().trim().length > 0) {
      return;
    }

    // 2. Якщо це жест скролу/перетягування (> 5px), не перевертати
    if (cardPointerDown) {
      const dx = Math.abs(event.clientX - cardPointerDown.x);
      const dy = Math.abs(event.clientY - cardPointerDown.y);
      if (dx > 5 || dy > 5) {
        return;
      }
    }

    // 3. Якщо клік по смужку прокрутки (.card-fields чи .card-content), не перевертати
    const scrollBox = event.target.closest('.card-fields, .card-content');
    if (scrollBox) {
      const rect = scrollBox.getBoundingClientRect();
      if (event.clientX >= rect.left + scrollBox.clientWidth) {
        return;
      }
    }

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
  } else if (button.dataset.action === 'preview-message-cards') {
    const message = appState.messages.find(item => item.id === button.dataset.messageId);
    if (message?.cards?.length && typeof openMessageCardsPreview === 'function') {
      openMessageCardsPreview(message);
    }
  } else if (button.dataset.action === 'toggle-extra-cards') {
    const extraContainer = document.getElementById(`extraCards-${button.dataset.messageId}`);
    if (extraContainer) {
      const isHidden = extraContainer.classList.contains('hidden');
      extraContainer.classList.toggle('hidden');
      const icon = button.querySelector('i[data-lucide], svg[data-lucide]');
      const label = button.querySelector('.toggle-extra-label');
      if (isHidden) {
        if (label) label.textContent = 'Згорнути додаткові картки';
        if (icon) icon.style.transform = 'rotate(180deg)';
        if (typeof typesetMath === 'function') typesetMath(extraContainer);
        if (typeof refreshIcons === 'function') refreshIcons(extraContainer);
      } else {
        const count = extraContainer.querySelectorAll('.flip-card').length;
        if (label) label.textContent = `Показати ще ${count} карток`;
        if (icon) icon.style.transform = '';
      }
      if (typeof refreshIcons === 'function') refreshIcons(button);
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
  if (elements.styleModal.classList.contains('flex')) closeStyleModal();
  else if (elements.confirmModal.classList.contains('flex')) closeConfirmModal();
  else if (elements.deckModal.classList.contains('flex')) closeDeckModal();
  else if (elements.deckWindow && !elements.deckWindow.classList.contains('hidden')) showDeckList();
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
