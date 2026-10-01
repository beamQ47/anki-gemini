import sys, io, json, os, sqlite3, tempfile, zipfile
# Gemini тут підміняється canned-відповіддю: тест має бути детермінованим.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")
import main
from anki_ids import deck_anki_id
from fastapi.testclient import TestClient


def read_apkg_decks(blob):
    """{deck_id: назва}, {guid: deck_id} з байтів, які віддав ендпоїнт."""
    path = os.path.join(tempfile.mkdtemp(), "out.apkg")
    with open(path, "wb") as fh:
        fh.write(blob)
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        inner_path = os.path.join(os.path.dirname(path), "col.anki2")
        with zf.open(inner) as src, open(inner_path, "wb") as dst:
            dst.write(src.read())
    con = sqlite3.connect(inner_path)
    try:
        decks_json = con.execute("select decks from col").fetchone()[0]
        cards = list(con.execute(
            "select notes.guid, cards.did from notes join cards on cards.nid = notes.id"))
    finally:
        con.close()
    return ({int(k): v["name"] for k, v in json.loads(decks_json).items()},
            {g: d for g, d in cards})

CANNED = {
    "deck_name": "HTTP — Лекція 1",
    "model": {
        "fields": ["Код", "Назва", "Приклад", "Джерело", "Нотатка"],
        "css": ".card{font-size:20px}",
        "templates": [{"name": "Картка", "qfmt": "{{Код}}", "afmt": "{{FrontSide}}<hr>{{Назва}}"}],
    },
    "cards": [
        {"Код": "200", "Назва": "OK", "Приклад": "HTTP 200", "Джерело": "RFC 9110", "Нотатка": "суть у двох реченнях"},
        {"Код": "404", "Назва": "Not Found"},
    ],
}

async def fake_ai(prompt_text, history_list, file_bytes, mime_type, **kwargs):
    return "```json\n" + json.dumps(CANNED, ensure_ascii=False) + "\n```"

main.ask_ai = fake_ai
# /api/chat і /api/export-deck тепер закриті токеном: без нього відкритий
# ендпоїнт витрачав би спільну безкоштовну квоту Gemini. Тест не про
# авторизацію (її перевіряють test_api_decks.py і test_auth.py), тому
# підміняємо саму залежність.
main.app.dependency_overrides[main.current_user_id] = lambda: "11111111-1111-4111-8111-111111111111"

ok = fail = 0
def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")

with TestClient(main.app) as c:
    r = c.post("/api/chat", data={"message": "зроби картки", "history": "[]"})
    check("статус", r.status_code, 200)
    data = r.json()
    check("ключі — відповідь", sorted(data.keys()), ["cards", "model", "reply"])
    m = data["model"]
    check("model.deck_name", m["deck_name"], CANNED["deck_name"])
    check("model.field_names", m["field_names"], CANNED["model"]["fields"])
    check("model.css", m["css"], CANNED["model"]["css"])
    check("model.templates", [t["name"] for t in m["templates"]], ["Картка"])
    check("карток", len(data["cards"]), 2)
    check("1-ша картка повна", data["cards"][0]["Код"], "200")
    check("2-га картка без розкриття", len(data["cards"][1]), 5)
    check("пропущене значення порожнє", data["cards"][1]["Приклад"], "")

    # Кирилиця має дійти без спотворень
    check("кирилиця в назвах полів", m["field_names"][0], "Код")
    check("кирилиця в значенні", data["cards"][0]["Нотатка"], CANNED["cards"][0]["Нотатка"])

    exp = c.post("/api/export-deck", json={
        "title": m["deck_name"], "field_names": m["field_names"],
        "css": m["css"], "templates": m["templates"], "cards": data["cards"],
    })
    check("export статус", exp.status_code, 200)
    check("export не порожній", len(exp.content) > 1000, True)
    pass

    # Старий payload має падати, а не тихо псути поле
    old = c.post("/api/export-deck", json={"title": "x", "cards": [{"front": "a", "back": "b"}]})
    check("старий payload відхилено", old.status_code, 400)

print("\nЕкспорт батька через ендпоїнт")
# Раніше ендпоїнт приймав лише cards і збирав один Deck. Запит батька з
# порожніми cards проходив, але .apkg виходив без жодної картки — саме цей
# баг. Тут перевіряю весь шлях: HTTP -> .apkg -> колоди й картки з файлу.
sub = c.post("/api/export-deck", json={
    "title": "університет",
    "deck_id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "field_names": ["Питання", "Відповідь"],
    "cards": [],
    "subtree": [
        {"deck_id": "22222222-2222-4222-8222-222222222222", "title": "математика",
         "ancestors": [{"id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "title": "університет"}],
         "field_names": ["Питання", "Відповідь"], "css": "", "templates": [],
         "cards": [{"id": "11111111-1111-4111-8111-111111111111",
                    "values": {"Питання": "200", "Відповідь": "a"}}]},
        {"deck_id": "33333333-3333-4333-8333-333333333333", "title": "лекція 1",
         "ancestors": [{"id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "title": "університет"},
                       {"id": "22222222-2222-4222-8222-222222222222", "title": "математика"}],
         "field_names": ["Питання", "Відповідь"], "css": "", "templates": [],
         "cards": [{"id": "44444444-4444-4444-8444-444444444444",
                    "values": {"Питання": "перша", "Відповідь": "a"}}]},
    ],
})
check("батьковий export прийнято", sub.status_code, 200)
sub_names, sub_cards = read_apkg_decks(sub.content)
check("корінь присутній", sub_names.get(deck_anki_id("3f2504e0-4f89-41d3-9a0c-0305e82c3301")),
      "університет")
check("нащадок на повному шляху", sub_names.get(deck_anki_id("33333333-3333-4333-8333-333333333333")),
      "університет::математика::лекція 1")
check("картки нащадків у файлі", sorted(sub_cards.items()),
      sorted([("11111111-1111-4111-8111-111111111111",
               deck_anki_id("22222222-2222-4222-8222-222222222222")),
              ("44444444-4444-4444-8444-444444444444",
               deck_anki_id("33333333-3333-4333-8333-333333333333"))]))

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
