/**
 * Перевірка, що діагностика взагалі виконується: ранні помилки
 * (помилка в імені, відсутній елемент) тут видно, навіть без браузера.
 * Розміщення jsdom не рахує — client/scroll будуть нульові, це очікувано.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail || ''}`); }
};

const makeEl = (tag, cls) => ({
  tagName: (tag || 'div').toUpperCase(),
  className: cls || '',
  clientHeight: 0, scrollHeight: 0, scrollTop: 0,
  style: { setProperty() {}, cssText: '' },
  dataset: {},
  matches: () => false,
  textContent: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {},
  remove() {},
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getAttribute: () => null,
  setAttribute() {}
});

const registry = {};
const register = (sel, el) => { registry[sel] = el; };

register('.chat-workspace', makeEl('main', 'chat-workspace'));
register('.flip-card', makeEl('div', 'flip-card'));
register('.flip-card-inner', makeEl('div', 'flip-card-inner'));
register('.flip-face.front', makeEl('div', 'flip-face front'));
register('.flip-face.front .card-content', makeEl('div', 'card-content'));
register('.flip-face.front .card-value', makeEl('div', 'card-value'));
register('.flip-face.back', makeEl('div', 'flip-face back'));
register('.card-fields', makeEl('div', 'card-fields'));

const messages = makeEl('section', 'chat-messages');
const app = makeEl('div', '');

const document = {
  documentElement: {
    style: { setProperty() {} },
    getAttribute: () => null
  },
  body: makeEl('body'),
  getElementById: id => (id === 'app' ? app : null),
  querySelector: sel => registry[sel] || null,
  querySelectorAll: () => [],
  createElement: tag => makeEl(tag),
  addEventListener() {}
};

const computed = {
  overflowY: 'auto', display: 'flex', height: '245px',
  minHeight: '0px', flex: '1 1 0%', overflow: 'hidden',
  getPropertyValue: name => (name === '--app-height' ? '800px' : '')
};

const ctx = {
  document,
  window: {
    innerHeight: 800, location: { search: '' },
    visualViewport: { height: 800, addEventListener() {} },
    addEventListener() {}, setTimeout: () => 0,
    requestAnimationFrame: () => 0, matchMedia: () => ({ addEventListener() {} })
  },
  navigator: {}, console, Math, JSON, Number, String, Object, Array,
  getComputedStyle: () => computed
};
ctx.window.visualViewport.height = 800;
ctx.globalThis = ctx;
vm.createContext(ctx);

const runtime = fs.readFileSync(path.join(ROOT, 'js', 'runtime.js'), 'utf8');

console.log('__diag виконується');
let rows = null;
try {
  vm.runInContext(runtime, ctx, { filename: 'runtime.js' });
  ctx.elements = { messages };
  rows = ctx.collectScrollDiag();
  check('collectScrollDiag повертає масив', Array.isArray(rows) && rows.length > 0);
} catch (e) {
  check('без винятків', false, `${e.name}: ${e.message}`);
}

if (rows) {
  const labels = rows.map(r => r[0]);
  for (const need of ['window', '--app-height', 'body', '#app',
    'main .chat-workspace', '#messages', '.flip-card',
    '.card-content (front)', '.card-value (front)', '.card-fields (back)']) {
    check(`рядок "${need}" є`, labels.includes(need));
  }
  check('усі значення — рядки', rows.every(r => typeof r[1] === 'string'));
  check('__diag експортовано', typeof ctx.__diag === 'function');
  check('панель доступна', typeof ctx.showDebugPanel === 'function');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
