// Тест відображення профілю користувача: після входу має показувати
// реальний email, а не застарілі «Локальний профіль» / «AG».
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let ok = 0, fail = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
};

const noop = () => {};
const fakeEl = {
  addEventListener: noop, appendChild: noop, remove: noop, setAttribute: noop,
  removeAttribute: noop, getAttribute: () => null, appendChild_: noop,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: { setProperty: noop }, dataset: {}, value: '', textContent: '', checked: false,
  querySelector: () => null, querySelectorAll: () => [], focus: noop, click: noop, disabled: false
};

// Справжні елементи профілю — щоб бачити, що в них потрапляє.
const profileIds = ['sidebarAvatar', 'headerAvatar', 'sidebarUserName', 'headerUserName',
                    'sidebarUserStatus', 'headerUserStatus'];
const els = new Map();
profileIds.forEach((id) => els.set(id, { id, textContent: '', value: '', classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, focus: noop, style: {}, dataset: {} }));

const AUTH_RESPONSE = {
  access_token: 'test-token-abc', refresh_token: 'r', expires_in: 3600,
  token_type: 'bearer', user: { id: '11111111-1111-1111-1111-111111111111', email: 'zadarko12@gmail.com' }
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Date, Math, Error, URL, URLSearchParams,
  FormData: class FormData {},
  document: {
    getElementById: (id) => (els.has(id) ? els.get(id) : fakeEl),
    querySelector: () => fakeEl, querySelectorAll: () => [], addEventListener: noop,
    createElement: () => fakeEl,
    body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
    documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, getAttribute: () => null, appendChild: noop, dataset: {} }
  },
  localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
  fetch: async (url) => {
    const full = String(url).startsWith('/') ? 'http://127.0.0.1:8000' + url : String(url);
    if (full.includes('/api/config')) return { ok: true, status: 200, json: async () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }) };
    if (full.includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => AUTH_RESPONSE };
    return { ok: true, status: 200, json: async () => ({ decks: [] }) };
  },
  navigator: { userAgent: 'node', onLine: true },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: noop,
  getComputedStyle: () => ({ color: 'rgb(15, 23, 42)' }),
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', reload: noop },
  alert: noop, confirm: () => true, addEventListener: noop, removeEventListener: noop, scrollTo: noop
};
sandbox.window = sandbox;

vm.createContext(sandbox);
for (const name of ['runtime.js', 'auth.js', 'model.js', 'decks.js', 'chat.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), sandbox, { filename: name });
}
vm.runInContext('globalThis.__render = renderUserProfile;globalThis.__initialsOf = initialsOf;', sandbox);

const render = sandbox.__render;
const initialsOf = sandbox.__initialsOf;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

(async () => {
  console.log('\nРозмітка');
  for (const id of profileIds) {
    check(`#${id} існує в index.html`, new RegExp(`id="${id}"`).test(html), true);
  }
  check('немає «Локальний профіль»', html.includes('Локальний профіль'), false);
  check('немає «Автономний режим»', html.includes('Автономний режим'), false);
  check('немає «Дані зберігаються у браузері»', html.includes('Дані зберігаються у браузері'), false);

  console.log('\nІніціали');
  check('zadarko12@gmail.com -> ZA', initialsOf('zadarko12@gmail.com'), 'ZA');
  check('імʼя-прізвище -> ініціали', initialsOf('ivan.petrov@example.com'), 'IP');
  check('без пошти -> ?', initialsOf(''), '?');

  console.log('\nПрофіль після входу');
  render({ email: 'zadarko12@gmail.com' });
  check('sidebarUserName = email', els.get('sidebarUserName').textContent, 'zadarko12@gmail.com');
  check('headerUserName = email', els.get('headerUserName').textContent, 'zadarko12@gmail.com');
  check('sidebarAvatar = ZA', els.get('sidebarAvatar').textContent, 'ZA');
  check('headerAvatar = ZA', els.get('headerAvatar').textContent, 'ZA');
  check('статус НЕ «Автономний режим»', els.get('sidebarUserStatus').textContent.includes('Автономний'), false);

  console.log('\nПрофіль після виходу');
  render(null);
  check('скидається у «Не авторизовано»', els.get('sidebarUserName').textContent, 'Не авторизовано');
  check('аватар скидається', els.get('sidebarAvatar').textContent, '—');
  check('статус скидається', els.get('sidebarUserStatus').textContent, 'Вхід не виконано');

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Тест впав:', e && e.message); process.exit(1); });
