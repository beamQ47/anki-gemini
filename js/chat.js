function renderMarkdown(source) {
  if (!window.marked) {
    return escapeHtml(source).replace(/\n/g, '<br>');
  }
  let html;
  try {
    html = window.marked.parse(String(source || ''), {
      gfm: true,
      breaks: true
    });
  } catch (error) {
    html = escapeHtml(source).replace(/\n/g, '<br>');
  }
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button'],
      FORBID_ATTR: ['style']
    });
  }
  return escapeHtml(source).replace(/\n/g, '<br>');
}

// Формули приходять від моделі як LaTeX у роздільниках Anki: \( ... \)
// та \[ ... \]. Сам Anki їх малює, але в застосунку без MathJax користувач
// базив би сирий "\(" — тож перетиповуємо локально.
//
// Важливо через порядок: DOMPurify сідає на HTML, MathJax — на вже готовий
// DOM. Типсетити треба після вставки розмітки, і тільки в межах контейнера,
// бо на старті сторінки формул ще немає, а MathJax підвантажується async —
// до його готовності typesetPromise кидає помилку.
function typesetMath(root) {
  const mathjax = window.MathJax;
  if (!root || !mathjax || typeof mathjax.typesetPromise !== 'function') return;
  const run = () => Promise.resolve(mathjax.typesetPromise([root])).catch(() => {});
  // startup.promise — обіцянка завантаження MathJax. Поки вона не
  // вирішена, typesetPromise не працює, тож спершу дочекаємось її.
  if (mathjax.startup && typeof mathjax.startup.promise?.then === 'function') {
    mathjax.startup.promise.then(run).catch(() => {});
    return;
  }
  run();
}

const ICON_CONTENT = {
  'layers-3': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/><path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5"/>',
  'layers-2': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/>',
  'library-big': '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/><path d="M2 4h20"/>',
  'library': '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'send-horizontal': '<path d="M3 11h18"/><path d="m11 3 8 8-8 8"/><path d="M11 3h10v10"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M10 13h4"/><path d="M10 17h4"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-1.857.507l-2.685-.8.8-2.685a2 2 0 0 1 .506-1.856z"/>',
  'cloud-check': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 2 4-4"/>',
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'notebook-tabs': '<path d="M13 2v4"/><path d="M17 2v4"/><path d="M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/><path d="M5 8h14"/><path d="M5 12h14"/><path d="M5 16h14"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  'rotate-3d': '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  'check-circle-2': '<path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z"/><path d="m9 12 2 2 4-4"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'bookmark-plus': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'folder-plus': '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/>',
  'message-circle-plus': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  'messages-square': '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  'paint-bucket': '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/>',
  'settings-2': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  'wand-2': '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>'
};

function refreshIcons(root = document) {
  root.querySelectorAll('[data-lucide]').forEach(element => {
    const name = element.getAttribute('data-lucide');
    const isSvg = element.tagName.toLowerCase() === 'svg';
    const svg = isSvg ? element : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const className = element.getAttribute('class');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-lucide', name);
    if (className) svg.setAttribute('class', className);
    if (element.id) svg.id = element.id;
    svg.innerHTML = ICON_CONTENT[name] || ICON_CONTENT.circle;
    if (!isSvg) element.replaceWith(svg);
  });
}

function renderMessages(scrollToEnd = false) {
  elements.messages.innerHTML = appState.messages.length
    ? appState.messages.map(renderMessage).join('')
    : renderEmptyChat();
  refreshIcons(elements.messages);
  typesetMath(elements.messages);
  if (scrollToEnd && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      if (!elements.messages || typeof elements.messages.scrollTo !== 'function') return;
      elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: 'smooth' });
    });
  }
}

// Порожній чат — це не помилка, а нормальний старт нового діалогу, тож
// стрічка має показувати підказку, а не лишатися порожнім прямокутником.
function renderEmptyChat() {
  return `
    <div class="mx-auto flex max-w-2xl flex-col items-center gap-3 py-10 text-center">
      <div class="ai-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg shadow-violet-500/20">
        <i data-lucide="message-circle-plus" class="h-6 w-6" aria-hidden="true"></i>
      </div>
      <p class="text-base font-extrabold">Новий чат</p>
      <p class="text-sm leading-6 text-app-hint">
        Опишіть тему або прикріпіть фото дошки. Кожен чат має власну історію, тож матеріали з різних предметів не змішуються.
      </p>
    </div>
  `;
}

