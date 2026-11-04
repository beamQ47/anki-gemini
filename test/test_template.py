import sys, io, zipfile, json, sqlite3, tempfile, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")
import genanki
from main import build_anki_deck, build_card_templates, merge_css, FIELD_STYLES_CSS

ok = fail = 0
def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")
def check_that(label, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  ok   {label}")
    else: fail += 1; print(f"  FAIL {label} {extra}")

FIELDS = ["Код", "Назва", "Приклад", "Джерело", "Нотатка"]
CARDS = [{"Код": "200", "Назва": "OK", "Приклад": "HTTP 200", "Джерело": "RFC 9110", "Нотатка": "успіх"}]

print("build_card_templates")
t = build_card_templates(FIELDS)[0]
check("один шаблон", len(build_card_templates(FIELDS)), 1)
check_that("на лицьовій лише перше поле", t["qfmt"].count("{{") == 1 and "{{Код}}" in t["qfmt"])
check("на зворотному 4 поля + FrontSide", t["afmt"].count("anki-field-value"), 4)
check_that("кожне поле має підпис", t["afmt"].count("anki-field-name") == 4)
check_that("підписи екрановані", "&" in t["afmt"] or "Поле" not in t["afmt"])
check_that("роздільник відповіді", '<hr id="answer">' in t["afmt"])
check_that("пропущені поля імені не потрапляють у шаблон",
           all(f"{{{{{f}}}}}" in t["afmt"] for f in FIELDS[1:]))

print("\nімена полів з HTML не ламають розмітку")
from main import sanitize_field_names
clean = sanitize_field_names(["Питання", '<script>x</script>', "{{Підміна}}", 'A"B'])
check("небезпечні символи вирізано", clean, ["Питання", "scriptx/script", "Підміна", "AB"])
danger = build_card_templates(clean)[0]
check_that("сирий тег відсутній", "<script>" not in danger["afmt"])
check_that("немає підміни {{", "{{{{Підміна}}}}" not in danger["afmt"])

print("\nгачки для стилізації окремих полів")
t2 = build_card_templates(FIELDS)[0]
check_that("питання має data-field", 'data-field="Код"' in t2["qfmt"])
check_that("питання має номерний клас", 'anki-field-1' in t2["qfmt"])
check_that("зворотне поле має data-field", 'data-field="Приклад"' in t2["afmt"])
check_that("номери полів за порядком",
           all(f'anki-field-{i + 2}' in t2["afmt"] for i in range(len(FIELDS) - 1)))
check_that("data-field на кожному полі",
           all(f'data-field="{f}"' in t2["afmt"] or f'data-field="{f}"' in t2["qfmt"]
               for f in FIELDS))
raw = build_card_templates(['A"B', "O'Brien"])[0]
check_that("лапки в імені екрановані (питання)", 'data-field="A&quot;B"' in raw["qfmt"])
check_that("лапки в імені екрановані (поле)", 'data-field="O&#x27;Brien"' in raw["afmt"])
check_that("сирої лапки всередині атрибута немає", 'data-field="A"B"' not in raw["qfmt"])

print("\nmerge_css")
merged = merge_css(".card { color: red; }")
check_that("CSS Gemini присутній", "color: red" in merged)
check_that("базові стилі є", ".anki-question" in merged)
check_that("стилі полів останні", merged.rstrip().endswith("}"))
check_that("стилі полів після CSS Gemini",
           merged.index("color: red") < merged.index(".anki-field-name"))
check_that("порожній CSS не ламає", bool(merge_css("").strip()))

print("\nреальний .apkg")
deck = build_anki_deck("НПЗІБ", FIELDS, CARDS, css=".card { color: #123456; }")
path = os.path.join(tempfile.mkdtemp(), "t.apkg")
genanki.Package(deck).write_to_file(path)

d = tempfile.mkdtemp()
with zipfile.ZipFile(path) as z:
    z.extract("collection.anki2", d)
models = json.loads(sqlite3.connect(os.path.join(d, "collection.anki2"))
                    .execute("select models from col").fetchone()[0])
m = list(models.values())[0]

check("полів у моделі", [f["name"] for f in m["flds"]], FIELDS)
check("шаблон один", len(m["tmpls"]), 1)
afmt = m["tmpls"][0]["afmt"]
check("блоків полів", afmt.count('class="anki-field anki-field-'), 4)
check("підписів полів", afmt.count('<div class="anki-field-name">'), 4)
check_that("усі 5 імен у шаблоні", all(f"{{{{{f}}}}}" in afmt or f"{{{{{f}}}}}" in m["tmpls"][0]["qfmt"] for f in FIELDS))
check_that("Anki не відкинув наш CSS", "anki-field-name" in m["css"])
check_that("CSS Gemini збережено", "#123456" in m["css"])
check_that("стилі полів після CSS Gemini", m["css"].index("#123456") < m["css"].index(".anki-field-name"))

print("\nочищення філерів у build_anki_deck")
test_cards_filler = [
    {"Питання": "Що таке матеріальна точка?", "Відповідь": "Ідеалізоване тіло", "Пояснення": "—", "Позначення": "немає"}
]
filler_deck = build_anki_deck("Тест", ["Питання", "Відповідь", "Пояснення", "Позначення"], test_cards_filler)
note_fields = filler_deck.notes[0].fields
check("філер у Пояснення замінено на порожній рядок", note_fields[2], "")
check("філер у Позначення замінено на порожній рядок", note_fields[3], "")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
