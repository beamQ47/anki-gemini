const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${g}\n         want ${w}`); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail || ''}`); }
}

function store() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] || null,
    get length() { return m.size; }
  };
}

function makeElements() {
  return new Proxy({}, {
    get(target, key) {
      if (key === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (!(key in target)) {
        target[key] = {
          innerHTML: '', textContent: '', value: '', hidden: false,
          disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          dataset: {}, style: {}, children: [], options: [],
          addEventListener() {}, appendChild() {}, remove() {}, focus() {},
          querySelector() { return null; }, querySelectorAll() { return []; },
          setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
          closest() { return null; }, scrollIntoView() {}
        };
      }
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; }
  });
}

function loadApp() {
  const elements = makeElements();
  const sharedStorage = store();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map,
    Promise, Error, isNaN, parseInt, parseFloat, RegExp, Symbol, Proxy,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      getElementById: (id) => elements[id],
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tagName: String(tag || '').toUpperCase(),
        click() {}, remove() {},
        style: {}, className: '', innerHTML: '', textContent: '',
        appendChild() {}, setAttribute() {}, getAttribute() { return null; },
        download: '', rel: ''
      }),
      body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
      documentElement: {
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        style: { setProperty() {}, removeProperty() {} },
        getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
        dataset: {}, appendChild() {}, remove() {}
      },
      addEventListener() {}
    },
    window: {
      addEventListener() {}, innerWidth: 1200, innerHeight: 800,
      setTimeout, clearTimeout, setInterval, clearInterval,
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      scrollTo() {}, localStorage: sharedStorage, sessionStorage: store(),
      URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
      location: { href: 'http://127.0.0.1:8000/' },
      getComputedStyle: () => ({ getPropertyValue: () => '', color: 'rgb(255,255,255)' })
    },
    localStorage: sharedStorage,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    navigator: { userAgent: 'node', serviceWorker: null, vibrate() {}, clipboard: { writeText() {} } },
    alert() {}, confirm() { return true; },
    Intl, URLSearchParams, TextEncoder, TextDecoder
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.module = undefined;

  const ctx = vm.createContext(sandbox);
  const files = ['js/runtime.js', 'js/auth.js', 'js/model.js', 'js/decks.js',
                 'js/chat.js', 'js/app.js'];
  const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: files.join('+') });
  return { ctx, sandbox, elements };
}

console.log('ProcessMonitor Tests:');
const { sandbox, elements } = loadApp();

// 1. ProcessMonitor is exported
ok('ProcessMonitor is exported on window', typeof sandbox.window.ProcessMonitor === 'object');

// 2. Default active model is gemini-flash-lite-latest
sandbox.window.ProcessMonitor.render();
check('Default active model badge is gemini-flash-lite-latest', elements.processActiveModelBadge.textContent, 'gemini-flash-lite-latest');

// 2b. Abort generation is exported and can be called
ok('abortGeneration is exported on window.ProcessMonitor', typeof sandbox.window.ProcessMonitor.abortGeneration === 'function');
ok('abortGenerationButton exists in elements', Boolean(elements.abortGenerationButton));
sandbox.window.ProcessMonitor.abortGeneration();
check('Status is idle after abort', elements.processCurrentStatusText.textContent, 'Генерацію перервано користувачем');

// 3. Chain count reflects 6 models
check('Chain count reflects 6 models', elements.processModelChainCount.textContent, 'черга 1 → 6');

// 4. Model chain contains all 6 models
ok('Chain list includes gemini-4-hydrogen', elements.processModelChainList.innerHTML.includes('gemini-4-hydrogen'));
ok('Chain list includes gemini-3.8-flash', elements.processModelChainList.innerHTML.includes('gemini-3.8-flash'));
ok('Chain list includes gemini-3.1-flash-lite', elements.processModelChainList.innerHTML.includes('gemini-3.1-flash-lite'));

// 5. Unified event logging with timestamps and sorting
sandbox.window.ProcessMonitor.open();
const now = Date.now();
sandbox.window.ProcessMonitor.addEvent('Тестова подія 1', 'info', null, now - 5000);
sandbox.window.ProcessMonitor.addEvent('Тестова подія 2 (новіша)', 'success', 'gemini-4-hydrogen', now);

ok('Event log rendered', elements.processEventLog.innerHTML.length > 0);
ok('Event log displays newer event before older event',
  elements.processEventLog.innerHTML.indexOf('Тестова подія 2') < elements.processEventLog.innerHTML.indexOf('Тестова подія 1'));

// 6. Backend fetchStatus merges models dynamically
sandbox.fetch = async () => ({
  ok: true,
  json: async () => ({
    status: 'completed',
    active_model: 'gemini-4-hydrogen',
    model_chain: [
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
    ],
    step_description: 'Готово',
    last_model: 'gemini-4-hydrogen',
    last_latency_ms: 1200,
    events: [
      {
        timestamp: now + 2000,
        text: 'Модель gemini-4-hydrogen відповіла за 1200 мс',
        level: 'success',
        model: 'gemini-4-hydrogen'
      }
    ]
  })
});

sandbox.window.ProcessMonitor.fetchStatus().then(() => {
  ok('Synced server event rendered', elements.processEventLog.innerHTML.includes('Модель gemini-4-hydrogen відповіла'));
  ok('Server event with newest timestamp is on top',
    elements.processEventLog.innerHTML.indexOf('Модель gemini-4-hydrogen відповіла') < elements.processEventLog.innerHTML.indexOf('Тестова подія 2'));
  check('Chain count matches backend model_chain length', elements.processModelChainCount.textContent, 'черга 1 → 6');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
});
