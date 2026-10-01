"""
Дві регресії, знайдені користувачем на живому сервері.

1. «Не вдалося завантажити .apkg». У лозі uvicorn не було жодного
   POST /api/export-deck — отже, запит не пішов на сервер, помилка
   виникла в браузері. Причина: правки js/*.js не супроводжувалися
   зміною ?v= у <script src>, тому браузер тримав старий кеш за тим самим
   URL і виконував код, у якому бракує нових функцій.

2. «Додав 2 картки, після перезавантаження зникли». addEditorCard() лише
   додавав картку в appState і зберігав у localStorage, жодного запиту
   на сервер. А наступне редагування йшло в PUT /api/notes/{id}, який
   робив update і відповідав 404 на неіснуючій нотатці — саме ті 404 у
   лозі. Після перезавантаження локальний стан затирався серверним.

Обидві перевірки нижче — на живому стані репозиторію, не на копії.

Третя регресія (додана перед публічним хостингом) — обернена: бекенд
має перестати роздавати себе. Раніше app.mount("/", StaticFiles(
directory=BASE_DIR)) віддавав увесь корінь репозиторію, тож на
публічній адресі GET /.env повертав би пароль бази й ключ Gemini, а
разом з ними — усі *.py і тести. Одночасно /api/chat і /api/export-deck
були відкриті: ними можна було без токена витрачати спільну безкоштовну
квоту Gemini. Нижче перевіряється, що обидва закриті.
"""
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = r"E:\learning\projects\anki-telegram-bot"
os.chdir(ROOT)
sys.path.insert(0, ROOT)

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ok = fail = 0


def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1
        print(f"  ok   {label}")
    else:
        fail += 1
        print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")