function chatDisplayName(chat) {
  return (chat && chat.title) || 'Новий чат';
}

function renderActiveChatTitle() {
  if (!elements.activeChatTitle) return;
  elements.activeChatTitle.textContent = chatDisplayName(activeChat());
}

function renderChatList() {
  if (!elements.chatList) return;
  elements.chatList.innerHTML = appState.chats.map((chat) => {
    const active = chat.id === appState.activeChatId;
    const count = chat.messages.length;
    return `
      <div class="group flex items-center gap-1 rounded-xl px-1 transition ${active ? 'bg-app-button/10' : 'hover:bg-app-hint/5'}" role="option" aria-selected="${active}" data-chat-id="${escapeHtml(chat.id)}">
        <button class="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left" type="button" data-action="select-chat" data-chat-id="${escapeHtml(chat.id)}">
          <i data-lucide="${active ? 'message-square' : 'message-square-dashed'}" class="h-4 w-4 shrink-0 ${active ? 'text-app-button' : 'text-app-hint'}" aria-hidden="true"></i>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-bold ${active ? 'text-app-text' : ''}">${escapeHtml(chatDisplayName(chat))}</span>
            <span class="block truncate text-[10px] text-app-hint">${count} ${pluralizeMessages(count)}</span>
          </span>
        </button>
        <button class="icon-button h-7 w-7 opacity-0 transition group-hover:opacity-100 focus:opacity-100" type="button" data-action="rename-chat" data-chat-id="${escapeHtml(chat.id)}" aria-label="Перейменувати чат" title="Перейменувати">
          <i data-lucide="pencil" class="h-3.5 w-3.5" aria-hidden="true"></i>
        </button>
        <button class="icon-button h-7 w-7 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-red-500" type="button" data-action="delete-chat" data-chat-id="${escapeHtml(chat.id)}" aria-label="Видалити чат" title="Видалити чат">
          <i data-lucide="trash-2" class="h-3.5 w-3.5" aria-hidden="true"></i>
        </button>
      </div>
    `;
  }).join('');
  refreshIcons(elements.chatList);
}

function pluralizeMessages(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'повідомлення';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'повідомлення';
  return 'повідомлень';
}

function toggleChatPanel(force) {
  if (!elements.chatPanel) return;
  const open = typeof force === 'boolean' ? force : elements.chatPanel.classList.contains('hidden');
  elements.chatPanel.classList.toggle('hidden', !open);
  if (elements.chatSwitcherButton) {
    elements.chatSwitcherButton.setAttribute('aria-expanded', String(open));
  }
}

function isChatPanelOpen() {
  return Boolean(elements.chatPanel) && !elements.chatPanel.classList.contains('hidden');
}

// Перейменування робимо полем прямо в списку: window.prompt тут не
// працював би ані на телефоні, ані в мобільному Safari.
function startChatRename(id) {
  const selector = `[data-action="select-chat"][data-chat-id="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`;
  const row = elements.chatList.querySelector(selector);
  if (!row) return;
  const label = row.querySelector('span.block.truncate');
  if (!label) return;
  const input = document.createElement('input');
  input.className = 'field-control w-full px-2 py-1 text-xs font-bold';
  input.value = (findChat(id) || {}).title || '';
  input.maxLength = 60;
  input.placeholder = 'Назва чату';
  label.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    renameChat(id, input.value);
    renderChatList();
    renderActiveChatTitle();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renderChatList();
    }
  });
  input.addEventListener('blur', commit, { once: true });
}

function requestChatDelete(id) {
  const chat = findChat(id);
  if (!chat) return;
  const only = appState.chats.length === 1;
  openConfirmModal('Видалити чат?', `Чат “${chatDisplayName(chat)}”${only ? ' буде очищено' : ' буде видалено разом з його історією'}.`, () => {
    deleteChat(id);
    renderChatState();
    showToast('Чат видалено', 'success');
  });
}

