// Тест реального коду входу з js/auth.js — без підміни fetch.
// fetch тут справжній: запит іде в Supabase так само, як з браузера.
//
// Живий тест: потрібні ANKI_TEST_EMAIL та ANKI_TEST_PASSWORD.
// Без них тест пропускається, а не падає.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EMAIL = process.env.ANKI_TEST_EMAIL;
const PASSWORD = process.env.ANKI_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.log('Пропущено: не задано ANKI_TEST_EMAIL / ANKI_TEST_PASSWORD');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
let ok = 0, fail = 0;
const check = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${got!==undefined?JSON.stringify(got):String(got)}\n         want ${JSON.stringify(want)}`); }
};

const ORIGIN = process.env.ANKI_TEST_BASE || 'http://127.0.0.1:8000';

// Браузер сам робить відносні URL абсолютними відносно свого origin.
// Node цього не робить, тому наслідуємо цю поведінку.
function browserFetch(url, opts) {
  const full = String(url).startsWith('/') ? ORIGIN + url : String(url);
  return fetch(full, opts);
}

const store = {};
const sandbox = {
  console,
  fetch: browserFetch,
  setTimeout,
  Promise,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  Date,
  JSON,
  Error
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8'), sandbox, { filename: 'auth.js' });

const A = sandbox.window.AnkiAuth;
const BASE = ORIGIN;

console.log('\nМодуль завантажився');
check('window.AnkiAuth існує', typeof A, 'object');
for (const fn of ['signIn', 'signOut', 'getAccessToken', 'getSession', 'getConfig']) {
  check(`є ${fn}()`, typeof A[fn], 'function');
}

console.log('\ngetConfig()');
(async () => {
  const cfg = await A.getConfig();
  check('supabaseUrl прийшов', typeof cfg.supabaseUrl, 'string');
  check('supabaseUrl без слеша', cfg.supabaseUrl.endsWith('/'), false);
  check('anon key прийшов', cfg.supabaseAnonKey.length > 100, true);
  console.log(`         ${cfg.supabaseUrl}`);

  console.log('\nПомилка при неправильному паролі');
  let msg = '';
  try {
    await A.signIn(EMAIL, 'точно-не-правильний-пароль-12345');
    msg = 'ПРОПУСТИЛО — неправильний пароль прийнято!';
  } catch (e) {
    msg = e.message;
  }
  check('відхилено неправильний пароль', /invalid|credential|wrong|невірн/i.test(msg), true);
  console.log(`         повідомлення: ${msg}`);
  check('сесія не створилась', A.getSession(), null);

  console.log('\nВхід з правильним паролем');
  const session = await A.signIn(EMAIL, PASSWORD);
  check('отримали accessToken', typeof session.accessToken, 'string');
  check('отримали refreshToken', typeof session.refreshToken, 'string');
  check('отримали userId', typeof session.userId, 'string');
  check('email', session.email, EMAIL);
  check('сесія збережена', A.getSession() !== null, true);
  check('accessToken не порожній', session.accessToken.length > 50, true);

  console.log('\ngetAccessToken()');
  const token = await A.getAccessToken();
  check('повертає той самий токен', token, session.accessToken);

  console.log('\nТокен справді працює на сервері');
  const r = await fetch(`${BASE}/api/decks`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 503) {
    // Токен прийнято, але сервер не може виконати запит до БД.
    // Це НЕ проблема входу — це відсутність налаштувань підключення.
    const detail = (await r.json()).detail || '';
    console.log(`  WARN сервер відповів 503: ${detail}`);
    console.log('       Вхід працює, але запити до БД не проходять.');
    console.log('       Додай DB_PASSWORD (або DATABASE_URL) у .env і перезапусти сервер.');
  } else {
    check('GET /api/decks -> 200', r.status, 200);
    const body = await r.json();
    check('список колод повернувся', Array.isArray(body.decks), true);
  }

  console.log('\nБез токена сервер не пускає');
  const r2 = await fetch(`${BASE}/api/decks`);
  check('без токена -> 401', r2.status, 401);

  console.log('\nВихід');
  A.signOut();
  check('сесія очищена', A.getSession(), null);
  check('accessToken тепер null', await A.getAccessToken(), null);

  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nТест впав:', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
