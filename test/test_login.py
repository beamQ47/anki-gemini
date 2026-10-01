"""
Тест реального входу в Supabase і синхронізації колод.

На відміну від інших тестів, тут справжній мережевий виклик із
справжнім токеном: пароль підставляється з оточення. Без нього
тест пропускається, а не падає — щоб у репозиторії не було
справжнього пароля, але й щоб мовчання не видавалося за успіх.

Після вхому перевіряється весь шлях: bearer -> current_user_id ->
окрема колода в БД -> анонімний доступ до неї заборонено.
"""
import io
import os
import sys
import uuid as uuid_mod

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from dotenv import load_dotenv
load_dotenv(r"E:\learning\projects\anki-telegram-bot\.env")

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


import asyncio
import base64
import hmac
import json
import time
from hashlib import sha256

import httpx
from fastapi.testclient import TestClient

import auth
import db as database
import main

EMAIL = os.getenv("ANKI_TEST_EMAIL", "zadarko12@gmail.com")
PASSWORD = os.getenv("ANKI_TEST_PASSWORD", "")

if not PASSWORD:
    print("ПРОПУЩЕНО: не задано ANKI_TEST_PASSWORD.")
    print("  Запусти так, щоб працював справжній вхід, наприклад:")
    print('    $env:ANKI_TEST_PASSWORD="твій пароль"; venv\\Scripts\\python.exe test\\test_login.py')
    print("  Без цього тест нічого не перевіряє — він не мовчить про успіх.")
    sys.exit(0)


def make_token(user_id: str) -> str:
    """Підписує токен тим secret, яким Supabase підписує реальні.

    Потрібен, бо перевірка в auth.py йде в Supabase, а не локально.
    """
    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    signing_input = f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg({'sub': user_id, 'role': 'authenticated', 'exp': int(time.time()) + 3600})}"
    sig = hmac.new(base64.urlsafe_b64decode(auth._anon_key().split(".")[2] + "==")[:32],
                   signing_input.encode(), sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


print(f"Вхід у Supabase як {EMAIL}")

with httpx.Client(timeout=20) as http:
    response = http.post(
        f"{auth.supabase_url()}/auth/v1/token?grant_type=password",
        headers={"apikey": auth._anon_key(), "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PASSWORD},
    )
    if response.status_code != 200:
        body = response.json() if response.content else {}
        print(f"  FAIL вхід не вдався: {response.status_code} {body.get('error_description') or body}")
        print("\nПеревір, що пароль правильний і що акаунт підтверджено в Supabase.")
        sys.exit(1)

    data = response.json()

check("отримали access_token", bool(data.get("access_token")), True)
check("отримали refresh_token", bool(data.get("refresh_token")), True)
check("отримали id користувача", bool((data.get("user") or {}).get("id")), True)
check("email збігається", (data.get("user") or {}).get("email"), EMAIL)
check("термін дії ~1 година", 3000 < int(data.get("expires_in", 0)) < 4200, True)

access_token = data["access_token"]
user_id = data["user"]["id"]

print("\nСправжній токен проходить перевірку нашого auth.py")
payload = asyncio.run(auth.current_user_id(f"Bearer {access_token}"))
check("user_id з токена", payload, user_id)

print("\nКеш не ламає повторну перевірку")
check("другий виклик той самий uuid", asyncio.run(auth.current_user_id(f"Bearer {access_token}")), user_id)

print("\nСправжній токен у справжньому FastAPI")
DECK = str(uuid_mod.uuid4())
try:
    with TestClient(main.app) as client:
        h = {"Authorization": f"Bearer {access_token}"}

        r = client.get("/api/config")
        check("конфіг доступний без токена", r.status_code, 200)
        check("anon-ключ у конфізі", bool(r.json()["supabaseAnonKey"]), True)
        check("URL у конфізі", r.json()["supabaseUrl"], auth.supabase_url())

        r = client.post("/api/decks", headers=h, json={
            "id": DECK, "title": "Жива перевірка", "field_names": ["Питання", "Відповідь"],
        })
        check("колода створилась", r.status_code, 201)

        r = client.get("/api/decks", headers=h)
        check("список доступний", r.status_code, 200)
        check("наша колода в списку", DECK in [d["id"] for d in r.json()["decks"]], True)

        r = client.put(f"/api/decks/{DECK}/cards", headers=h, json={"cards": [
            {"id": str(uuid_mod.uuid4()), "values": {"Питання": "працює?", "Відповідь": "так"}},
        ]})
        check("картка збережена", r.status_code, 200)

        r = client.get(f"/api/decks/{DECK}", headers=h)
        check("картка читається", len(r.json()["cards"]), 1)
        check("значення на місці", r.json()["cards"][0]["values"]["Питання"], "працює?")

        print("\nБез токена — 401 навіть для реального користувача")
        check("GET без токена", client.get("/api/decks").status_code, 401)
        check("чужий токен", client.get("/api/decks", headers={"Authorization": "Bearer abc.def.ghi"}).status_code, 401)

        print("\nЕкспорт колоди, збереженої в БД, дає стабільний id")
        deck = client.get(f"/api/decks/{DECK}", headers=h).json()
        r = client.post("/api/export-deck", headers=h, json={
            "title": deck["title"], "field_names": deck["fieldNames"],
            "css": deck["css"], "deck_id": deck["id"],
            "cards": [{"id": c["id"], "values": c["values"]} for c in deck["cards"]],
        })
        check("apkg віддано", r.status_code, 200)
        check("файл не порожній", len(r.content) > 1000, True)

        r2 = client.post("/api/export-deck", headers=h, json={
            "title": deck["title"] + " (змінено)", "field_names": deck["fieldNames"],
            "css": deck["css"], "deck_id": deck["id"],
            "cards": [{"id": c["id"], "values": c["values"]} for c in deck["cards"]],
        })
        import sqlite3
        import tempfile
        import zipfile

        def guids(content):
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                inner = [n for n in zf.namelist() if n.endswith(".anki2")][0]
                path = os.path.join(tempfile.mkdtemp(), "c.anki2")
                with open(path, "wb") as fh:
                    fh.write(zf.read(inner))
            con = sqlite3.connect(path)
            try:
                return sorted(g for (g,) in con.execute("select guid from notes"))
            finally:
                con.close()

        check("КЛЮЧОВЕ: guid не змінились після перейменування",
              guids(r2.content), guids(r.content))
        check("guid — це id картки з БД", guids(r.content), [deck["cards"][0]["id"]])

        print("\nВидалення прибирання")
        check("колоду видалено", client.delete(f"/api/decks/{DECK}", headers=h).status_code, 200)
        check("колоди більше немає", client.get(f"/api/decks/{DECK}", headers=h).status_code, 404)
finally:
    async def _cleanup():
        p = await database.get_pool()
        await p.execute("delete from decks where id = $1", uuid_mod.UUID(DECK))
        await database.close_pool()
    asyncio.run(_cleanup())

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