function renderMessage(message) {
  if (message.type === 'loading') {
    return `
      <div class="message-enter mb-5 flex items-start gap-3" data-message-id="${escapeHtml(message.id)}">
        ${renderAssistantAvatar()}
        <div class="min-w-0 max-w-3xl flex-1 rounded-3xl rounded-tl-md border surface bg-app-surface p-4 shadow-sm">
          <div class="flex items-center gap-2 text-xs font-bold text-app-hint">
            <span class="spinner text-app-button"></span>
            <span id="loadingStatus">Аналізую ваш запит…</span>
          </div>
          <div class="mt-4 space-y-2.5">
            <div class="skeleton h-3 w-11/12 rounded-full"></div>
            <div class="skeleton h-3 w-full rounded-full"></div>
            <div class="skeleton h-3 w-4/5 rounded-full"></div>
          </div>
        </div>
      </div>
    `;
  }

  if (message.type === 'error') {
    return `
      <div class="message-enter mb-5 flex items-start gap-3" data-message-id="${escapeHtml(message.id)}">
        ${renderAssistantAvatar()}
        <div class="min-w-0 max-w-3xl flex-1 rounded-3xl rounded-tl-md border border-red-500/20 bg-red-500/5 p-4">
          <div class="flex items-center gap-2 text-sm font-extrabold text-red-500">
            <i data-lucide="circle-alert" class="h-4 w-4" aria-hidden="true"></i>
            Не вдалося отримати відповідь
          </div>
          <p class="mt-2 text-sm text-app-hint">${escapeHtml(message.content)}</p>
          <button class="mt-3 flex items-center gap-2 rounded-xl bg-app-link/10 px-3 py-2 text-xs font-bold text-app-button" type="button" data-action="retry-chat">
            <i data-lucide="rotate-cw" class="h-3.5 w-3.5" aria-hidden="true"></i>
            Спробувати ще
          </button>
        </div>
      </div>
    `;
  }

  if (message.role === 'user') {
    return `
      <div class="message-enter mb-5 flex justify-end pl-8 sm:pl-20" data-message-id="${escapeHtml(message.id)}" data-role="user">
        <div class="user-message-bubble max-w-3xl rounded-3xl rounded-br-md px-4 py-3 text-app-button-text shadow-sm" style="background: var(--app-user-msg);">
          ${message.attachment ? `<div class="mb-2 flex items-center gap-2 rounded-xl bg-black/10 px-2.5 py-2 text-xs font-semibold"><i data-lucide="paperclip" class="h-3.5 w-3.5" aria-hidden="true"></i><span class="truncate">${escapeHtml(message.attachment.name)}</span></div>` : ''}
          <div class="whitespace-pre-wrap text-sm leading-6">${escapeHtml(message.content)}</div>
          <time class="mt-1.5 block text-right text-[10px] opacity-70">${formatRelativeDate(message.createdAt)}</time>
        </div>
      </div>
    `;
  }

  const cardMarkup = message.type === 'cards' ? renderCards(message) : '';
  return `
    <div class="message-enter mb-5 flex items-start gap-3" data-message-id="${escapeHtml(message.id)}">
      ${renderAssistantAvatar()}
      <div class="min-w-0 max-w-3xl flex-1">
        <div class="mb-1.5 flex items-center gap-2">
          <span class="text-xs font-extrabold">Anki Gemini</span>
          <span class="rounded-full bg-app-link/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-app-button">AI</span>
        </div>
        <div class="rounded-3xl rounded-tl-md border surface bg-app-surface p-4 shadow-sm">
          ${message.type === 'cards' && /^\s*\{[\s\S]*\}\s*$/.test(String(message.content || '').trim()) ? '' : `<div class="markdown">${renderMarkdown(message.content)}</div>`}
          ${cardMarkup}
        </div>
        <p class="mt-1.5 px-1 text-[10px] text-app-hint">${formatRelativeDate(message.createdAt)}</p>
      </div>
    </div>
  `;
}

function renderAssistantAvatar() {
  return `
    <div class="ai-gradient mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-md shadow-violet-500/15">
      <i data-lucide="sparkles" class="h-4 w-4" aria-hidden="true"></i>
    </div>
  `;
}

