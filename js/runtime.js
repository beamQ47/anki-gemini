function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function haptic(type = 'light') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (type === 'error') {
    navigator.vibrate([16, 60, 16]);
    return;
  }
  if (type === 'success' || type === 'warning' || type === 'medium') {
    navigator.vibrate(18);
    return;
  }
  navigator.vibrate(10);
}

function scrollMessagesToEnd(behavior = 'auto') {
  const box = elements.messages;
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior });
}

/** Чи користувач уже внизу — щоб не виривати його звідти при ресайзі. */
function isScrolledToEnd(box, tolerance = 80) {
  if (!box) return true;
  return box.scrollHeight - box.scrollTop - box.clientHeight <= tolerance;
}

function syncViewport() {
  const candidates = [
    Number(window.visualViewport?.height),
    Number(window.innerHeight)
  ].filter(value => Number.isFinite(value) && value > 0);
  const viewportHeight = Math.round(Math.min(...candidates));
  if (viewportHeight > 0) {
    document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
  }
  updateMessageInput();
  // Автопрокрутка лише якщо користувач уже був унизу. Раніше чат
  // відкидало вниз на кожен ресайз, і прочитати верх картки було неможливо.
  if (isScrolledToEnd(elements.messages)) {
    window.requestAnimationFrame(() => scrollMessagesToEnd('auto'));
  }
}

/**
 * Діагностика геометрії прокрутки картки.
 * Відкрити на сторінці: http://127.0.0.1:8000/?debug=1
 * Також доступна з консолі як window.__diag().
 */
function collectScrollDiag() {
  const rows = [];
  const add = (label, value) => rows.push([label, value]);

  const measure = (label, el) => {
    if (!el) { add(label, 'НЕМАЄ ЕЛЕМЕНТА'); return null; }
    const s = getComputedStyle(el);
    const info = {
      client: el.clientHeight,
      scroll: el.scrollHeight,
      top: Math.round(el.scrollTop),
      canScroll: el.scrollHeight > el.clientHeight
    };
    add(label, `client=${info.client} scroll=${info.scroll} `
      + `top=${info.top} ${info.canScroll ? 'ГОРТАЄТЬСЯ' : 'нема що гортати'} | `
      + `overflowY=${s.overflowY} display=${s.display} `
      + `height=${s.height} minH=${s.minHeight} flex=${s.flex} overflow=${s.overflow}`);
    return info;
  };

  add('window', `innerH=${window.innerHeight} visualH=${Math.round(window.visualViewport?.height ?? 0)}`);
  add('--app-height', getComputedStyle(document.documentElement)
    .getPropertyValue('--app-height').trim() || '(не задано)');

  measure('body', document.body);
  measure('#app', document.getElementById('app'));
  measure('main .chat-workspace', document.querySelector('.chat-workspace'));
  measure('#messages', elements.messages);
  measure('.flip-card', document.querySelector('.flip-card'));
  measure('.flip-card-inner', document.querySelector('.flip-card-inner'));
  measure('.flip-face.front', document.querySelector('.flip-face.front'));
  measure('.card-content (front)', document.querySelector('.flip-face.front .card-content'));
  measure('.card-value (front)', document.querySelector('.flip-face.front .card-value'));
  measure('.flip-face.back', document.querySelector('.flip-face.back'));
  measure('.card-fields (back)', document.querySelector('.card-fields'));

  const card = document.querySelector('.flip-card');
  if (card) {
    add('карток на екрані', String(document.querySelectorAll('.flip-card').length));
    add('перевернуто', String(document.querySelectorAll('.flip-card.is-flipped').length));
  }
  return rows;
}

function __diag() {
  const rows = collectScrollDiag();
  console.table(rows.map(([елемент, значення]) => ({ елемент, значення })));
  return rows;
}

/** Панель на екрані — щоб не копатися в devtools. */
function showDebugPanel() {
  const existing = document.getElementById('debug-panel');
  if (existing) existing.remove();
  const panel = document.createElement('pre');
  panel.id = 'debug-panel';
  panel.style.cssText = [
    'position:fixed', 'inset:8px 8px auto 8px', 'z-index:99999',
    'max-height:70vh', 'overflow:auto', 'margin:0', 'padding:10px',
    'background:#0f172a', 'color:#e2e8f0', 'font:11px/1.45 ui-monospace,monospace',
    'border:1px solid #475569', 'border-radius:8px', 'white-space:pre-wrap'
  ].join(';');
  const render = () => {
    panel.textContent = 'GEOMETRY DEBUG (оновити: F5)\n\n'
      + collectScrollDiag().map(([k, v]) => `${k}\n    ${v}`).join('\n');
  };
  render();
  document.body.appendChild(panel);
  window.setTimeout(render, 600);
  window.setTimeout(render, 1500);
  return panel;
}

function registerRuntimeEvents() {
  // Явно в window: інакше в консолі буде NameError, якщо файл
  // випадково завантажиться в модульному режимі або під обгорткою.
  window.__diag = __diag;
  window.collectScrollDiag = collectScrollDiag;
  if (/[?&]debug=1/.test(window.location.search)) {
    window.setTimeout(showDebugPanel, 250);
  }

  const visualViewport = window.visualViewport;
  if (visualViewport) {
    visualViewport.addEventListener('resize', syncViewport);
  }
  window.addEventListener('resize', syncViewport);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncViewport, 100);
  });
  window.addEventListener('focusin', event => {
    if (event.target === elements.messageInput) {
      syncViewport();
      window.setTimeout(syncViewport, 250);
    }
  });

  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleColorSchemeChange = () => {
    if (document.documentElement.hasAttribute('data-theme')) return;
    syncThemeButton();
  };
  if (typeof colorSchemeQuery.addEventListener === 'function') {
    colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
  } else if (typeof colorSchemeQuery.addListener === 'function') {
    colorSchemeQuery.addListener(handleColorSchemeChange);
  }

  syncViewport();
}
