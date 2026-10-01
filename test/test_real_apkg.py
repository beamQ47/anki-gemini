"""
Тест стабільності на СПРАЖНЬОМУ .apkg користувача.

Навіщо окремо від test_stability.py: той працює на вигаданих даних і
доводить, що механізм стабільний. Цей бере реальну колоду з реальними
полями й перевіряє два різні випадки, які штучні дані не покривають:

  1. У файлi вже є guid, вирахувані старим способом (Anki base91-хеш,
     наприклад "ubB7*_Gb:Y..."). Пiд час імпорту вони НЕ пiсляються —
     картці видається власний UUID, бо інакше перший же експорт змінив
     би guid і Anki створив би дублікат.
  2. Поля з переносами рядків усередині значення ("HTTP/1.1 200 OK\\n...")
     мають вижити експорт без пошкодження.

Якщо файлу немає — тест пропускається, а не падає.
"""

import io
import json
import os
import sqlite3
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

import genanki
from main import build_anki_deck

ok = fail = skipped = 0


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


def find_apkg() -> Path | None:
    env = os.environ.get("ANKI_APKG")
    if env:
        p = Path(env)
        return p if p.exists() else None
    desktop = Path.home() / "Desktop"
    found = sorted(desktop.glob("*.apkg")) if desktop.exists() else []
    return found[0] if found else None


def read_apkg(path: Path) -> dict:
    """Витягує поля й картки зі справжнього .apkg."""
    with zipfile.ZipFile(path) as z:
        anki2 = [n for n in z.namelist() if n.endswith(".anki2")][0]
        tmp = Path(tempfile.mkdtemp()) / "collection.anki2"
        tmp.write_bytes(z.read(anki2))
    con = sqlite3.connect(tmp)
    try:
        notes = con.execute("select guid, flds, sfld from notes").fetchall()
        col = con.execute("select models, decks from col").fetchone()
    finally:
        con.close()

    models = json.loads(col[0]) if col and col[0] else {}
    fields = []
    if models:
        first = next(iter(models.values()))
        fields = [f["name"] for f in first.get("flds", [])]

    deck_name = ""
    if col and col[1]:
        decks = json.loads(col[1])
        for d in decks.values():
            if d.get("name") and d.get("name") != "Default":
                deck_name = d["name"]
                break
        if not deck_name and decks:
            deck_name = next(iter(decks.values())).get("name", "")

    return {
        "fields": fields,
        "deck_name": deck_name,
        "notes": [{"guid": g, "values": (f or "").split("\x1f")} for g, f, _ in notes],
    }


def export(title, field_names, cards, deck_uuid, css=""):
    """Експорт через справжній build_anki_deck, повертає (шлях, guid-и)."""
    deck = build_anki_deck(
        title=title,
        field_names=field_names,
        cards=cards,
        css=css,
        templates=None,
        deck_uuid=deck_uuid,
    )
    path = os.path.join(tempfile.mkdtemp(), "out.apkg")
    genanki.Package(deck).write_to_file(path)

    guids = []
    with zipfile.ZipFile(path) as z:
        anki2 = [n for n in z.namelist() if n.endswith(".anki2")][0]
        tmp = Path(tempfile.mkdtemp()) / "check.anki2"
        tmp.write_bytes(z.read(anki2))
    con = sqlite3.connect(tmp)
    try:
        guids = [g for (g,) in con.execute("select guid from notes")]
        flds = [f for (f,) in con.execute("select flds from notes")]
    finally:
        con.close()
    return path, guids, flds


apkg = find_apkg()
if apkg is None:
    print("Пропущено: .apkg не знайдено. Вкажи шлях у ANKI_APKG.")
    sys.exit(0)

print(f"Файл: {apkg.name} ({apkg.stat().st_size/1024:.1f} КБ)")
data = read_apkg(apkg)
fields = data["fields"]
notes = data["notes"]
original_deck_name = data["deck_name"]

print(f"  колода  : {original_deck_name}")
print(f"  поля    : {fields}")
print(f"  картки  : {len(notes)}")
print(f"  старі guid: {[n['guid'][:12] for n in notes]}")
print()

print("Вхідні дані")
check("поля прочитані", len(fields) > 0, True)
check("картки прочитані", len(notes) > 0, True)
check_that(
    "у файлі guid не UUID (старий спосіб)",
    not all(len(n["guid"]) == 36 for n in notes),
    f"={[n['guid'] for n in notes]}",
)

# Саме так працює міграція на фронтенді: кожній картці видається власний
# UUID, старий guid з файлу не переноситься.
deck_uuid = str(uuid.uuid4())
cards = []
for n in notes:
    card_uuid = str(uuid.uuid4())
    cards.append({"id": card_uuid, "values": dict(zip(fields, n["values"]))})

card_ids = [c["id"] for c in cards]
check("кожній картці видано UUID", all(len(i) == 36 for i in card_ids), True)
check("UUID унікальні", len(set(card_ids)), len(card_ids))

print()
print("Перший експорт")
path1, guids1, flds1 = export("Коди HTTP", fields, cards, deck_uuid)
check("експорт створив файл", os.path.exists(path1), True)
check("кількість guid = кількості карток", len(guids1), len(cards))
check("guid у файлі = id картки", sorted(guids1), sorted(card_ids))
check_that("старий guid не потрапив у файл", not set(guids1) & {n["guid"] for n in notes})

# Переноси рядків усередині значення мають зберегтися.
multiline = [f for f in flds1 if "\x1f" in f and "\n" in f]
check_that("значення з переносом рядків збережено", len(multiline) >= 1, f"знайдено {len(multiline)}")

print()
print("Повторний експорт без змін")
_, guids2, _ = export("Коди HTTP", fields, cards, deck_uuid)
check("guid ідентичні", sorted(guids2), sorted(guids1))

print()
print("Редагування картки + перейменування колоди")
edited = [dict(c) for c in cards]
edited[0]["values"] = dict(edited[0]["values"])
edited[0]["values"]["Код"] = "201"
edited[0]["values"]["Назва"] = "Created"
renamed_deck = str(uuid.uuid4())  # новий UUID колоди = перейменування

_, guids3, flds3 = export("Коди HTTP — оновлено", fields, edited, renamed_deck)
check("КЛЮЧОВЕ: guid не змінились після редагування", sorted(guids3), sorted(guids1))
check_that("зміст картки оновлено", any("201" in f for f in flds3))
check_that("старе значення 200 зникло з картки", not any(f.startswith("201\x1f") and "OK" in f.split("\x1f")[1] for f in flds3 if "\x1f" in f))

print()
print("Видалення картки")
subset = [c for c in cards[1:]]
_, guids4, _ = export("Коди HTTP", fields, subset, deck_uuid)
check("видалена картка зникла", len(guids4), len(subset))
check("решта guid ідентичні", sorted(guids4), sorted(card_ids[1:]))

print()
print("Додавання нової картки")
added = [dict(c) for c in cards]
new_id = str(uuid.uuid4())
added.append({"id": new_id, "values": dict(zip(fields, ["418", "I'm a teapot", "HTTP/1.1 418", "RFC 9110", "Жарт."]))})
_, guids5, _ = export("Коди HTTP", fields, added, deck_uuid)
check("нова картка додана", len(guids5), len(added))
check("старі guid не змінились", sorted(set(guids5) - {new_id}), sorted(set(card_ids)))
check("новий guid = новий id", new_id in guids5, True)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