function renderCards(message) {
  const cards = Array.isArray(message.cards) ? message.cards : [];
  const fieldNames = Array.isArray(message.fieldNames) && message.fieldNames.length
    ? message.fieldNames
    : resolveFieldNames(cards);
  const scopeClass = `msg-cards-scope-${escapeHtml(message.id || 'def')}`;
  const scopedCss = (typeof scopePreviewCss === 'function' && message.modelCss)
    ? scopePreviewCss(message.modelCss, `.${scopeClass}`)
    : '';

  const INITIAL_VISIBLE_COUNT = 6;
  const hasExtra = cards.length > INITIAL_VISIBLE_COUNT;
  const initialCards = hasExtra ? cards.slice(0, INITIAL_VISIBLE_COUNT) : cards;
  const extraCards = hasExtra ? cards.slice(INITIAL_VISIBLE_COUNT) : [];

  const renderCardItem = (card, index) => {
    const entries = cardEntries(card, fieldNames);
    const [head, ...rest] = entries;
    const visibleRest = rest.filter(([name, value]) => typeof isFieldEmpty === 'function' ? !isFieldEmpty(value) : String(value ?? '').trim().length > 0);
    return `
    <div class="flip-card" data-card-index="${index}" data-message-id="${escapeHtml(message.id)}">
      <div class="flip-card-inner">
        <div class="flip-face front card">
          <div class="relative z-[1] flex items-center justify-between gap-2 mb-1.5">
            <span class="rounded-full bg-app-link/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-app-button">${escapeHtml(head[0])} · ${index + 1}</span>
            <span class="text-[10px] font-semibold text-app-hint flex items-center gap-1">
              <i data-lucide="rotate-3d" class="h-3.5 w-3.5" aria-hidden="true"></i>
            </span>
          </div>
          <div class="card-content text-sm font-extrabold leading-5" data-field="${escapeHtml(head[0])}">
            <div class="card-value">${escapeHtml(head[1])}</div>
          </div>
        </div>
        <div class="flip-face back card">
          <div class="relative z-[1] flex items-center justify-between gap-2 mb-1.5">
            <span class="rounded-full bg-app-link/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-app-button">Зворот · ${index + 1}</span>
            <span class="text-[10px] font-semibold text-app-hint flex items-center gap-1">
              <i data-lucide="rotate-3d" class="h-3.5 w-3.5" aria-hidden="true"></i>
            </span>
          </div>
          <div class="card-fields">
            ${visibleRest.map(([name, value], position) => `
              <div class="anki-field anki-field-${position + 2}" data-field="${escapeHtml(name)}">
                <div class="text-[10px] font-extrabold uppercase tracking-wider anki-field-name ${position === 0 ? 'text-emerald-500' : 'text-app-hint'}">${escapeHtml(name)}</div>
                <div class="card-field-value text-xs font-bold leading-5 anki-field-value">${escapeHtml(value)}</div>
              </div>
            `).join('') || '<div class="text-xs text-app-hint">Немає додаткових полів</div>'}
          </div>
        </div>
      </div>
    </div>
  `;};

  return `
    <div class="mt-3 ${scopeClass}">
      ${scopedCss ? `<style>${scopedCss}</style>` : ''}
      <div class="grid gap-3 ${cards.length > 1 ? 'md:grid-cols-2' : ''}">
        ${initialCards.map(renderCardItem).join('')}
      </div>
      ${hasExtra ? `
        <div class="extra-cards-container hidden mt-3 grid gap-3 ${cards.length > 1 ? 'md:grid-cols-2' : ''}" id="extraCards-${escapeHtml(message.id)}">
          ${extraCards.map((card, idx) => renderCardItem(card, idx + INITIAL_VISIBLE_COUNT)).join('')}
        </div>
        <button class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-app-border bg-app-secondary-bg/60 px-3 py-2 text-xs font-extrabold text-app-hint transition hover:bg-app-secondary-bg hover:text-app-text" type="button" data-action="toggle-extra-cards" data-message-id="${escapeHtml(message.id)}">
          <i data-lucide="chevron-down" class="h-3.5 w-3.5 transition-transform duration-200" aria-hidden="true"></i>
          <span class="toggle-extra-label">Показати ще ${extraCards.length} карток (всього ${cards.length})</span>
        </button>
      ` : ''}
      <div class="mt-4 flex flex-col sm:flex-row items-center gap-2">
        <button class="flex flex-1 w-full items-center justify-center gap-2 rounded-2xl bg-app-link/10 px-4 py-3 text-sm font-extrabold text-app-button transition hover:bg-app-link/20 border border-app-border/40" type="button" data-action="preview-message-cards" data-message-id="${escapeHtml(message.id)}">
          <i data-lucide="eye" class="h-4 w-4" aria-hidden="true"></i>
          Оглянути картки · ${cards.length}
        </button>
        <button class="primary-button flex flex-1 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold shadow-sm transition hover:brightness-95" type="button" data-action="save-message-cards" data-message-id="${escapeHtml(message.id)}">
          <i data-lucide="bookmark-plus" class="h-4 w-4" aria-hidden="true"></i>
          Зберегти в мої колоди · ${cards.length}
        </button>
      </div>
    </div>
  `;
}

