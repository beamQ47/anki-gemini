"""
Тести HTTP-ієрархії: parent_id у CRUD, перенесення, попередження про
каскад і вкладеність у відданому .apkg.

Те, що тут не видно з коду само собою, перевіряється окремо:
  * реальний .apkg розбирається і порівнюється з тим, що просив клієнт,
    бо Anki не має таблиці підколод — вкладеність живе в назві, і
    помилка тут неюхає себе ані сервером, ані тестом на статус-код;
  * каскадне видалення питається ДО видалення — інакше користувач
    натискає «видалити» і несподівано губить усю гілку.
"""
import asyncio
import base64
import hmac
import io
import json
import os
import sqlite3
import sys
import tempfile
import time
import uuid as uuid_mod
import zipfile
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


ALICE = str(uuid_mod.uuid4())
BOB = str(uuid_mod.uuid4())
U, M, L1, L2, F1 = (str(uuid_mod.uuid4()) for _ in range(5))
BOB_DECK = str(uuid_mod.uuid4())
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


def make_token(user_id: str) -> str:
    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    signing_input = f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg({'sub': user_id, 'role': 'authenticated', 'exp': int(time.time()) + 3600})}"
    sig = hmac.new(base64.urlsafe_b64decode(auth._anon_key().split(".")[2] + "==")[:32],
                   signing_input.encode(), sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


ALICE_TOK = make_token(ALICE)
BOB_TOK = make_token(BOB)
ALICE_H = {"Authorization": f"Bearer {ALICE_TOK}"}
BOB_H = {"Authorization": f"Bearer {BOB_TOK}"}


async def fake_fetch(token: str):
    if token == ALICE_TOK:
        return {"id": ALICE, "role": "authenticated"}
    if token == BOB_TOK:
        return {"id": BOB, "role": "authenticated"}
    return None


auth.fetch_user = fake_fetch


async def seed():
    p = await database.get_pool()
    for uid, email in ((ALICE, f"apih-a-{ALICE[:8]}@example.invalid"),
                       (BOB, f"apih-b-{BOB[:8]}@example.invalid")):
        await p.execute(INSERT_USER, uuid_mod.UUID(uid), email)
    await database.close_pool()


async def cleanup():
    p = await database.get_pool()
    try:
        await p.execute(
            "delete from decks where user_id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
        await p.execute(
            "delete from auth.users where id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
    finally:
        await database.close_pool()


def apkg_deck_names(blob: bytes) -> dict:
    """{deck_id: назва} з відданого .apkg — те, що Anki побачить при імпорті."""
    path = os.path.join(tempfile.mkdtemp(), "export.apkg")
    with open(path, "wb") as fh:
        fh.write(blob)
    with zipfile.ZipFile(path) as zf:
        inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
        with zf.open(inner) as fh:
            tmp = path.replace(".apkg", ".anki2")
            with open(tmp, "wb") as out:
                out.write(fh.read())
    con = sqlite3.connect(tmp)
    try:
        decks_json, = con.execute("select decks from col").fetchone()
    finally:
        con.close()
    return {int(d["id"]): d["name"] for d in json.loads(decks_json).values()}


def anki_id(deck_uuid: str) -> int:
    """Той самий розрахунок, що робить сервер для id у .apkg."""
    from anki_ids import deck_anki_id
    return deck_anki_id(deck_uuid)


asyncio.run(seed())
print("Тестові користувачі створено")

with TestClient(main.app) as client:

    print("\nНові ендпоїти вимагають токен, як і решта")
    for method, url in (("PATCH", f"/api/decks/{U}/parent"),
                        ("GET", f"/api/decks/{U}/descendants")):
        r = client.request(method, url, json={"parent_id": None})
        check(f"{method} без токена", r.status_code, 401)
        check(f"{method} зі сміттям", client.request(
            method, url, json={"parent_id": None},
            headers={"Authorization": "Bearer abc.def.ghi"}).status_code, 401)

    print("\nСтворення трирівневого дерева через API")
    r = client.post("/api/decks", headers=ALICE_H, json={
        "id": U, "title": "університет", "field_names": FIELDS, "css": ".card{}"})
    check("корінь 201", r.status_code, 201)
    check("у корені parentId null", r.json()["parentId"], None)

    for deck_id, title, parent in ((M, "математика", U), (L1, "лекція 1", M),
                                   (L2, "лекція 2", M), (F1, "фізика", U)):
        r = client.post("/api/decks", headers=ALICE_H, json={
            "id": deck_id, "title": title, "field_names": FIELDS, "parent_id": parent})
        check(f"{title} 201", r.status_code, 201)
        check(f"{title} parentId", r.json()["parentId"], parent)

    print("\nСписок віддає дерево, а не плоску купу")
    r = client.get("/api/decks", headers=ALICE_H)
    check("200", r.status_code, 200)
    by_id = {d["id"]: d for d in r.json()["decks"]}
    check("усі п'ять", sorted(by_id), sorted([U, M, L1, L2, F1]))
    check("кожен має ключ parentId", all("parentId" in d for d in by_id.values()), True)
    check("математика під університетом", by_id[M]["parentId"], U)
    check("лекція 1 під математикою", by_id[L1]["parentId"], M)
    check("фізика під університетом", by_id[F1]["parentId"], U)

    print("\nОновлення назви не втрачає батька")
    r = client.put(f"/api/decks/{L1}", headers=ALICE_H, json={
        "id": L1, "title": "лекція 1", "field_names": FIELDS, "css": ".card{}"})
    check("200", r.status_code, 200)
    check("батьк на місці", r.json()["parentId"], M)
    check("назву оновили", r.json()["title"], "лекція 1")

    print("\nПеренесення між гілками")
    r = client.patch(f"/api/decks/{M}/parent", headers=ALICE_H, json={"parent_id": F1})
    check("200", r.status_code, 200)
    check("математика під фізикою", r.json()["parentId"], F1)
    check("нащадок не змінив прямого батька",
          client.get(f"/api/decks/{L1}", headers=ALICE_H).json()["parentId"], M)

    r = client.patch(f"/api/decks/{M}/parent", headers=ALICE_H, json={"parent_id": None})
    check("перенесення в корінь", r.json()["parentId"], None)
    r = client.patch(f"/api/decks/{M}/parent", headers=ALICE_H, json={"parent_id": U})
    check("повернули під університет", r.json()["parentId"], U)

    print("\nЦикли не проходять")
    r = client.patch(f"/api/decks/{U}/parent", headers=ALICE_H, json={"parent_id": U})
    check("себе під себе -> 409", r.status_code, 409)
    r = client.patch(f"/api/decks/{U}/parent", headers=ALICE_H, json={"parent_id": L1})
    check("під власним онуком -> 409", r.status_code, 409)
    check("університет досі корінь",
          client.get(f"/api/decks/{U}", headers=ALICE_H).json()["parentId"], None)
    check("гілка не розвалилася",
          client.get(f"/api/decks/{L1}", headers=ALICE_H).json()["parentId"], M)
    check("кривий батьк -> 422",
          client.patch(f"/api/decks/{L2}/parent", headers=ALICE_H, json={"parent_id": "не-uuid"}).status_code, 422)
    check("неіснуючий батьк -> 404",
          client.patch(f"/api/decks/{L2}/parent", headers=ALICE_H, json={"parent_id": str(uuid_mod.uuid4())}).status_code, 404)

    print("\nОднакова назва серед сусідів відкидається")
    DUP = str(uuid_mod.uuid4())
    r = client.post("/api/decks", headers=ALICE_H, json={
        "id": DUP, "title": "лекція 1", "field_names": FIELDS, "parent_id": M})
    check("409", r.status_code, 409)
    check("у списку не з'явилась дублем",
          [d["title"] for d in client.get("/api/decks", headers=ALICE_H).json()["decks"]].count("лекція 1"), 1)
    check("назва не питання регістру", client.post("/api/decks", headers=ALICE_H, json={
        "id": str(uuid_mod.uuid4()), "title": "ЛЕКЦІЯ 1",
        "field_names": FIELDS, "parent_id": M}).status_code, 409)

    print("\nПеренесення на зайняту назву відкидається, дерево не ламається")
    TWIN = str(uuid_mod.uuid4())
    check("дубль у корінні створити можна", client.post("/api/decks", headers=ALICE_H, json={
        "id": TWIN, "title": "Математика", "field_names": FIELDS}).status_code, 201)
    r = client.patch(f"/api/decks/{TWIN}/parent", headers=ALICE_H, json={"parent_id": U})
    check("409 — назва вже зайнята під університетом", r.status_code, 409)
    check("колад-дубль лишилась у корені",
          client.get(f"/api/decks/{TWIN}", headers=ALICE_H).json()["parentId"], None)
    check("математика не постраждала",
          client.get(f"/api/decks/{M}", headers=ALICE_H).json()["parentId"], U)

    print("\nІЗОЛЯЦІЯ — Bob не може чіпати дерево Alice")
    r = client.post("/api/decks", headers=BOB_H, json={
        "id": BOB_DECK, "title": "Колода Боба", "field_names": FIELDS})
    check("201", r.status_code, 201)
    check("перенести колоду Alice -> 404",
          client.patch(f"/api/decks/{L2}/parent", headers=BOB_H, json={"parent_id": None}).status_code, 404)
    check("поставити чужу колоду під дерево Alice -> 404",
          client.patch(f"/api/decks/{L2}/parent", headers=ALICE_H, json={"parent_id": BOB_DECK}).status_code, 404)
    check("і L2 не випала з математики",
          client.get(f"/api/decks/{L2}", headers=ALICE_H).json()["parentId"], M)
    check("Bob не може поставити свою під чужу -> 404",
          client.patch(f"/api/decks/{BOB_DECK}/parent", headers=BOB_H, json={"parent_id": U}).status_code, 404)
    check("нащадки Alice не підмінилися",
          client.get(f"/api/decks/{L1}", headers=ALICE_H).json()["parentId"], M)

    print("\nПопередження про каскад перед видаленням")
    r = client.get(f"/api/decks/{U}/descendants", headers=ALICE_H)
    check("200", r.status_code, 200)
    check("у гілці 4 нащадки", r.json()["descendants"], 4)
    check("листок без нащадків",
          client.get(f"/api/decks/{L1}/descendants", headers=ALICE_H).json()["descendants"], 0)
    check("математика з двома лекціями",
          client.get(f"/api/decks/{M}/descendants", headers=ALICE_H).json()["descendants"], 2)
    check("чужа колода -> 404",
          client.get(f"/api/decks/{U}/descendants", headers=BOB_H).status_code, 404)
    check("неіснуюча -> 404",
          client.get(f"/api/decks/{uuid_mod.uuid4()}/descendants", headers=ALICE_H).status_code, 404)
    check("кривий id -> 422",
          client.get("/api/decks/не-uuid/descendants", headers=ALICE_H).status_code, 422)

    print("\nЕкспорт вкладеної колоди")
    r = client.post("/api/export-deck", headers=ALICE_H, json={
        "title": "лекція 1", "field_names": FIELDS, "deck_id": L1,
        "css": ".card{}", "cards": [{"id": str(uuid_mod.uuid4()),
                                     "values": {"Питання": "a", "Відповідь": "b"}}],
        "ancestors": [{"id": U, "title": "університет"}, {"id": M, "title": "математика"}],
    })
    check("200", r.status_code, 200)
    names = apkg_deck_names(r.content)
    check("листок прийшов у файл із повним шляхом",
          names[anki_id(L1)], "університет::математика::лекція 1")
    check("корінь у файлі", names[anki_id(U)], "університет")
    check("проміжний рівень у файлі", names[anki_id(M)], "математика")
    check("назви колод у файлі", sorted(names.values()),
          sorted(["Default", "університет", "математика", "університет::математика::лекція 1"]))

    print("\nФілітри й сміття в ancestors не ламають експорт")
    r = client.post("/api/export-deck", headers=ALICE_H, json={
        "title": "лекція 1", "field_names": FIELDS, "deck_id": L1,
        "ancestors": [{"id": "не-uuid", "title": "зламаний"},
                      {"title": "без id"},
                      {"id": M, "title": "математика"}],
        "cards": [{"id": str(uuid_mod.uuid4()), "values": {"Питання": "a", "Відповідь": "b"}}],
    })
    check("200", r.status_code, 200)
    names = apkg_deck_names(r.content)
    check("шлях без зруйнованих рівнів", names[anki_id(L1)], "математика::лекція 1")
    check("університет не проявився з нічого", "зламаний" in names.values(), False)

    print("\nСтара форма запиту без ancestors не зламалася")
    r = client.post("/api/export-deck", headers=ALICE_H, json={
        "title": "Пласка колода", "field_names": FIELDS,
        "cards": [{"Питання": "x", "Відповідь": "y"}]})
    check("200", r.status_code, 200)
    names = apkg_deck_names(r.content)
    check("назва без роздільника", "Пласка колода" in names.values(), True)

    print("\nКаскадне видалення на HTTP")
    r = client.delete(f"/api/decks/{U}", headers=ALICE_H)
    check("200/204", r.status_code, 200)
    left = {d["id"] for d in client.get("/api/decks", headers=ALICE_H).json()["decks"]}
    check("гілка зникла", left & {U, M, L1, L2, F1}, set())
    check("незалежні колоди лишились", left, {TWIN})
    check("чужа колода не зачепилась",
          [d["id"] for d in client.get("/api/decks", headers=BOB_H).json()["decks"]], [BOB_DECK])

try:
    asyncio.run(cleanup())
    print("\n[прибрано за собою]")
except Exception as error:  # noqa: BLE001
    print(f"\n!!! НЕ ВДАЛОСЯ прибрати тестові дані: {error}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
