"""
Безкоштовний tier не гарантує ємності, і Google відповідає на найновіші
моделі 503 UNAVAILABLE. Спершу код намагався три рази з паузою 2 секунди
з тією самою моделлю: усі три спроби влучали в одне вікно перевантаження,
тож користувач бачив «Спроба 3 не вдалася» і жодного результату.

Тепер запит проходить ланцюжок моделей і перемикається на наступну на
перевантаженні, на вичерпаній квоті та на порожній відповіді.

Gemini тут підміняється: тест має бути детермінованим і не витрачати
реальний ліміт.
"""
import asyncio
import io
import os
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
        print(f"  FAIL {label}" + (f"\n         {detail}" if detail else ""))


class Boom(Exception):
    """Помилка у тому ж вигляді, що й від SDK: код перед текстом, без пробіла.

    Так тест звіряється з реальним рядком, а не зі зручною для тесту
    власною формою: саме через розбіжність у розпізнаванні коду помилки
    код мимо падав у повторні спроби.
    """

    def __init__(self, text):
        super().__init__(text)


def err(code, message):
    return Boom(f"{code} {{'error': {{'code': {code}, 'message': '{message}'}}}}")


def patch(scripts):
    """Підміняє клієнт Gemini: {модель: текст помилки або рядок відповіді}."""
    calls = []

    class Models:
        async def generate_content(self, model=None, config=None, contents=None):
            calls.append(model)
            result = scripts[model]
            if isinstance(result, Boom):
                raise result
            return type("R", (), {"text": result})()

    class Aio:
        models = Models()

    main.client = type("C", (), {"aio": Aio()})()
    return calls


async def run(scripts, chain=None, attempts=None):
    calls = patch(scripts)
    saved = main.MODEL_CHAIN, main.ATTEMPTS_PER_MODEL
    if chain is not None:
        main.MODEL_CHAIN = chain
    if attempts is not None:
        main.ATTEMPTS_PER_MODEL = attempts
    try:
        return await main.ask_ai("питання", [], None, None), calls
    finally:
        main.MODEL_CHAIN, main.ATTEMPTS_PER_MODEL = saved
        main.client = None


print("Ланцюжок за замовчуванням")
check("це список моделей", isinstance(main.MODEL_CHAIN, list), True)
check("не порожній", len(main.MODEL_CHAIN) > 0, True)
check("усі моделі названі рядками", all(isinstance(m, str) and m for m in main.MODEL_CHAIN), True)
check("перша модель — найшвидша", main.MODEL_CHAIN[0], "gemini-3.5-flash-lite")
check("є модель, що бачить фото", "gemini-3.1-flash-lite" in main.MODEL_CHAIN, True)

print("\nПерша модель відповіла — ланцюжок не витрачається далі")
reply, calls = asyncio.run(run({"a": "відповідь", "b": "не треба"}, chain=["a", "b"]))
check("повернуто відповідь", reply, "відповідь")
check("зроблено один запит", len(calls), 1)
check("запит пішов у першу модель", calls[0], "a")

print("\n503 на першій моделі — переходимо на наступну")
reply, calls = asyncio.run(run(
    {"a": err(503, "high demand"), "b": "відповідь другої"},
    chain=["a", "b"], attempts=2,
))
check("повернуто відповідь другої", reply, "відповідь другої")
check("спершу пробували a двічі, потім b", calls, ["a", "a", "b"])
check("на a витрачено рівно дві спроби", calls.count("a"), 2)

print("\n503 на всіх — чесна помилка, а не «спроба не вдалася»")
reply, calls = asyncio.run(run(
    {"a": err(503, "high demand"), "b": err(503, "high demand")},
    chain=["a", "b"], attempts=1,
))
check_that("запитано обидві моделі", calls == ["a", "b"], str(calls))
check_that("згадано 503", "503" in reply, reply)
check_that("сказано, що це тимчасово", "тимчас" in reply.lower(), reply)
check_that("показано останню помилку", "high demand" in reply, reply)

print("\n429 (вичерпана квота) — не повторюємо ту саму модель")
reply, calls = asyncio.run(run(
    {"a": err(429, "RESOURCE_EXHAUSTED"), "b": "відповідь"},
    chain=["a", "b"], attempts=3,
))
check("повернуто відповідь", reply, "відповідь")
check("a викликана один раз, не три", calls.count("a"), 1)
check("b викликана один раз", calls.count("b"), 1)

print("\n429 на всіх — кажемо про безкоштовний ліміт, а не про біллінг")
reply, calls = asyncio.run(run(
    {"a": err(429, "RESOURCE_EXHAUSTED"), "b": err(429, "RESOURCE_EXHAUSTED")},
    chain=["a", "b"], attempts=3,
))
check_that("згадано ліміт", "ліміт" in reply.lower(), reply)
check_that("не обіцяємо перейти на платний", "біллінг" not in reply.lower(), reply)
check_that("кажемо, що оновлюється за добу", "добу" in reply.lower(), reply)