def check_that(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ok   {label}")
    else:
        fail += 1
        print(f"  FAIL {label} {detail}")


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return fh.read()


print("=" * 64)
print("БАГ 1: браузер тримав застарілий JS")
print("=" * 64)
html = read("index.html")
versions = set(re.findall(r"\?v=([0-9a-zA-Z]+)", html))
check("усі ресурси мають одну версію", len(versions), 1)
version = next(iter(versions))
print(f"       версія зараз: {version}")
# Уся сутність проблеми: одна версія на всі файли, але вона має бути
# новою відносно попередньої. Раніше всі правки йшли під ?v=20260928a,
# тож браузер їх не бачив.
check_that("версія не та, що була під час розробки", version != "20260928a",
           f"версія лишилась {version} — браузер візьме старий кеш")

for asset in ["js/model.js", "js/decks.js", "js/app.js", "css/style.css"]:
    check_that(f"{asset} підвантажується з версією", f"{asset}?v={version}" in html)

# Друга половина того самого бага: функції, які decks.js викликає, мають
# існувати в model.js. Якщо вони з'явилися в одному файлі, а в іншому
# ні — знову вийде помилка в браузері, яку тести на Python не побачать.
model_js = read("js/model.js")
decks_js = read("js/decks.js")
for fn in ["buildSubtreeExportNodes", "collectSubtreeIds",
           "isSubtreeExportIdentityReady", "buildExportPayload"]:
    check_that(f"model.js експортує {fn}", f"    {fn}," in model_js)

for call in ["collectSubtreeIds", "isSubtreeExportIdentityReady",
             "persistCardToServer"]:
    check_that(f"decks.js дзвінкає {call}", call + "(" in decks_js)
# buildSubtreeExportNodes з decks.js не дзвінкається напряму: його
# викликає buildExportPayload усередині model.js. Перевіряємо саме це,
# бо розрив між двома файлами і був причиною помилки в браузері.
check_that("model.js викликає buildSubtreeExportNodes",
           "buildSubtreeExportNodes(" in model_js)
check_that("buildExportPayload збирає subtree",
           "subtree:" in model_js)

print()
print("=" * 64)
print("БАГ 1б: функції опинилися всередині module.exports")
print("=" * 64)
# Це і є справжня причина, а не кеш. Блок
#   if (typeof module !== 'undefined' && module.exports) {
# виконується лише в Node. У браузері module не існує, тож усе, що
# опинилося всередині цього блоку, не визначається взагалі. collectSubtreeIds
# та isSubtreeExportIdentityReady опинилися саме там — downloadDeal падав
# на ReferenceError ще до fetch, тому в лозі не було жодного POST.
GUARD = "if (typeof module !== 'undefined' && module.exports) {"


def guard_block(src):
    """Тіло блоку-оболонки навколо module.exports."""
    if GUARD not in src:
        return None
    start = src.index(GUARD)
    depth = 0
    for i in range(start + len(GUARD) - 1, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start + len(GUARD):i]
    return None


for name in sorted(os.listdir(os.path.join(ROOT, "js"))):
    if not name.endswith(".js"):
        continue
    src = read(os.path.join("js", name))
    block = guard_block(src)
    if block is None:
        print(f"  ok   {name}: browser-only, оболонки немає")
        continue
    exports_at = block.find("module.exports")
    head = block if exports_at == -1 else block[:exports_at]
    # Оголошення до module.exports усередині блоку — це поламані функції.
    trapped = re.findall(r"^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))",
                         head, flags=re.M)
    trapped = [a or b for a, b in trapped]
    check_that(f"{name}: у guard немає замкнених оголошень", not trapped,
               f"знайдено {trapped}")
    check_that(f"{name}: module.exports — єдине, що всередині guard",
               exports_at != -1, "оболонка порожня")

# І навпаки: функції, які реально потрібні браузеру, мають бути
# оголошені ДО оболонки, тобто на верхньому рівні файлу.
for fn in ["collectSubtreeIds", "isSubtreeExportIdentityReady",
           "buildSubtreeExportNodes", "buildExportPayload",
           "isExportIdentityReady"]:
    at = model_js.index(f"function {fn}(")
    guard_at = model_js.find(GUARD)
    check_that(f"{fn} оголошено на верхньому рівні model.js",
               guard_at == -1 or at < guard_at,
               f"функція на {at}, оболонка на {guard_at}")

# Node має бачити ті самі функції — інакше тести зелені, а браузер
# зламаний (саме та розрив була причиною).
import subprocess  # noqa: E402
node_check = subprocess.run(
    ["node", "-e",
     "const m=require('./js/model.js');"
     "const need=['collectSubtreeIds','isSubtreeExportIdentityReady',"
     "'buildSubtreeExportNodes','buildExportPayload'];"
     "const bad=need.filter(k=>typeof m[k]!=='function');"
     "process.exit(bad.length?1:0)"],
    cwd=ROOT, capture_output=True, text=True)
check("node бачить ті самі функції", node_check.returncode, 0)
if node_check.returncode:
    print("        ", node_check.stdout.strip() or node_check.stderr.strip())

print()
print("=" * 64)
print("БАГ 2: картки не доїжджали до сервера")
print("=" * 64)
check_that("addEditorCard надсилає картку", "await persistCardToServer(deck, card);" in decks_js)
check_that("saveEditorCard надсилає картку", "await persistCardToServer(deck, card);" in decks_js)
check_that("запит містить deck_id", "deck_id: deck.id," in decks_js)
check_that("persistCardToServer має try/catch", "catch (error)" in decks_js)

# Тепер те, що показав лог: PUT /api/notes/{id} для нової картки.
print()
print("     серверний бік через TestClient")
U = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
C1 = "11111111-1111-4111-8111-111111111111"
C2 = "22222222-2222-4222-8222-222222222222"

with TestClient(main.app) as c:
    # Без авторизації ендпоїнт закритий — так і має бути.
    anon = c.put(f"/api/notes/{C1}", json={
        "deck_id": U, "cards": [{"id": C1, "values": {"Front": "a"}}]})
    check("без токена — 401 (безпека)", anon.status_code, 401)
    print("       (401, тобто ендпоінт захищено — маршрут існує)")

print()
print("     схема запиту")
note_model = main.NoteSaveRequest
check("deck_id у моделі запиту", "deck_id" in note_model.model_fields, True)
check("cards у моделі запиту", "cards" in note_model.model_fields, True)
parsed = note_model(deck_id=U, cards=[{"id": C1, "values": {"Front": "a"}}])
check("deck_id розбирається", parsed.deck_id, U)

# Старий виклик без deck_id для наявної картки мусить лишатись робочим:
# інакше поламалася б синхронізація старих клієнтів.
parsed_old = note_model(cards=[{"id": C1, "values": {"Front": "a"}}])
check("старий запит без deck_id ще валідний", parsed_old.deck_id, None)

# А нова картка без deck_id має дати зрозумілу помилку, а не 404
# «картку не знайдено» — інакше той самий баг повернеться.
empty = main.CardsReplaceRequest(cards=[])
check("запит без карток відхиляється", len(empty.cards), 0)

print()
print("     прямий виклик db.add_note існує")
check_that("db.add_note доступний", hasattr(main.database, "add_note"))

print()
print("=" * 64)
print("БАГ 3: сервер віддавав себе — .env, код і тести")
print("=" * 64)
main_src = read("main.py")
check_that("корінь репозиторію більше не монтується",
           "StaticFiles(directory=BASE_DIR, html=True)" not in main_src)
check_that("окремо монтуються лише css і js",
           '/css"' in main_src and '/js"' in main_src)

with TestClient(main.app) as c:
    # Те, що Chromium робить за один запит, але на публічній адресі
    # бачить будь-яка людина з інтернету.
    for path, want in [
        ("/.env", 404),
        ("/main.py", 404),
        ("/db/schema.sql", 404),
        ("/requirements.txt", 404),
        ("/test/test_api.py", 404),
        ("/anki_ids.py", 404),
        ("/.gitignore", 404),
    ]:
        r = c.get(path)
        check(f"{path} не віддається ({want})", r.status_code, want)
        check_that(f"{path} без секретів у тілі",
                   "DB_PASSWORD" not in r.text and "GEMINI_API_KEY" not in r.text)

    # Фронтенд при цьому мусить працювати: інакше ми просто зламали застосунок.
    check("корінь віддає index.html", c.get("/").status_code, 200)
    check_that("в корені саме застосунок", "<title>" in c.get("/").text)
    check("js/app.js доступний", c.get("/js/app.js").status_code, 200)
    check("css/style.css доступний", c.get("/css/style.css").status_code, 200)

    # /api/chat без токена: 401 ДО будь-якого звернення до Gemini, тож
    # перевірка не витрачає квоту.
    r = c.post("/api/chat", data={"message": "зроби картки", "history": "[]"})
    check("/api/chat без токена — 401", r.status_code, 401)
    r = c.post("/api/export-deck", json={
        "title": "анонім", "field_names": ["A", "B"],
        "cards": [{"id": C1, "values": {"A": "a", "B": "b"}}]})
    check("/api/export-deck без токена — 401", r.status_code, 401)

print()
print("     тимчасовий .apkg не має колоди в імені файлу")
check_that("ім'я файлу унікальне", "uuid4().hex" in main_src)
check_that("назва колоди лишилась лише в filename",
           'filename=f"{safe_title}.apkg"' in main_src)
check_that("тимчасовий файл прибирається", "BackgroundTask" in main_src)

print()
print("     файли для безкоштовного хостингу")
for name in ["requirements.txt", "render.yaml", ".env.example"]:
    check_that(f"{name} існує", os.path.exists(os.path.join(ROOT, name)))

req = read("requirements.txt")
for pkg in ["fastapi", "uvicorn", "google-genai", "genanki", "asyncpg",
            "python-dotenv", "python-multipart", "httpx"]:
    check_that(f"requirements.txt містить {pkg}", f"\n{pkg}==" in req or req.startswith(f"{pkg}=="))
render = read("render.yaml")
for marker in ["plan: free", "requirements.txt", "/api/health",
               "uvicorn main:app --host 0.0.0.0", "sync: false"]:
    check_that(f"render.yaml містить {marker!r}", marker in render)
check_that(".env у .gitignore", ".env" in read(".gitignore"))
check_that(".env.example не ігнорується", "!.env.example" in read(".gitignore"))

print()
print("     формули: MathJax у застосунку і LaTeX у промпті")
# Формули в Anki працюють самі, але в застосунку їх видно лише з MathJax.
# Якщо скрипт зникне або зміняться роздільники, користувач побачить у прев'ю
# сире "\(" — і це важко помітити без такої перевірки.
check_that("MathJax підключено", "mathjax@3" in html)
check_that("роздільники Anki налаштовані явно",
           "inlineMath: [['\\\\(', '\\\\)']]" in html.replace(" ", " ")
           and "displayMath: [['\\\\[', '\\\\]']]" in html.replace(" ", " "))
check_that("MathJax не типсетить сторінку на старті",
           "startup: { typeset: false }" in html)

chat_js = read("js/chat.js")
check_that("typesetMath існує", "function typesetMath(" in chat_js)
check_that("typesetMath не падає без MathJax", "!mathjax" in chat_js)
check_that("стрічка типсетить формули", "typesetMath(elements.messages);" in chat_js)
check_that("прев'ю типсетить формули", "typesetMath(stage);" in read("js/decks.js"))
check_that("стиль для широких формул", "mjx-container" in read("css/style.css"))

# Промпт: без правила модель пише x^2 і в Anki користувач отримує
# зламаний текст замість формули.
check_that("у промпті є правило про LaTeX", "ФОРМУЛИ" in main_src)
check_that("у промпті названо роздільник \\(", "\\\\( ... \\\\)" in main_src)
check_that("у промпті названо блоковий роздільник \\\\[", "\\\\[ ... \\\\]" in main_src)
check_that("у промпті заборонено $...$ (Anki його не розуміє)", "$...$" in main_src)
check_that("пояснено подвоєння слешів у JSON", "\\\\\\\\(x^2" in main_src)
check_that("CSS моделі має правило для MathJax", "mjx-container" in main_src)

# Модель частину формул все одно пише без роздільників («S = \pi r^2»).
# Промптом це не лікується, тож має бути страховка в коді — і не в одному
# місці, а в тому, через який проходять усі картки.
model_js = read("js/model.js")
check_that("є normalizeMathDelimiters", "function normalizeMathDelimiters(" in model_js)
check_that("normalizeCards звертається до неї", "normalizeMathDelimiters(String(value).trim())" in model_js)
check_that("словник команд містить \\pi", "'pi', 'alpha'" in model_js)
check_that("обгортка не ловить випадковий текст", "MATH_MAX_LENGTH" in model_js)

print()
print("     стиль колоди і очищення карток")
# Третя сімейство правок: користувач просив зберігати CSS окремо від
# картки, стилізувати окремі поля і очищати колоду від карток.
# Перші дві вимоги — це гачки data-field/.anki-field-N у шаблоні Anki
# (без них CSS для конкретного поля просто ні до чого не причепиться)
# і кнопка «Зберегти стиль». Третя — кнопка очищення, яка скидає
# картки через PUT /api/decks/{id}/cards, а не DELETE /api/decks/{id}:
# останній видалив би саму колоду разом із полями й стилем.
decks_js = read("js/decks.js")
app_js = read("js/app.js")
style_css = read("css/style.css")
check_that("у шаблоні є data-field", "_field_attributes(" in main_src)
check_that("назву поля екрануємо з кавичками", "quote=True" in main_src)
check_that("прев'ю дзеркалить гачки", 'data-field="${escapeHtml(name)}"' in decks_js)
check_that("прев'ю дзеркалить і клас", 'anki-field-${index + 2}' in decks_js)
check_that("секція стилю колоди в розмітці", 'id="deckStylePanel"' in html)
check_that("кнопка «Зберегти стиль»", 'id="saveDeckStyleButton"' in html)
check_that("стиль колоди — не лише побічний ефект картки",
           "async function saveDeckStyle(" in decks_js)
check_that("стиль їде на сервер окремим запитом",
           "async function saveDeckStyleToServer(" in decks_js)
check_that("збереження картки теж доїжджає зі стилем",
           "await saveDeckStyleToServer();" in decks_js)
check_that("textarea стилю не перезаписується під час набору",
           "dataset.deckId" in decks_js)
check_that("стиль колоди не губиться при перемиканні карток",
           "!isDeckStyleDirty() && elements.editorModelCss.value !== cssValue" in decks_js)
check_that("кнопка очищення колоди", 'id="clearDeckButton"' in html)
check_that("очищення питає підтвердження", "function requestClearDeckCards(" in decks_js
           and "openConfirmModal(" in decks_js)
check_that("очищення лишає колоду: PUT карток, а не DELETE колоди",
           "JSON.stringify({ cards: [] })" in decks_js
           and "method: 'DELETE', body: JSON.stringify({ cards: [] })" not in decks_js)
check_that("в обіцянці згадано, що поля і стиль лишаються",
           "поля, стиль і шаблони залишаться" in decks_js)
check_that("обидві кнопки підвішені", "elements.saveDeckStyleButton.addEventListener" in app_js
           and "elements.clearDeckButton.addEventListener" in app_js)
check_that("окреме вікно стилів у розмітці", 'id="styleModal"' in html
           and 'id="styleList"' in html and 'id="newStyleName"' in html)
check_that("кнопка відкриває вікно стилів", 'id="openStylesButton"' in html
           and "elements.openStylesButton.addEventListener('click', openStyleModal)" in app_js)
check_that("перейменування стилю окремо від застосування",
           "function commitStyleRename(" in decks_js
           and "function applyDeckStyle(" in decks_js)
check_that("стиль не перезаписується з бібліотеки навпаки",
           "const active = styles.items.find(item => item.id === styles.activeId) || styles.items[0];"
           in decks_js)
check_that("стан змін стилю в CSS", "#saveDeckStyleButton.is-dirty" in style_css)
check_that("стилі рядків бібліотеки в CSS", ".style-item" in style_css
           and ".style-badge" in style_css)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
