"""
Тест на текстове кодування всього, що бачить користувач.

Історія. Користувач повідомив, що «везде з локалізацією проблеми», і
показав рядок на екрані входу. Найочевидніше пояснення — погана
кодування на стороні сервера — не підтвердилося: усі відповіді мали
charset=utf-8, усі файли були валідним UTF-8.

Причина виявилася простішою й гіршою: у самому index.html майже весь
український текст був уже записаний в розтвореному вигляді. Байти
правильні, прочитані не тією кодовою сторінкою — і жоден тест на
кодування не міг це помітити, бо файл валідний UTF-8.

Тому тест перевіряє не «файл валідний», а «текст осмислений»: для
кожного рядка робимо encode('cp1251') -> decode('utf-8'). Якщо
round-trip вдається, байти були правильними, значить текст зіпсований.
Звичайний український текст такого round-trip не витримує.

Ще два різні дефекти, які цей тест ловить теж:
  * U+FFFD — символ, який пише редактор, не змігши показати байт.
    Байти вже втрачено, але хоча б видно, де текст пошкоджено.
  * BOM на початку файлу. Тут він нешкідливий, але ламає порівняння
    першого рядка з еталоном у тестах.
"""
import io
import os
import re
import sys
import unicodedata

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = r"E:\learning\projects\anki-telegram-bot"
SKIP = re.compile(r"\\(venv|node_modules|__pycache__)\\|\.(db|apkg|sqlite)$")
SOURCE = re.compile(r"\.(js|py|html|css|sql|json)$")

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


def round_trips(value):
    """Чи є рядок розтвореним UTF-8, прочитаним як cp1251."""
    if not value.strip():
        return False
    try:
        raw = value.encode("cp1251")
    except UnicodeEncodeError:
        return False
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if decoded == value:
        return False
    letters = len(re.findall(r"[\u0400-\u04FF]", decoded))
    return letters >= 2 and any(
        unicodedata.category(ch).startswith("L") for ch in decoded)


files = []
for base, dirs, names in os.walk(ROOT):
    dirs[:] = [d for d in dirs if not SKIP.search(os.path.join(base, d) + "\\")]
    for name in sorted(names):
        path = os.path.join(base, name)
        if SKIP.search(path) or not SOURCE.search(name):
            continue
        files.append(path)

print("Файли читаються як UTF-8 без BOM")
broken = [os.path.relpath(p, ROOT) for p in files
          if open(p, "rb").read(3) == b"\xef\xbb\xbf"]
check("жодного BOM", broken, [])
unreadable = []
for path in files:
    try:
        open(path, encoding="utf-8").read()
    except UnicodeDecodeError:
        unreadable.append(os.path.relpath(path, ROOT))
check("усі файли валідний UTF-8", unreadable, [])

print("\nЖодного розтвореного тексту")
# Саме те, що бачив користувач на екрані входу.
bad = []
for path in files:
    rel = os.path.relpath(path, ROOT)
    for i, line in enumerate(open(path, encoding="utf-8").read().splitlines(), 1):
        if round_trips(line):
            bad.append(f"{rel}:{i}")
check("розтворених рядків немає", bad, [])

print("\nЖодного U+FFFD")
# U+FFFD — це не проблема кодування, а вже втрачені байти. Просто
# неприємно: у коді виглядає як звичайний символ.
lost = []
for path in files:
    rel = os.path.relpath(path, ROOT)
    for i, line in enumerate(open(path, encoding="utf-8").read().splitlines(), 1):
        if "\ufffd" in line:
            lost.append(f"{rel}:{i}")
check("замість символів немає", lost, [])

print("\nЕкран входу читається")
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
for label, expected in [
    ("заголовок", "Вхід"),
    ("пояснення", "Колоди зберігаються у вашому акаунті"),
    ("placeholder пошти", 'placeholder="Електронна пошта"'),
    ("placeholder пароля", 'placeholder="Пароль"'),
    ("кнопка входу", "Увійти"),
    ("підказка про акаунт", "Акаунт створює адміністратор"),
    ("заголовок колод", "Мої колоди Anki"),
    ("порожній стан", "Ще немає колод"),
    ("мітка редактора", "Редактор колоди"),
    ("приклад шляху", "Наприклад, університет::математика::лекція 1"),
    ("заголовок прев'ю", "Перегляд карток"),
    ("лицьова сторона", "Лицьова сторона картки"),
    ("зворотна сторона", "Зворотна сторона картки"),
    ("порожнє прев'ю", "У цій колоді ще немає карток"),
    ("плейсхолдер чату", "Поставте запитання або попросіть створити картки"),
    ("підказка Enter", "Натисніть Enter для відправки"),
]:
    check_that(f"{label}", expected in html, f"не знайдено: {expected!r}")

check("meta charset на місці", '<meta charset="UTF-8">' in html, True)
check("charset у перших 1024 байтах",
      html[:1024].lower().find('charset="utf-8"') != -1, True)

print("\nУкраїнський текст у коді не розтворений")
# Коментарі та рядки-літерали теж мають читатися: смачні коментарі
# пишуть ті, хто їх читає.
for path in files:
    rel = os.path.relpath(path, ROOT)
    # Цей файл сам містить regex із символами U+0420/U+FFFD, які
    # скануються, тож він не може перевіряти сам себе. Одноразові
    # скрипти пошуку mojibake (find_mojibake, repair_mojibake,
    # repair_chars) видалені разом із їхніми винятками.
    if rel in ("test\\test_encoding.py",):
        continue
    text = open(path, encoding="utf-8").read()
    check_that(f"{rel} без «Р» перед non-ASCII",
               not re.search(r"\u0420[\u0080-\u00BF]", text), "схоже на mojibake")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
