"""
Відтворення двох багів користувача на живому сервері.

1. «Не вдалося завантажити .apkg» — фронтенд показує це на будь-який
   виняток, тож причину треба дивитися в тілі відповіді, а не в тексті
   toast.
2. Картки зникають після перезавантаження. Ключове питання: чи сервер
   приймає PUT /api/notes/{id} для нотатки, яка ще не існує. У лозі
   було 404 на саме такі запити.
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
os.chdir(r"E:\learning\projects\anki-telegram-bot")
sys.path.insert(0, os.getcwd())

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

U = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
L = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
C1 = "11111111-1111-4111-8111-111111111111"

ok = fail = 0


def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1
        print(f"  ok   {label}")
    else:
        fail += 1
        print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")


with TestClient(main.app) as c:
    # Ендпоїнти з реальною БД закриті токеном (див. main.py). Тут перевіряються
    # баги формату, а не авторизація, тож підміняємо залежність.
    main.app.dependency_overrides[main.current_user_id] = lambda: C1
    print("=" * 62)
    print("БАГ 1: експорт .apkg")
    print("=" * 62)
    r = c.post("/api/export-deck", json={
        "title": "університет", "deck_id": U,
        "field_names": ["Питання", "Відповідь"], "cards": [],
        "subtree": [{
            "deck_id": L, "title": "лекція 1",
            "ancestors": [{"id": U, "title": "університет"}],
            "field_names": ["Питання", "Відповідь"], "css": "", "templates": [],
            "cards": [{"id": C1, "values": {"Питання": "200", "Відповідь": "a"}}],
        }],
    })
    check("експорт батька повертає 200", r.status_code, 200)
    check("це справді .apkg (zip)", r.content[:2], b"PK")
    check("розмір пристойний", len(r.content) > 1000, True)
    print(f"       content-type: {r.headers.get('content-type')}")

    # Те, що реально робить браузер: перевірити, що сховище не згодне
    # на文件名 з кирилицею, і що blob не порожній.
    print()
    r2 = c.post("/api/export-deck", json={
        "title": "університет::математика::лекція 1", "deck_id": L,
        "field_names": ["Питання", "Відповідь"],
        "cards": [{"id": C1, "values": {"Питання": "200", "Відповідь": "a"}}],
    })
    check("експорт листка з «::» у назві", r2.status_code, 200)
    check("листок теж zip", r2.content[:2], b"PK")

    print()
    print("=" * 62)
    print("БАГ 2: PUT /api/notes на нову нотатку")
    print("=" * 62)
    r3 = c.put(f"/api/notes/{C1}", json={
        "deck_id": L, "values": {"Питання": "200", "Відповідь": "a"},
    })
    print(f"  PUT /api/notes/{{id}} -> {r3.status_code}")
    if r3.status_code == 404:
        print("  ВІДПОВІДЬ:", r3.text[:300])
        print()
        print("  -> ось і причина «картки зникають»: автозбереження падає")
        print("     404, і після перезавантаження нотатки немає на сервері.")
    elif r3.status_code in (200, 201):
        check("нотатку створено", r3.status_code in (200, 201), True)
    else:
        print("  ВІДПОВІДЬ:", r3.text[:300])

    # Чи є в базі маршрут, який усе ж створює нотатку?
    print()
    routes = [f"{sorted(rt.methods)} {rt.path}"
              for rt in main.app.routes if "notes" in rt.path]
    for item in sorted(routes):
        print("   ", item)

print()
print(f"{ok} passed, {fail} failed")
