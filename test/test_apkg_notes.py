"""
Тест того, що Anki побачить з картками, а не лише з назвами колод.

test_hierarchy.py дивиться на col.decks — там усе добре: назви з «::» і
стабільні id. Але назва — це половина. Картка лежить у тій колоді, куди
поклав її notes.did, і саме за guid Anki вирішує, оновити картку чи
створити нову.

Дві речі, які тут легко зламати:

  * notes.did має дорівнювати id ЛИСТКОВОЇ колоди. Якщо прописати id
    кореня (або забути поле), Anki створить усі вкладені колоди, покаже
    правильне дерево, але картки лежатимуть у Default — користувач ніколи
    не помітить різниці, поки не спробує їх видалити разом із колодою.

  * guid має бути uuid картки, а не хеш полів (так робить сам genanki).
    Інакше дві однакові за змістом картки з різних колод мали б однаковий
    guid: при повторному імпорті Anki вважав би їх однією нотою, і одна
    зникла б разом із своєю колодою.
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
from anki_ids import deck_anki_id
from main import build_ancestor_decks, build_anki_deck

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


def export(ancestors, deck_uuid, title="Лекція 1", cards=None, model_css=None):
    """Експорт справжнім кодом сервера -> (notes, names)."""
    deck = build_anki_deck(
        title=title,
        field_names=["Питання", "Відповідь"],
        cards=cards if cards is not None else [
            {"id": "11111111-1111-4111-8111-111111111111",
             "values": {"Питання": "Що таке 200?", "Відповідь": "OK"}},
        ],
        deck_uuid=deck_uuid,
        ancestors=ancestors,
        css=model_css,
    )
    path = os.path.join(tempfile.mkdtemp(), "deck.apkg")
    genanki.Package([*build_ancestor_decks(ancestors), deck]).write_to_file(path)
    return read_notes(path)


def read_notes(path):
    """{guid: {"dids": ..., "fields": [...]}} та {deck_id: назва} з .apkg.

    did лежить не в notes, а в cards (Anki 2.1.50+ тримає колоду на
    картці, нота може мати кілька). Тому йдемо notes -> cards.nid: так
    видно й випадок із кількома шаблонами, де в одній колоді мають бути
    ВСІ картки ноти.
    """
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())
    con = sqlite3.connect(tmp)
    try:
        decks_json, = con.execute("select decks from col").fetchone()
        rows = list(con.execute(
            "select notes.guid, notes.flds, cards.did, cards.ord "
            "from notes left join cards on cards.nid = notes.id "
            "order by notes.guid, cards.ord"))
    finally:
        con.close()
    names = {int(d["id"]): d["name"] for d in json.loads(decks_json).values()}
    notes = {}
    for guid, flds, did, _ord in rows:
        entry = notes.setdefault(guid, {"dids": set(), "fields": flds.split("\x1f")})
        if did is not None:
            entry["dids"].add(did)
    return notes, names


U = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
M = "550e8400-e29b-41d4-a716-446655440000"
P = "dc768abe-e8d4-4736-b210-0628c765a9d1"
L = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
L3 = "8d0f4a3b-2c3d-4e6f-9a01-234567890abc"
CARD1 = "11111111-1111-4111-8111-111111111111"
CARD2 = "22222222-2222-4222-8222-222222222222"
ANCESTORS = [(U, "університет"), (M, "математика")]

print("Картка лежить у вкладеній колоді, а не в Default")
notes, names = export(ANCESTORS, L)
check("одна картка", len(notes), 1)
entry = notes[CARD1]
check("did = id листкової колоди", entry["dids"], {deck_anki_id(L)})
check("назва колоди з did", names.get(next(iter(entry["dids"]))), "університет::математика::Лекція 1")
check("поля на місці", entry["fields"], ["Що таке 200?", "OK"])
check_that("did не дорівнює id кореня", deck_anki_id(U) not in entry["dids"], f"{entry['dids']}")
check_that("did не дорівнює id батька", deck_anki_id(M) not in entry["dids"], f"{entry['dids']}")
check_that("did не дорівнює id Default", 1 not in entry["dids"] or names.get(1) != "Default",
           f"{entry['dids']}")

print("\nБагато карток — усі в тій самій вкладеній колоді")
notes, names = export(ANCESTORS, L, cards=[
    {"id": CARD1, "values": {"Питання": "A", "Відповідь": "1"}},
    {"id": CARD2, "values": {"Питання": "B", "Відповідь": "2"}},
])
check("дві картки", len(notes), 2)
check("обидві в листковій", sorted(d for e in notes.values() for d in e["dids"]),
      [deck_anki_id(L), deck_anki_id(L)])
check("у батьків карток немає",
      sorted({d for e in notes.values() for d in e["dids"]}
             & {deck_anki_id(U), deck_anki_id(M)}),
      [])

print("\nКілька шаблонів — усі картки ноти в тій самій колоді")
notes, names = export(ANCESTORS, L, cards=[
    {"id": CARD1, "values": {"Питання": "A", "Відповідь": "1"}},
], model_css=".card {}\n")
check("усі картки однієї ноти в листковій", notes[CARD1]["dids"], {deck_anki_id(L)})

print("\nОднакові за змістом картки в різних гілках не зливаються")
# Різні колоди, але поля ідентичні. Хеш полів дав би однаковий guid, і
# при повторному імпорті Anki зжав би дві картки в одну.
math, math_names = export(ANCESTORS, L, title="Лекція 1", cards=[
    {"id": CARD1, "values": {"Питання": "Те саме", "Відповідь": "Те саме"}}])
phys, phys_names = export([(U, "університет"), (P, "фізика")], L3, title="Лекція 1", cards=[
    {"id": CARD2, "values": {"Питання": "Те саме", "Відповідь": "Те саме"}}])
check("guid математики = uuid картки", list(math), [CARD1])
check("guid фізики = uuid картки", list(phys), [CARD2])
check("поля справді однакові", math[CARD1]["fields"], phys[CARD2]["fields"])
check("шляхи різні",
      [n for n in math_names.values() if n.endswith("::Лекція 1")],
      ["університет::математика::Лекція 1"])
check("шляхи різні у фізики",
      [n for n in phys_names.values() if n.endswith("::Лекція 1")],
      ["університет::фізика::Лекція 1"])

print("\nGUID стабільний між експортами — Anki оновить, а не дублює")
first, _ = export(ANCESTORS, L)
second, _ = export(ANCESTORS, L)
check("набір guid той самий", sorted(second), sorted(first))

print("\nПерейменування колоди не ламає зв'язку картки")
renamed, renamed_names = export([(U, "університет"), (M, "Математика")], L)
check("guid не змінився", sorted(renamed), sorted(first))
check("did не змінився", renamed[CARD1]["dids"], first[CARD1]["dids"])

print("\nСимуляція повторного імпорту (як це робить Anki)")
# Anki шукає ноту за guid: знайшла — оновить на місці, не знайшла —
# створює. Ключова річ — не плодити нову ноту для тієї самої картки.
def reimport(existing, incoming):
    merged = {g: {"dids": set(v["dids"]), "fields": list(v["fields"])}
              for g, v in existing.items()}
    for guid, entry in incoming.items():
        merged.setdefault(guid, {"dids": set(), "fields": entry["fields"]})
        merged[guid]["dids"] |= entry["dids"]
        merged[guid]["fields"] = entry["fields"]
    return merged

updated, _ = export(ANCESTORS, L, cards=[
    {"id": CARD1, "values": {"Питання": "Що таке 200?", "Відповідь": "Виправлено"}},
    {"id": CARD2, "values": {"Питання": "Нова картка", "Відповідь": "так"}},
])
after = reimport(first, updated)
check("була одна картка", len(first), 1)
check("після імпорту дві, а не три", len(after), 2)
check("старе оновлено, а не продубльовано", after[CARD1]["fields"],
      ["Що таке 200?", "Виправлено"])
check("нова додалася", after[CARD2]["fields"], ["Нова картка", "так"])
check("колода не з'їхала", after[CARD1]["dids"], {deck_anki_id(L)})

print("\nКартка без uuid (старі дані) не валить експорт")
legacy, legacy_names = export(ANCESTORS, L, cards=[
    {"Питання": "Стара картка", "Відповідь": "так"}])
check("одна картка", len(legacy), 1)
legacy_guid = next(iter(legacy))
# У legacy-випадку guid не uuid, а base91 (там є знаки на кшталт ')'
# і '`'). Важливо, що він непорожній, без переносів і NUL — інакше Anki
# відмовиться імпортувати пакет.
check_that("guid придатний для колонки Anki",
           bool(legacy_guid) and not any(c in legacy_guid for c in "\r\n\0"),
           f"guid={legacy_guid!r}")
check("поля на місці", legacy[legacy_guid]["fields"], ["Стара картка", "так"])
check("did все одно правильний", legacy[legacy_guid]["dids"], {deck_anki_id(L)})
legacy2, _ = export(ANCESTORS, L, cards=[
    {"Питання": "Стара картка", "Відповідь": "так"}])
check("той самий guid при тому самому порядку", sorted(legacy2), sorted(legacy))

def read_model_css(path):
    """CSS усіх нототипів з .apkg.

    Правила для формул мають реально долетіти до моделі, а не лишитися
    константою в main.py — перевіряємо те, що побачить Anki.
    """
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())
    con = sqlite3.connect(tmp)
    try:
        models_json, = con.execute("select models from col").fetchone()
    finally:
        con.close()
    return [model["css"] for model in json.loads(models_json).values()]


def model_css_of(ancestors, deck_uuid):
    deck = build_anki_deck(
        title="Формули",
        field_names=["Питання", "Відповідь"],
        cards=[{"id": CARD1, "values": {"Питання": "x", "Відповідь": "y"}}],
        deck_uuid=deck_uuid,
        ancestors=ancestors,
    )
    path = os.path.join(tempfile.mkdtemp(), "deck.apkg")
    genanki.Package([*build_ancestor_decks(ancestors), deck]).write_to_file(path)
    return read_model_css(path)


print("\nФормули з LaTeX доходять до Anki незмінними")
# Роздільники \( ... \) та \[ ... \] розпізнає вже сам Anki — у ньому є
# MathJax. Тому значення поля не можна екранувати, вирізати чи «підчищати»:
# один зайвий або зниклий слеш — і користувач у Anki побачить зламаний текст
# замість формули.
FORMULA_Q = "Розв'яжіть \\(x^2 + y^2 = z^2\\)"
FORMULA_A = "\\[z = \\sqrt{x^2 + y^2}\\]"
notes, _ = export(ANCESTORS, L, cards=[
    {"id": CARD1, "values": {"Питання": FORMULA_Q, "Відповідь": FORMULA_A}},
])
check("формули на місці, слеші не зрізані", notes[CARD1]["fields"], [FORMULA_Q, FORMULA_A])
check_that("роздільники \\( та \\[ лишилися в полі",
           "\\(" in notes[CARD1]["fields"][0] and "\\[" in notes[CARD1]["fields"][1],
           f"{notes[CARD1]['fields']}")
check_that("команда LaTeX не екранується подвійно",
           "\\sqrt" in notes[CARD1]["fields"][1] and "\\\\" not in notes[CARD1]["fields"][1],
           f"{notes[CARD1]['fields'][1]!r}")

print("\nШирока формула прокручується, а не ламає картку")
css_list = model_css_of(ANCESTORS, L)
check_that("у моделі є правило для MathJax",
           bool(css_list) and all("mjx-container" in css for css in css_list),
           f"моделей: {len(css_list)}")
check_that("правило обмежує ширину контейнера",
           any("max-width" in css and "overflow-x" in css for css in css_list),
           f"моделей: {len(css_list)}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
