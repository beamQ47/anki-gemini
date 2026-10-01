"""
Тести HTTP-шару: авторизація, CRUD, ізоляція між користувачами.

Токени підписані так само, як це робить Supabase, але auth.fetch_user
підмінено — інакше тести вимагали б пароля й ходили б у мережу на
кожен запит. Сам механізм перевірки токена перевірено в
test_auth.py, де є справжній мережевий виклик.

Пул БД прив'язаний до event loop, тому сів та прибирання робляться
окремими asyncio.run(), а TestClient піднімає свій власний пул.
"""
import asyncio
import base64
import hmac
import io
import json
import sys
import time
import uuid as uuid_mod
from hashlib import sha256

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from dotenv import load_dotenv
load_dotenv(r"E:\learning\projects\anki-telegram-bot\.env")

from fastapi.testclient import TestClient

import auth
import db as database
import main

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


ALICE = str(uuid_mod.uuid4())
BOB = str(uuid_mod.uuid4())
DECK = str(uuid_mod.uuid4())
OTHER_DECK = str(uuid_mod.uuid4())
FIELDS = ["Питання", "Відповідь"]

INSERT_USER = """
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ($1, coalesce((select instance_id from auth.users limit 1),
            '00000000-0000-0000-0000-000000000000'::uuid),
            'authenticated', 'authenticated', $2, null, now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{}'::jsonb, now(), now())
"""