function updateMessageInput() {
  elements.messageInput.style.height = 'auto';
  const nextHeight = Math.min(elements.messageInput.scrollHeight, 160);
  elements.messageInput.style.height = `${nextHeight}px`;
  elements.sendButton.disabled = !elements.messageInput.value.trim() && !appState.selectedFile;
}

async function getAssistantReply(text, file) {
  const form = new FormData();
  form.append('message', text);
  form.append('history', JSON.stringify(appState.messages.slice(-10).map(message => ({
    role: message.role,
    content: message.type === 'text' || message.type === 'cards' ? message.content : ''
  }))));
  // Обраний стиль їде разом із запитом, а не окремим викликом: інакше
  // сервер не знав би, який саме CSS має вжити. Порожнє поле = «авто».
  const chosen = generationStyle();
  if (chosen) {
    form.append('style_name', chosen.name);
    form.append('style_css', chosen.css);
  }
  if (file) form.append('document', file);
  const response = await apiFetch('/api/chat', { method: 'POST', body: form });
  const payload = await response.json();
  const model = payload.model && typeof payload.model === 'object' ? payload.model : {};
  const fieldNames = resolveFieldNames(payload.cards || [], model.field_names);
  const rawCards = (Array.isArray(payload.cards) && payload.cards.length)
    ? payload.cards
    : extractCardsFromText(payload.reply || payload.message || payload.content || '');
  const cards = normalizeCards(rawCards, fieldNames);
  return {
    content: String(payload.reply || payload.message || 'Готово.'),
    cards,
    fieldNames,
    // Сервер уже повертає обраний стиль, навіть якщо Gemini його переписав.
    // Підстраховка тут: старий сервер або помилка не повинні знову підсунути
    // в колоду стиль, який користувач обрав, але не просив.
    modelCss: chosen ? chosen.css : (typeof model.css === 'string' ? model.css : ''),
    templates: Array.isArray(model.templates) ? model.templates : []
  };
}

function repairJsonText(text) {
  if (!text) return '';
  let raw = String(text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);

  const out = [];
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch);
      continue;
    }
    if (ch === '\\') {
      if (i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next === '"' || next === '\\' || next === '/') {
          out.push(ch, next);
          i++;
        } else if (['n', 'r', 't', 'b', 'f'].includes(next)) {
          const after = raw[i + 2] || '';
          if (/[a-zA-Z]/.test(after)) {
            out.push('\\\\', next);
            i++;
          } else {
            out.push(ch, next);
            i++;
          }
        } else if (next === 'u' && /^[0-9a-fA-F]{4}/.test(raw.slice(i + 2, i + 6))) {
          out.push(ch, next);
          i++;
        } else {
          out.push('\\\\', next);
          i++;
        }
      } else {
        out.push('\\\\');
      }
    } else if (ch === '"') {
      inString = false;
      out.push(ch);
    } else if (ch === '\n') {
      out.push('\\n');
    } else if (ch === '\r') {
      // skip
    } else if (ch === '\t') {
      out.push('\\t');
    } else {
      out.push(ch);
    }
  }
  if (inString) out.push('"');
  let res = out.join('').replace(/,\s*([}\]])/g, '$1');
  return res;
}

