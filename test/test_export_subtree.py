"""
Тест експорту гілки, а не лише однієї колоди.

Симптом, заради якого все це: є «університет::математика::лекція 1».
Експорт «лекція 1» працював — вона листок, їй діти не потрібні. А
експорт «університет» давав порожній .apkg: Anki бачив дерево
«університет > математика > лекція 1», але жодної картки в жодній з
цих колод. Користувач такого файлу не очікував.

Тому в запит додалося поле subtree: клієнт надсилає нащадків разом
із власними полями, шаблонами й ланцюгом батьків, а сервер збирає
з цього один пакет.

Дві речі, які тут легко зламати:

  * спільний батько не можна додавати двічі. col.decks в .apkg —
    словник, і другий ключ просто перезаписує перший. Якщо порожній
    «університет»-заглушка потрапить у пакет після справжнього вузла
    з картками, Anki побачить порожній «університет» — той самий баг
    зверху, уже в серверній реалізації.

  * модель прив'язана до колоди. models у .apkg теж словник, і в
    model_id записаний did тієї колоди, яка останньою використала цю
    модель. Спільний model_id змусив би картки лягти не туди.
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
from anki_ids import deck_anki_id, model_anki_id
from main import (DeckExportRequest, anki_deck_path, build_anki_deck,
                  build_subtree_package)

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


U = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
M = "550e8400-e29b-41d4-a716-446655440000"
L = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
L2 = "7c9e3f2a-1b2c-4d5e-8f90-1234567890ab"
C1 = "11111111-1111-4111-8111-111111111111"
C2 = "22222222-2222-4222-8222-222222222222"
C3 = "33333333-3333-4333-8333-333333333333"
C4 = "44444444-4444-4444-8444-444444444444"


def read_col(path):
    """{deck_id: назва}, {guid: deck_id}, {deck_id: [model_id]} з готового .apkg."""
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())
    con = sqlite3.connect(tmp)
    try:
        decks_json, models_json = con.execute("select decks, models from col").fetchone()
        cards = list(con.execute(
            "select notes.guid, cards.did from notes join cards on cards.nid = notes.id"))
    finally:
        con.close()
    names = {int(k): v["name"] for k, v in json.loads(decks_json).items()}
    # models: model_id -> did. Для тестів навпаки — хто належить колоді.
    models: dict[int, list[int]] = {}
    for model_id, model in json.loads(models_json).items():
        models.setdefault(int(model["did"]), []).append(int(model_id))
    return names, {g: d for g, d in cards}, models


def write(package, label="deck"):
    path = os.path.join(tempfile.mkdtemp(), f"{label}.apkg")
    package.write_to_file(path)
    return path


def node(deck_uuid, title, cards, ancestors):
    """Нащадок у вигляді, який надсилає клієнт (JSON -> Pydantic)."""
    return {
        "deck_id": deck_uuid,
        "title": title,
        "field_names": ["Питання", "Відповідь"],
        "css": "",
        "templates": [],
        "cards": [{"id": cid, "values": {"Питання": q, "Відповідь": "a"}}
                  for cid, q in cards],
        "ancestors": [{"id": uid, "title": anc_title} for uid, anc_title in ancestors],
    }


# Корінь «університет» порожній, у ньому «математика», у тій — дві лекції.
print("Експорт батька тягне всю гілку")
req = DeckExportRequest(
    title="університет",
    field_names=["Питання", "Відповідь"],
    deck_id=U,
    ancestors=[],
    cards=[],
    subtree=[
        node(M, "математика", [(C1, "200")], [(U, "університет")]),
        node(L, "лекція 1", [(C2, "перша")], [(U, "університет"), (M, "математика")]),
        node(L2, "лекція 2", [(C3, "друга")], [(U, "університет"), (M, "математика")]),
    ],
)
root = build_anki_deck(title=req.title, field_names=req.field_names, cards=[],
                       deck_uuid=req.normalized_deck_uuid(),
                       ancestors=req.normalized_ancestors())
names, cards_of, models = read_col(write(
    build_subtree_package(root, req.normalized_ancestors(), req.subtree)))

check("три колоди гілки + Default", sorted(names.values()),
      sorted(["Default", "університет", "університет::математика",
              "університет::математика::лекція 1", "університет::математика::лекція 2"]))
check("корінь порожній, але існує", names.get(deck_anki_id(U)), "університет")
# У Anki майже кожен запис col.decks зберігає ПОВНЕ ім'я з «::», а не
# останній сегмент: «математика» живе як «університет::математика»,
# а окремий «університет» — це корінь дерева.
check("середня колода має повне ім'я", names.get(deck_anki_id(M)),
      "університет::математика")
check("лекція 1 на повному шляху", names.get(deck_anki_id(L)),
      "університет::математика::лекція 1")
check("усього записів 5 (з Default)", len(names), 5)
check("усі три картки в пакеті", len(cards_of), 3)
check("картки в своїх колодах, а не у кореня",
      sorted((g, d) for g, d in cards_of.items()),
      sorted([(C1, deck_anki_id(M)), (C2, deck_anki_id(L)), (C3, deck_anki_id(L2))]))

print("\nСпільний батьок не перезаписується порожнім")
# «математика» є і нащадком, і батьком двох лекцій. Якби заглушка
# додалася після реального вузла, col.decks переписало б його на
# порожній — картки лишилися б у базі, але назвали б не ту колоду.
check("у математики рівно один запис у col.decks",
      [k for k, v in names.items() if v == "університет::математика"],
      [deck_anki_id(M)])
check("її картка на місці", cards_of.get(C1), deck_anki_id(M))
check("модель математики вказує на неї, а не на іншу",
      models.get(deck_anki_id(M)), [model_anki_id(M)])

print("\nМоделі різних колод не зливаються")
check("модель лекції 1 -> лекція 1", models.get(deck_anki_id(L)), [model_anki_id(L)])
check("модель лекції 2 -> лекція 2", models.get(deck_anki_id(L2)), [model_anki_id(L2)])
check("модель математики -> математика", models.get(deck_anki_id(M)), [model_anki_id(M)])
check("у трьох колод різні моделі",
      len({m for did in (deck_anki_id(M), deck_anki_id(L), deck_anki_id(L2))
           for m in models.get(did, [])}), 3)

print("\nКорінь без полів не ламає експорт")
# У кореня немає власних полів — build_anki_deck кидає ValueError, і
# ендпоїнт має зрозуміти, що це нормально, а не помилка запиту.
empty_root = DeckExportRequest(
    title="університет", field_names=[], deck_id=U, ancestors=[], cards=[],
    subtree=[node(L, "лекція 1", [(C4, "сама")], [(U, "університет")])],
)
try:
    build_anki_deck(title=empty_root.title, field_names=empty_root.field_names,
                    cards=[], deck_uuid=empty_root.normalized_deck_uuid(),
                    ancestors=empty_root.normalized_ancestors())
    raised = False
except ValueError:
    raised = True
check_that("build_anki_deck справді відмовляє на порожніх полях", raised)
# А ендпоїнт підставляє тимчасовий набір полів — перевіряємо результат.
fallback_root = build_anki_deck(title="університет", field_names=["Front", "Back"],
                                cards=[], deck_uuid=U, ancestors=[])
names2, cards2, _ = read_col(write(build_subtree_package(
    fallback_root, [], empty_root.subtree)))
check("нащадок на місці", names2.get(deck_anki_id(L)), "університет::лекція 1")
check("його картка теж", cards2.get(C4), deck_anki_id(L))

print("\nЕкспорт листка не змінився")
leaf = DeckExportRequest(
    title="лекція 1", field_names=["Питання", "Відповідь"], deck_id=L,
    ancestors=[{"id": U, "title": "університет"}, {"id": M, "title": "математика"}],
    cards=[{"id": C2, "values": {"Питання": "перша", "Відповідь": "a"}}],
)
leaf_deck = build_anki_deck(title=leaf.title, field_names=leaf.field_names,
                            cards=[{"id": c.id, "values": c.values} for c in leaf.cards],
                            deck_uuid=leaf.normalized_deck_uuid(),
                            ancestors=leaf.normalized_ancestors())
leaf_package = genanki.Package([
    genanki.Deck(deck_anki_id(u), t) for u, t in leaf.normalized_ancestors()
] + [leaf_deck])
names3, cards3, _ = read_col(write(leaf_package))
check("листок на повному шляху", names3.get(deck_anki_id(L)),
      "університет::математика::лекція 1")
check("картка в листку", cards3.get(C2), deck_anki_id(L))
check("батьки теж у пакеті",
      sorted(n for n in names3.values() if n in ("університет", "математика")),
      ["математика", "університет"])

print("\nСтарі клієнти без subtree працюють як раніше")
check("поле за замовчуванням порожнє", DeckExportRequest(title="x").subtree, [])
check("endpoint-сумісність: без subtree немає нащадків",
      [n for n in DeckExportRequest(title="x", cards=[{"id": C1, "values": {"Питання": "a", "Відповідь": "b"}}]).subtree], [])

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