def make_token(user_id: str, role: str = "authenticated", exp_delta: int = 3600) -> str:
    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    signing_input = f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg({'sub': user_id, 'role': role, 'exp': int(time.time()) + exp_delta})}"
    sig = hmac.new(base64.urlsafe_b64decode(auth._anon_key().split(".")[2] + "==")[:32],
                   signing_input.encode(), sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


ALICE_TOK = make_token(ALICE)
BOB_TOK = make_token(BOB)
ALICE_H = {"Authorization": f"Bearer {ALICE_TOK}"}
BOB_H = {"Authorization": f"Bearer {BOB_TOK}"}


async def fake_fetch(token: str):
    """Підмість Supabase: повертає uuid, який відповідає токену."""
    if token == ALICE_TOK:
        return {"id": ALICE, "role": "authenticated"}
    if token == BOB_TOK:
        return {"id": BOB, "role": "authenticated"}
    if token == "role-service":
        return {"id": ALICE, "role": "service_role"}
    if token == "not-uuid":
        return {"id": "не-uuid"}
    return None


auth.fetch_user = fake_fetch


async def seed():
    p = await database.get_pool()
    for uid, email in ((ALICE, f"apitest-a-{ALICE[:8]}@example.invalid"),
                       (BOB, f"apitest-b-{BOB[:8]}@example.invalid")):
        await p.execute(INSERT_USER, uuid_mod.UUID(uid), email)
    await database.close_pool()


async def cleanup():
    p = await database.get_pool()
    try:
        # Каскад на notes не покладаємось: якщо тест впав посеред
        # транзакції, картки могли лишитись без колоди.
        for uid in (DECK, OTHER_DECK):
            await p.execute("delete from notes n using decks d where n.deck_id = d.id and d.id = $1", uuid_mod.UUID(uid))
            await p.execute("delete from decks where id = $1", uuid_mod.UUID(uid))
        await p.execute(
            "delete from auth.users where id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
    finally:
        await database.close_pool()


asyncio.run(seed())
print("Тестові користувачі створено")

# Прибирання — окремим кроком, а не в finally. Раніше воно стояло
# у finally, але TestClient тримає власний event loop: якщо тест
# падав, пул лишався прив'язаним до закритого loop, cleanup падав
# із "Event loop is closed" — і тестові користувачі залишались у
# базі назавжди. Тепер cleanup стоїть ДО створення клієнта й
# падає гучно, якщо не вдався.
leftovers = None

# with — обов'язковий: без нього lifespan не запускається,
# пул БД не закривається і наступний asyncio.run() падає
# з "Event loop is closed".
with TestClient(main.app) as client:

        print("\nБез токена нічого не працює")
        for method, url in (("GET", "/api/decks"), ("POST", "/api/decks"),
                            ("GET", f"/api/decks/{DECK}"), ("PUT", f"/api/decks/{DECK}"),
                            ("DELETE", f"/api/decks/{DECK}"), ("PUT", f"/api/decks/{DECK}/cards"),
                            ("PUT", f"/api/notes/{uuid_mod.uuid4()}"),
                            ("DELETE", f"/api/notes/{uuid_mod.uuid4()}")):
            r = client.request(method, url, json={})
            check(f"{method} {url.split('?')[0][:38]}", r.status_code, 401)

        print("\nСміття у Authorization відхиляється")
        for bad in ({"Authorization": "Basic abc"}, {"Authorization": "abc"},
                    {"Authorization": "Bearer "}, {"Authorization": ""}):
            r = client.get("/api/decks", headers=bad)
            check(f"{bad.get('Authorization')!r}", r.status_code, 401)

        print("\nНедійсний токен")
        check("випадковий токен", client.get("/api/decks", headers={"Authorization": "Bearer abc.def.ghi"}).status_code, 401)
        check("роль service_role", client.get("/api/decks", headers={"Authorization": "Bearer role-service"}).status_code, 401)
        check("id не uuid", client.get("/api/decks", headers={"Authorization": "Bearer not-uuid"}).status_code, 401)
        r = client.get("/api/decks", headers={"Authorization": "Bearer abc"})
        check("є WWW-Authenticate", r.headers.get("www-authenticate"), "Bearer")

        print("\nСтворення колоди")
        r = client.post("/api/decks", headers=ALICE_H, json={
            "id": DECK, "title": "Колода Аліси", "field_names": FIELDS, "css": ".card{}",
        })
        check("201", r.status_code, 201)
        check("id", r.json()["id"], DECK)
        check("title", r.json()["title"], "Колода Аліси")
        check("fieldNames", r.json()["fieldNames"], FIELDS)
        check("cards порожній", r.json()["cards"], [])

        print("\nСписок і читання")
        r = client.get("/api/decks", headers=ALICE_H)
        check("200", r.status_code, 200)
        check("одна колода", [d["id"] for d in r.json()["decks"]], [DECK])
        r = client.get(f"/api/decks/{DECK}", headers=ALICE_H)
        check("GET deck 200", r.status_code, 200)
        check("title", r.json()["title"], "Колода Аліси")

        print("\nКартки: повна заміна")
        c1, c2 = str(uuid_mod.uuid4()), str(uuid_mod.uuid4())
        r = client.put(f"/api/decks/{DECK}/cards", headers=ALICE_H, json={"cards": [
            {"id": c1, "values": {"Питання": "a", "Відповідь": "b"}},
            {"id": c2, "values": {"Питання": "c", "Відповідь": "d"}},
        ]})
        check("200", r.status_code, 200)
        check("дві картки", len(r.json()["cards"]), 2)
        check("id збережено", {c["id"] for c in r.json()["cards"]}, {c1, c2})

        print("\nКартки без id відхиляються")
        r = client.put(f"/api/decks/{DECK}/cards", headers=ALICE_H, json={"cards": [
            {"values": {"Питання": "без id"}},
        ]})
        check("422", r.status_code, 422)
        check("картки на місці не постраждали", len(client.get(f"/api/decks/{DECK}", headers=ALICE_H).json()["cards"]), 2)

        print("\nРедагування однієї картки")
        r = client.put(f"/api/notes/{c1}", headers=ALICE_H, json={"cards": [
            {"id": c1, "values": {"Питання": "a-змінено", "Відповідь": "b-змінено"}}
        ]})
        check("200", r.status_code, 200)
        check("значення", r.json()["values"], {"Питання": "a-змінено", "Відповідь": "b-змінено"})
        check("id не змінився", r.json()["id"], c1)

        print("\nВидалення картки")
        check("204/200", client.delete(f"/api/notes/{c2}", headers=ALICE_H).status_code, 200)
        check("лишилась одна", len(client.get(f"/api/decks/{DECK}", headers=ALICE_H).json()["cards"]), 1)
        check("повторне видалення 404", client.delete(f"/api/notes/{c2}", headers=ALICE_H).status_code, 404)

        print("\nІЗОЛЯЦІЯ — Bob не має доступу до колоди Аліси")
        check("список порожній", client.get("/api/decks", headers=BOB_H).json()["decks"], [])
        check("GET -> 404", client.get(f"/api/decks/{DECK}", headers=BOB_H).status_code, 404)
        check("PUT -> 404", client.put(f"/api/decks/{DECK}", headers=BOB_H, json={
            "id": DECK, "title": "Взламано", "field_names": FIELDS}).status_code, 404)
        check("cards -> 404", client.put(f"/api/decks/{DECK}/cards", headers=BOB_H, json={
            "cards": [{"id": str(uuid_mod.uuid4()), "values": {}}]}).status_code, 404)
        check("DELETE -> 404", client.delete(f"/api/decks/{DECK}", headers=BOB_H).status_code, 404)
        # deck_id передається свідомо: PUT /api/notes/{id} тепер upsert, тож
        # Bob спробує створити нову картку прямо в колоді Аліси. Захист
        # мусить триматися на рівні add_note (join за user_id), а не на
        # відсутності deck_id — інакше тест перевіряв би не ізоляцію, а
        # валідність запиту.
        check("note (чужа колода) -> 404", client.put(f"/api/notes/{c1}", headers=BOB_H, json={
            "deck_id": DECK,
            "cards": [{"id": c1, "values": {"Питання": "злом"}}]}).status_code, 404)
        # Без deck_id сервер не знає, куди класти нову картку: 422, а не
        # 404 — «картку не знайдено» тут було б брехнею, бо вона справді
        # не існує, просто їй немає куди лягти.
        check("note (без deck_id) -> 422", client.put(
            f"/api/notes/{str(uuid_mod.uuid4())}", headers=BOB_H, json={
                "cards": [{"id": str(uuid_mod.uuid4()), "values": {"Питання": "x"}}]}
        ).status_code, 422)
        check("delete note -> 404", client.delete(f"/api/notes/{c1}", headers=BOB_H).status_code, 404)

        print("\nПеревірка, що злом не пройшов")
        check("назва ціла", client.get(f"/api/decks/{DECK}", headers=ALICE_H).json()["title"], "Колода Аліси")
        check("картки цілі", len(client.get(f"/api/decks/{DECK}", headers=ALICE_H).json()["cards"]), 1)
        check("значення цілі", client.get(f"/api/decks/{DECK}", headers=ALICE_H).json()["cards"][0]["values"],
              {"Питання": "a-змінено", "Відповідь": "b-змінено"})

        print("\nBob створює свою колоду — його дані не змішуються")
        r = client.post("/api/decks", headers=BOB_H, json={
            "id": OTHER_DECK, "title": "Колода Боба", "field_names": FIELDS})
        check("201", r.status_code, 201)
        check("у Аліси своя", [d["id"] for d in client.get("/api/decks", headers=ALICE_H).json()["decks"]], [DECK])
        check("у Боба своя", [d["id"] for d in client.get("/api/decks", headers=BOB_H).json()["decks"]], [OTHER_DECK])

        print("\nКриваві id")
        for bad in ("не-uuid", "123", "abc-def"):
            check(f"GET deck {bad!r}", client.get(f"/api/decks/{bad}", headers=ALICE_H).status_code, 422)
        check("cards у неіснуючу колоду", client.put(f"/api/decks/{uuid_mod.uuid4()}/cards", headers=ALICE_H,
              json={"cards": []}).status_code, 404)

        print("\nЕкспорт .apkg з новою моделлю payload")
        r = client.post("/api/export-deck", headers=ALICE_H, json={
            "title": "HTTP — урок", "field_names": ["Код", "Що"], "deck_id": DECK,
            "cards": [{"id": c1, "values": {"Код": "200", "Що": "OK"}}],
        })
        check("200", r.status_code, 200)
        check("apkg", r.headers.get("content-type"), "application/octet-stream")
        check("не порожній", len(r.content) > 1000, True)

        print("\nЕкспорт зі старою пласкою формою не зламався")
        r = client.post("/api/export-deck", headers=ALICE_H, json={
            "title": "Стара форма", "field_names": ["Питання", "Відповідь"],
            "cards": [{"Питання": "x", "Відповідь": "y"}],
        })
        check("200", r.status_code, 200)

        print("\nЕкспорт без токена — 401, як і решта api/*")
        check("401", client.post("/api/export-deck", json={
            "title": "анонім", "field_names": ["A", "B"],
            "cards": [{"id": c1, "values": {"A": "x", "B": "y"}}]}).status_code, 401)

        print("\nЕкспорт без карток")
        check("400", client.post("/api/export-deck", headers=ALICE_H,
                                 json={"title": " порожня", "field_names": ["A", "B"], "cards": []}).status_code, 400)

# Прибирання після закриття клієнта: lifespan уже звільнив пул.
try:
    asyncio.run(cleanup())
    print("\n[прибрано за собою]")
except Exception as error:  # noqa: BLE001
    print(f"\n!!! НЕ ВДАЛОСЯ прибрати тестові дані: {error}")
    print("    Користувачі apitest-* і колоди лишились у базі. Прибери вручну.")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