function extractCardsFromText(text) {
  if (!text) return [];
  const candidates = [];
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const trimmed = String(text).trim();
  candidates.push(trimmed);
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  for (const candidate of candidates) {
    const cleanCandidate = candidate.trim();
    try {
      const parsed = JSON.parse(cleanCandidate);
      const cards = Array.isArray(parsed) ? parsed : (parsed && parsed.cards);
      const normalized = normalizeCards(cards);
      if (normalized.length) return normalized;
    } catch (error) {
      try {
        const repaired = repairJsonText(cleanCandidate);
        const parsed = JSON.parse(repaired);
        const cards = Array.isArray(parsed) ? parsed : (parsed && parsed.cards);
        const normalized = normalizeCards(cards);
        if (normalized.length) return normalized;
      } catch (err2) {
        // Fallback to regex if syntax error persists
        const cardBlocks = cleanCandidate.match(/"fields"\s*:\s*\{[^{}]+\}/g) || cleanCandidate.match(/\{[^{}]+\}/g) || [];
        const extracted = [];
        for (const block of cardBlocks) {
          const pairs = [...block.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
          if (pairs.length) {
            const vals = {};
            for (const [, k, v] of pairs) {
              vals[k] = v.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            extracted.push({ fields: vals });
          }
        }
        if (extracted.length) {
          const normalized = normalizeCards(extracted);
          if (normalized.length) return normalized;
        }
      }
    }
  }
  return [];
}

// Збереження чату йде через saveMessagesLocally(), який оновлює назву
// активного чату за першим запитом. Список і підпис у шапці теж мають
// підхопити нову назву, тому вони перемальовуються тут, а не у сховищі:
// сховище не знає про DOM.
function persistChat() {
  saveMessagesLocally();
  renderChatList();
  renderActiveChatTitle();
}

// Відповідь (або помилка) має замінити «думає» саме в тому чаті, звідки
// пішов запит. Поки тривав запит, appState.messages міг перемкнутися на
// інший чат, а кеш акаунта — перезавантажитися й замінити об'єкти чатів.
// Тому шукаємо чат за id і, якщо «думає» вже немає (наприклад, його
// відфільтрувало збереження), додаємо відповідь у кінець, а не губимо.
function placeAssistantMessage(chatId, fallbackMessages, loadingId, message) {
  const chat = findChat(chatId);
  const sink = chat && Array.isArray(chat.messages) ? chat.messages : fallbackMessages;
  const index = sink.findIndex((item) => item.id === loadingId);
  if (index >= 0) sink.splice(index, 1, message);
  else sink.push(message);
  return sink;
}

async function submitChat() {
  const text = elements.messageInput.value.trim();
  const file = appState.selectedFile;
  if (!text && !file) return;
  const userMessage = {
    id: createId(),
    role: 'user',
    type: 'text',
    content: text || 'Проаналізуй прикріплений документ',
    attachment: file ? { name: file.name, size: file.size } : null,
    createdAt: Date.now()
  };
  const loadingMessage = {
    id: createId(),
    role: 'assistant',
    type: 'loading',
    createdAt: Date.now()
  };
  // Запам'ятовуємо саме масив чату, а не appState.messages: поки триває
  // запит, користувач може перемкнути чат, і тоді appState.messages вказує
  // вже на інший діалог. Відповідь має лягти туди, звідки запит пішов.
  const targetMessages = appState.messages;
  const targetChatId = appState.activeChatId;
  targetMessages.push(userMessage, loadingMessage);
  if (targetMessages.length > 60) targetMessages.splice(0, targetMessages.length - 60);
  elements.messageInput.value = '';
  appState.lastAttemptedFile = file;
  appState.selectedFile = null;
  clearAttachment();
  updateMessageInput();
  renderMessages(true);
  haptic();
  // Запит користувача зберігається одразу, ще до відповіді: якщо
  // перезавантаження станеться під час очікування, текст не зникне.
  persistChat();
  window.ProcessMonitor?.setStep(1);
  window.ProcessMonitor?.addEvent('Запит надіслано: "' + (text ? text.slice(0, 35) + '...' : 'документ') + '"', 'info');
  window.ProcessMonitor?.setStep(2);
  window.ProcessMonitor?.setState('searching', 'Пошук вільної моделі Gemini...', 'Опитування fallback-ланцюжка...');
  const processPollTimer = setInterval(() => window.ProcessMonitor?.fetchStatus(), 600);
  try {
    const response = await getAssistantReply(text || 'Проаналізуй прикріплений документ', file);
    appState.lastAttemptedFile = null;
    clearInterval(processPollTimer);
    window.ProcessMonitor?.setStep(3);
    window.ProcessMonitor?.addEvent('Отримано відповідь від Gemini, валідація карток...', 'success');
    window.ProcessMonitor?.setStep(4);
    window.ProcessMonitor?.setState('completed', 'Готово', 'Генерація та валідація успішна');
    window.ProcessMonitor?.fetchStatus();
    placeAssistantMessage(targetChatId, targetMessages, loadingMessage.id, {
      id: createId(),
      role: 'assistant',
      type: response.cards.length ? 'cards' : 'text',
      content: response.content,
      cards: response.cards,
      fieldNames: response.fieldNames,
      modelCss: response.modelCss,
      templates: response.templates,
      createdAt: Date.now()
    });
    if (appState.activeChatId === targetChatId) renderMessages(true);
    persistChat();
    haptic('success');
  } catch (error) {
    clearInterval(processPollTimer);
    window.ProcessMonitor?.setState('error', 'Помилка виконання', error && error.message ? error.message : 'Помилка');
    window.ProcessMonitor?.addEvent('Помилка: ' + (error && error.message ? error.message : 'Помилка запиту'), 'error');
    window.ProcessMonitor?.fetchStatus();
    // Сервер уже пояснив, що саме не так (400 на тип файлу, 413 на розмір,
    // 503 на перевантаження). Показувати «перевірте, чи бекенд запущено» —
    // це брехня: бекенд відповів, і саме він сказав причину.
    const reason = error && error.message ? String(error.message) : '';
    const content = error && error.status
      ? `Не вдалося виконати запит. ${reason}`
      : `Не вдалося зв’язатися з API (${getApiUrl('/api/chat')}). ${reason || 'Перевірте, чи бекенд запущено, і спробуйте ще раз.'}`;
    placeAssistantMessage(targetChatId, targetMessages, loadingMessage.id, {
      id: createId(),
      role: 'assistant',
      type: 'error',
      content,
      createdAt: Date.now()
    });
    if (appState.activeChatId === targetChatId) renderMessages(true);
    persistChat();
    showToast('Помилка запиту до API', 'error');
    haptic('error');
  }
}

function retryChat() {
  const lastUserMessage = [...appState.messages].reverse().find(message => message.role === 'user');
  if (!lastUserMessage) return;
  // splice, а не присвоєння нового масиву: appState.messages — це
  // посилання на messages активного чату, і новий масив відірвав би його
  // від списку чатів. Наступне ж збереження записало б у чат стару стрічку.
  const kept = appState.messages.filter(message => message.type !== 'error');
  appState.messages.splice(0, appState.messages.length, ...kept);
  elements.messageInput.value = lastUserMessage.content;
  if (appState.lastAttemptedFile) {
    appState.selectedFile = appState.lastAttemptedFile;
    showAttachment();
  }
  updateMessageInput();
  renderMessages(true);
}

function showAttachment() {
  const file = appState.selectedFile;
  if (!file) {
    elements.attachmentPreview.classList.add('hidden');
    elements.attachmentPreview.classList.remove('flex');
    return;
  }
  elements.attachmentName.textContent = file.name;
  elements.attachmentSize.textContent = formatBytes(file.size);
  elements.attachmentPreview.classList.remove('hidden');
  elements.attachmentPreview.classList.add('flex');
}

function clearAttachment() {
  elements.fileInput.value = '';
  showAttachment();
  updateMessageInput();
}
