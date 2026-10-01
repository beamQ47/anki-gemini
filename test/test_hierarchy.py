"""
Тест вкладеності колод у .apkg.

Anki не має окремої таблиці підколод: вкладеність — це просто «::» у
назві. Тому перевіряємо саме те, що бачить Anki при імпорті, читаючи
col.decks із готового файлу, а не внутрішні змінні genanki.

Дві речі, які тут легко зламати:
  * id батьківської колоди має бути стабільним. Anki створює відсутнього
    батька сам, але з новим id — щоразу після імпорту з'являвся б новий
    «університет», а лекція втрачала б місце в дереві.
  * однакова назва листка в різних гілках не повинна злипатися: id
    рахуються від повного шляху, а не від останнього сегмента.
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
from main import anki_deck_path, build_ancestor_decks, build_anki_deck

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


def export(ancestors, deck_uuid, title="Лекція 1", cards=None):
    """Експорт через справжній код сервера, повертає шлях до .apkg."""
    deck = build_anki_deck(
        title=title,
        field_names=["Питання", "Відповідь"],
        cards=cards if cards is not None else [
            {"id": "c1", "values": {"Питання": "Що таке 200?", "Відповідь": "OK"}},
        ],
        deck_uuid=deck_uuid,
        ancestors=ancestors,
    )
    path = os.path.join(tempfile.mkdtemp(), "deck.apkg")
    genanki.Package([*build_ancestor_decks(ancestors), deck]).write_to_file(path)
    return path


def read_deck_names(path):
    """{deck_id: назва} з col.decks готового .apkg — те, що бачить Anki."""
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = os.path.join(tempfile.mkdtemp(), "col.anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())
    con = sqlite3.connect(tmp)
    try:
        decks_json, = con.execute("select decks from col").fetchone()
        note_rows = list(con.execute("select flds from notes"))
    finally:
        con.close()
    decks = {int(d["id"]): d["name"] for d in json.loads(decks_json).values()}
    return decks, note_rows


# університет -> математика -> лекція 1
U = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
M = "550e8400-e29b-41d4-a716-446655440000"
P = "dc768abe-e8d4-4736-b210-0628c765a9d1"
L = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
L2 = "7c9e3f2a-1b2c-4d5e-8f90-1234567890ab"
L3 = "8d0f4a3b-2c3d-4e6f-9a01-234567890abc"
FIELDS = ["Питання", "Відповідь"]

print("anki_deck_path")
check("три рівні", anki_deck_path("Лекція 1", [(U, "університет"), (M, "математика")]),
      "університет::математика::Лекція 1")
check("без батьків", anki_deck_path("Лекція 1", []), "Лекція 1")
check("один рівень", anki_deck_path("Лекція 1", [(U, "університет")]), "університет::Лекція 1")

print("\nbuild_ancestor_decks")
parents = build_ancestor_decks([(U, "університет"), (M, "математика")])
check("кількість", len(parents), 2)
check("назви", [d.name for d in parents], ["університет", "математика"])
check("id стабільний і з бази", parents[0].deck_id, deck_anki_id(U))
check("без карток", [len(d.notes) for d in parents], [0, 0])
check("порожній список", build_ancestor_decks([]), [])

print("\nВкладена колода в .apkg")
path = export([(U, "університет"), (M, "математика")], L)
names, note_rows = read_deck_names(path)
check("у файлі три наші рівні + Default", sorted(names.values()),
      sorted(["Default", "університет", "математика", "університет::математика::Лекція 1"]))
check("листок має повний шлях у назві", deck_anki_id(L) in names and names[deck_anki_id(L)],
      "університет::математика::Лекція 1")
check("батьки мають прості назви", names[deck_anki_id(U)], "університет")
check("картки на місці", len(note_rows), 1)

print("\nСтабільність батьків між експортами")
again, _ = read_deck_names(export([(U, "університет"), (M, "математика")], L))
check("назви ті самі", again, names)
moved, _ = read_deck_names(export([(U, "університет"), (M, "Математика")], L))
check("перейменування батька не змінює id", sorted(moved), sorted(names))
check("перейменування батька не змінює шлях листка",
      moved[deck_anki_id(L)], "університет::Математика::Лекція 1")

print("\nОднакова назва листка в різних гіілках не злипається")
phys = read_deck_names(export([(U, "університет"), (P, "фізика")], L3))[0]
check("листок фізики має інший id", deck_anki_id(L3) in phys, True)
check("листок математики тут відсутній", deck_anki_id(L) in phys, False)
check("шлях фізики", phys[deck_anki_id(L3)], "університет::фізика::Лекція 1")
check("спільний корінь з тим самим id", phys[deck_anki_id(U)], "університет")
check("гілка математики не потрапила в пакет фізики", "математика" in phys.values(), False)

print("\nБез deck_id — шлях усе одно розрізняє гілки")
legacy = read_deck_names(export([(U, "університет"), (M, "математика")], None, title="Лекція 1"))[0]
legacy2 = read_deck_names(export([(U, "університет"), (P, "фізика")], None, title="Лекція 1"))[0]
leaf_legacy = [n for n in legacy.values() if n.endswith("::Лекція 1")]
leaf_legacy2 = [n for n in legacy2.values() if n.endswith("::Лекція 1")]
check("назви різні", (leaf_legacy, leaf_legacy2),
      (["університет::математика::Лекція 1"], ["університет::фізика::Лекція 1"]))
check("id різні", [k for k, v in legacy.items() if v == leaf_legacy[0]]
      == [k for k, v in legacy2.items() if v == leaf_legacy2[0]], False)

print("\nКолода без батьків не ламається")
flat, flat_notes = read_deck_names(export([], L2))
check("одна колода без роздільника в назві", sorted(flat.values()), ["Default", "Лекція 1"])
check("картки на місці", len(flat_notes), 1)

print("\nБагато карток і довгий шлях")
deep = read_deck_names(export(
    [(U, "a"), (M, "b"), (P, "c"), (L, "d"), (L2, "e")], L3,
    title="f",
    cards=[{"id": f"c{i}", "values": {"Питання": str(i), "Відповідь": str(i)}}
           for i in range(5)],
))[0]
check("шість рівнів", len([n for n in deep.values() if n != "Default"]), 6)
check("повний шлях", deep[deck_anki_id(L3)], "a::b::c::d::e::f")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