print("\nПорожня відповідь — теж невдача, а не результат")
reply, calls = asyncio.run(run(
    {"a": None, "b": "відповідь"},
    chain=["a", "b"], attempts=1,
))
check("повернуто відповідь наступної", reply, "відповідь")
check("порожню модель не прийнято за успіх", calls, ["a", "b"])

print("\n400/401/404 — конфіг, повторювати марно")
for code in (400, 401, 404):
    reply, calls = asyncio.run(run(
        {"a": err(code, "bad"), "b": "не повинна викликатись"},
        chain=["a", "b"], attempts=3,
    ))
    check_that(f"{code} зупиняє ланцюжок одразу", calls == ["a"], str(calls))
    check_that(f"{code} показано користувачу", f"Помилка Gemini API" in reply, reply)

print("\nМодель без ключа — зрозуміла підказка")
main.client = None
reply = asyncio.run(main.ask_ai("питання", [], None, None))
check_that("згадано GEMINI_API_KEY", "GEMINI_API_KEY" in reply, reply)

print("\nФайли, які модель уміє читати")
check("png", main.resolve_mime_type(type("D", (), {"content_type": "image/png", "filename": "a.png"})()), "image/png")
check("jpeg", main.resolve_mime_type(type("D", (), {"content_type": "image/jpeg", "filename": "a.jpg"})()), "image/jpeg")
check("txt", main.resolve_mime_type(type("D", (), {"content_type": "text/plain", "filename": "a.txt"})()), "text/plain")
check("pdf", main.resolve_mime_type(type("D", (), {"content_type": "application/pdf", "filename": "a.pdf"})()), "application/pdf")
check_that("docx відхилено", main.resolve_mime_type(
    type("D", (), {"content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                   "filename": "a.docx"})()) is None, "docx має падати")
check_that("загальний octet-stream + розширення = розширення",
           main.resolve_mime_type(type("D", (), {"content_type": "application/octet-stream",
                                                 "filename": "a.png"})()) == "image/png", "")
check_that("невідомий тип без розширення відхилено",
           main.resolve_mime_type(type("D", (), {"content_type": "", "filename": "noext"})()) is None, "")

print("\nЕндпоінт відсікає те, що модель не прочитає")


FORM = {"message": "зроби картки", "history": "[]"}


def upload(name, content_type, data):
    # httpx очікує файловий об'єкт, а не bytes.
    return {"document": (name, io.BytesIO(data), content_type)}


async def fake_ai(prompt_text, history_list, file_bytes, mime_type, **kwargs):
    return "ok"


main.ask_ai = fake_ai
# Ендпоїнт закритий токеном (див. main.py): перевірка тут не про авторизацію,
# тож підміняємо залежність, а не пишемо Bearer у кожен виклик.
main.app.dependency_overrides[main.current_user_id] = lambda: "11111111-1111-4111-8111-111111111111"
with TestClient(main.app) as client:
    r = client.post("/api/chat", data=FORM, files=upload("a.docx", "application/msword", b"x"))
    check("docx — 400", r.status_code, 400)
    check_that("пояснено, що підтримується", "Підтримуються" in r.json()["detail"], r.text)

    r = client.post("/api/chat", data=FORM, files=upload("a.png", "image/png", b"\x89PNG fake"))
    check("png — 200", r.status_code, 200)

    r = client.post("/api/chat", data=FORM, files=upload("a.txt", "text/plain", "лекція".encode("utf-8")))
    check("txt — 200", r.status_code, 200)

    big = b"0" * (main.MAX_UPLOAD_BYTES + 10)
    r = client.post("/api/chat", data=FORM, files=upload("a.pdf", "application/pdf", big))
    check("завеликий файл — 413", r.status_code, 413)
    check_that("згадано ліміт у мегабайтах", "МБ" in r.json()["detail"], r.text)

    r = client.post("/api/chat", data={"message": "зроби картки", "history": "не json"},
                    files=upload("a.png", "image/png", b"\x89PNG"))
    check("бита історія не ламає запит", r.status_code, 200)

print("\nБраузер не дозволяє вибрати те, що сервер відхилить")
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
accept = html.split('id="fileInput"', 1)[1].split(">", 1)[0]
for ext in (".png", ".jpg", ".webp", ".pdf", ".txt"):
    check_that(f"accept містить {ext}", ext in accept, accept[:120])
check_that("docx прибрано з accept", ".docx" not in accept, accept[:120])

app_js = open(os.path.join(ROOT, "js", "app.js"), encoding="utf-8").read()
check_that("docx прибрано зі списку розширень", "'docx'" not in app_js, "")
for ext in ("png", "jpg", "jpeg", "webp", "heic", "pdf", "txt", "md", "csv"):
    check_that(f"браузер пускає .{ext}", f"'{ext}'" in app_js, "")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
