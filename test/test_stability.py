"""
Тест головної вимоги: повторний імпорт після редагування має оновлювати
картку, а не створювати нову.

Перевіряється на справжньому .apkg — читається guid із collection.anki2.
Це важливо: на підставі функцій стабільність лише обіцяється, а на
підставі файлу вона доводиться. Саме тут раніше був баг
guid_for(deck_name, f"{index}:{head}:{value}") — редагування питання
змінювало guid, і Anki створював дублікат.
"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

import genanki
from main import build_anki_deck

ok = fail = 0
def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")

def check_that(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label} {detail}")


def export_to_temp(title, field_names, cards, deck_uuid):
    """Експорт через справжній build_anki_deck + запис .apkg, повертає шлях."""
    deck = build_anki_deck(
        title=title,
        field_names=field_names,
        cards=cards,
        css="",
        templates=None,
        deck_uuid=deck_uuid,
    )
    path = os.path.join(tempfile.mkdtemp(), "deck.apkg")
    genanki.Package(deck).write_to_file(path)
    return path


def read_apkg(path):
    """Повертає {guid: [значення полів]} і (deck_id, model_id) з .apkg."""
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())

    con = sqlite3.connect(tmp)
    try:
        models_json, decks_json = con.execute("select models, decks from col").fetchone()
        notes = {}
        for guid, flds in con.execute("select guid, flds from notes"):
            notes[guid] = flds.split("\x1f")
        decks_raw = json.loads(decks_json)
        # genanki завжди додає стандартну "Default" з id=1, тому
        # перевіряємо id саме нашої колоди, а не всіх.
        ours = [d for d in decks_raw.values() if d.get("name") != "Default"]
        deck_ids = sorted(int(d["id"]) for d in ours)
        model_ids = sorted(int(m["id"]) for m in json.loads(models_json).values())
    finally:
        con.close()
    return notes, deck_ids, model_ids


DECK_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
C1 = "550e8400-e29b-41d4-a716-446655440000"
C2 = "dc768abe-e8d4-4736-b210-0628c765a9d1"
FIELDS = ["Код", "Назва", "Приклад"]

print("Базовий експорт")
first = export_to_temp(
    "HTTP — Лекція 1", FIELDS,
    [
        {"id": C1, "Код": "200", "Назва": "OK", "Приклад": "HTTP 200"},
        {"id": C2, "Код": "404", "Назва": "Not Found", "Приклад": ""},
    ],
    DECK_UUID,
)
notes_a, decks_a, models_a = read_apkg(first)
check("дві нотатки", len(notes_a), 2)
check("guid = власний uuid картки", sorted(notes_a.keys()), sorted([C1, C2]))
check("значення першої картки", notes_a[C1], ["200", "OK", "HTTP 200"])
check("deck id 10 цифр", all(1_000_000_000 <= d <= 9_999_999_999 for d in decks_a), True)
check("model id 10 цифр", all(1_000_000_000 <= m <= 9_999_999_999 for m in models_a), True)

print("\nПовторний експорт без змін -> ті самі guid, ті самі deck id")
second = export_to_temp(
    "HTTP — Лекція 1", FIELDS,
    [
        {"id": C1, "Код": "200", "Назва": "OK", "Приклад": "HTTP 200"},
        {"id": C2, "Код": "404", "Назва": "Not Found", "Приклад": ""},
    ],
    DECK_UUID,
)
notes_b, decks_b, models_b = read_apkg(second)
check("guid не змінились", sorted(notes_b.keys()), sorted(notes_a.keys()))
check("кількість нотаток та сама", len(notes_b), 2)
check("deck id стабільний", decks_b, decks_a)
check("model id стабільний", models_b, models_a)

print("\nРедагування картки -> guid той самий, значення оновлені")
third = export_to_temp(
    "HTTP — Лекція 1", FIELDS,
    [
        {"id": C1, "Код": "201", "Назва": "Created", "Приклад": "HTTP 201"},
        {"id": C2, "Код": "404", "Назва": "Not Found", "Приклад": ""},
    ],
    DECK_UUID,
)
notes_c, decks_c, models_c = read_apkg(third)
check("КЛЮЧОВЕ: guid не змінились після редагування", sorted(notes_c.keys()), sorted(notes_a.keys()))
check("немає нових нотаток", len(notes_c), 2)
check("значення оновлені", notes_c[C1], ["201", "Created", "HTTP 201"])
check("незмінна картка не зачепилась", notes_c[C2], ["404", "Not Found", ""])
check("deck id стабільний після редагування", decks_c, decks_a)

print("\nПерейменування колоди -> deck id той самий")
renamed = export_to_temp(
    "HTTP — Лекція 1 (оновлено)", FIELDS,
    [
        {"id": C1, "Код": "201", "Назва": "Created", "Приклад": "HTTP 201"},
        {"id": C2, "Код": "404", "Назва": "Not Found", "Приклад": ""},
    ],
    DECK_UUID,
)
notes_d, decks_d, models_d = read_apkg(renamed)
check("КЛЮЧОВЕ: deck id не залежить від назви", decks_d, decks_a)
check("model id не залежить від назви", models_d, models_a)
check("guid не змінились", sorted(notes_d.keys()), sorted(notes_a.keys()))

print("\nДодавання картки -> старі не зникають, нова з'являється")
added = export_to_temp(
    "HTTP — Лекція 1 (оновлено)", FIELDS,
    [
        {"id": C1, "Код": "201", "Назва": "Created", "Приклад": "HTTP 201"},
        {"id": C2, "Код": "404", "Назва": "Not Found", "Приклад": ""},
        {"id": "11111111-2222-4333-8444-555555555555", "Код": "500", "Назва": "Error", "Приклад": ""},
    ],
    DECK_UUID,
)
notes_e, decks_e, _ = read_apkg(added)
check("тепер три нотатки", len(notes_e), 3)
check("нові guid додалися до старих", sorted(notes_e.keys()),
      sorted(list(notes_a.keys()) + ["11111111-2222-4333-8444-555555555555"]))
check("deck id не змінився від додавання", decks_e, decks_a)

print("\nВидалення картки -> Anki видалить її, бо guid знайомий")
removed = export_to_temp(
    "HTTP — Лекція 1 (оновлено)", FIELDS,
    [{"id": C1, "Код": "201", "Назва": "Created", "Приклад": "HTTP 201"}],
    DECK_UUID,
)
notes_f, _, _ = read_apkg(removed)
check("лишилася тільки потрібна картка", list(notes_f.keys()), [C1])

print("\nСтарі клієнти без id -> експорт працює, але без стабільності")
legacy = export_to_temp(
    "Стара колода", FIELDS,
    [{"Код": "200", "Назва": "OK", "Приклад": ""}],
    DECK_UUID,
)
notes_g, _, _ = read_apkg(legacy)
check("картка експортується", len(notes_g), 1)
check("guid не порожній", all(g for g in notes_g), True)
check_that("guid НЕ uuid (усідає на legacy-фолбек)",
           "legacy:" not in list(notes_g)[0] and len(list(notes_g)[0]) > 8)

print("\nКартки без deck_uuid -> назва колоди більше не визначає ID")
no_uuid = export_to_temp("Назва без uuid", FIELDS, [{"Код": "1", "Назва": "", "Приклад": ""}], "не-uuid")
notes_h, decks_h, _ = read_apkg(no_uuid)
check_that("експорт не впав", len(notes_h) == 1, f"got {len(notes_h)}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
