"""
Тести канонічних спільних моделей Anki (дедуплікація стилів).

Перевіряє:
1. Кілька колод/лекцій з однаковими полями та стилем ділять одну модель (1 стиль в Anki).
2. Картки коректно прив'язані до своїх колод (did), а не змішуються.
3. Колоди з різними полями або стилями отримують окремі зрозумілі моделі.
4. Повторний експорт колоди дає стабільний model_id, що запобігає створенню дублікатів з '+'.
"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import uuid as uuid_mod
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

import genanki
from anki_ids import canonical_model_id, canonical_model_name, deck_anki_id
from main import DeckExportRequest, build_anki_deck, build_subtree_package

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


def read_apkg(package: genanki.Package):
    """Повертає {deck_id: name}, {guid: did}, {model_id: model_name}."""
    tmp_path = os.path.join(tempfile.mkdtemp(), "test.apkg")
    package.write_to_file(tmp_path)
    with zipfile.ZipFile(tmp_path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            db_path = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(db_path, "wb") as out:
                out.write(fh.read())

    con = sqlite3.connect(db_path)
    try:
        decks_json, models_json = con.execute("select decks, models from col").fetchone()
        cards = list(con.execute("select notes.guid, cards.did from notes join cards on cards.nid = notes.id"))
    finally:
        con.close()

    decks = {int(k): v["name"] for k, v in json.loads(decks_json).items()}
    models = {int(k): v["name"] for k, v in json.loads(models_json).items()}
    cards_did = {g: d for g, d in cards}
    return decks, cards_did, models


print("1. Дедуплікація моделей у піддереві (курс із кількох лекцій)")
U = str(uuid_mod.uuid4())
L1 = str(uuid_mod.uuid4())
L2 = str(uuid_mod.uuid4())
L3 = str(uuid_mod.uuid4())
C1, C2, C3 = (str(uuid_mod.uuid4()) for _ in range(3))

req = DeckExportRequest(
    title="Курс кібербезпеки",
    field_names=["Питання", "Відповідь", "Пояснення"],
    deck_id=U,
    ancestors=[],
    cards=[],
    style_name="Неон",
    css=".card { background: #000; }",
    subtree=[
        {
            "deck_id": L1,
            "title": "Лекція 1",
            "field_names": ["Питання", "Відповідь", "Пояснення"],
            "css": ".card { background: #000; }",
            "templates": [],
            "style_name": "Неон",
            "cards": [{"id": C1, "values": {"Питання": "Q1", "Відповідь": "A1", "Пояснення": "E1"}}],
            "ancestors": [{"id": U, "title": "Курс кібербезпеки"}],
        },
        {
            "deck_id": L2,
            "title": "Лекція 2",
            "field_names": ["Питання", "Відповідь", "Пояснення"],
            "css": ".card { background: #000; }",
            "templates": [],
            "style_name": "Неон",
            "cards": [{"id": C2, "values": {"Питання": "Q2", "Відповідь": "A2", "Пояснення": "E2"}}],
            "ancestors": [{"id": U, "title": "Курс кібербезпеки"}],
        },
        {
            "deck_id": L3,
            "title": "Лекція 3",
            "field_names": ["Питання", "Відповідь", "Пояснення"],
            "css": ".card { background: #000; }",
            "templates": [],
            "style_name": "Неон",
            "cards": [{"id": C3, "values": {"Питання": "Q3", "Відповідь": "A3", "Пояснення": "E3"}}],
            "ancestors": [{"id": U, "title": "Курс кібербезпеки"}],
        },
    ],
)

root = build_anki_deck(
    title=req.title,
    field_names=req.field_names,
    cards=[],
    deck_uuid=req.normalized_deck_uuid(),
    ancestors=req.normalized_ancestors(),
    style_name=req.style_name,
    css=req.css,
)

pkg = build_subtree_package(root, req.normalized_ancestors(), req.subtree)
decks, cards_did, models = read_apkg(pkg)

check("усі 3 лекції мають картки", len(cards_did), 3)
check("картка Лекції 1 у Лекції 1", cards_did[C1], deck_anki_id(L1))
check("картка Лекції 2 у Лекції 2", cards_did[C2], deck_anki_id(L2))
check("картка Лекції 3 у Лекції 3", cards_did[C3], deck_anki_id(L3))

check("усі 3 лекції ділять РІВНО 1 спільну модель у пакеті", len(models), 1)
expected_model_name = "AnkiBot - Неон [3 полів]"
check("модель має інформативну назву", list(models.values())[0], expected_model_name)

print("\n2. Різні схеми полів отримують різні канонічні моделі")
L4 = str(uuid_mod.uuid4())
C4 = str(uuid_mod.uuid4())

req_mixed = DeckExportRequest(
    title="Змішаний курс",
    field_names=["Питання", "Відповідь"],
    deck_id=U,
    ancestors=[],
    cards=[],
    subtree=[
        {
            "deck_id": L1,
            "title": "Лекція 1",
            "field_names": ["Питання", "Відповідь"],
            "css": "",
            "templates": [],
            "style_name": "Стандарт",
            "cards": [{"id": C1, "values": {"Питання": "Q1", "Відповідь": "A1"}}],
            "ancestors": [{"id": U, "title": "Змішаний курс"}],
        },
        {
            "deck_id": L4,
            "title": "Лекція 4 (розширена)",
            "field_names": ["Питання", "Відповідь", "Пояснення", "Приклад"],
            "css": "",
            "templates": [],
            "style_name": "Стандарт",
            "cards": [{"id": C4, "values": {"Питання": "Q4", "Відповідь": "A4", "Пояснення": "E4", "Приклад": "Ex4"}}],
            "ancestors": [{"id": U, "title": "Змішаний курс"}],
        },
    ],
)

root_mixed = build_anki_deck(
    title=req_mixed.title,
    field_names=req_mixed.field_names,
    cards=[],
    deck_uuid=req_mixed.normalized_deck_uuid(),
    ancestors=req_mixed.normalized_ancestors(),
)
pkg_mixed = build_subtree_package(root_mixed, req_mixed.normalized_ancestors(), req_mixed.subtree)
_, _, models_mixed = read_apkg(pkg_mixed)

check("дві різні схеми полів створюють рівно 2 різні моделі", len(models_mixed), 2)
check_that("є модель на 2 поля", any("[2 полів]" in name for name in models_mixed.values()))
check_that("є модель на 4 поля", any("[4 полів]" in name for name in models_mixed.values()))

print("\n3. Стабільність ID між повторними експортами")
mid_first = canonical_model_id(["Питання", "Відповідь"], style_name="Неон")
mid_second = canonical_model_id(["Питання", "Відповідь"], style_name="Неон")
check("той самий model_id при повторному експорті", mid_first, mid_second)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
