"""
Тести автентифікації.

Дві групи:
  1. Розбір Authorization — чистий код, без залежностей.
  2. Робота current_user_id із підміною fetch_user, щоб перевірити
     обв'язку (кеш, витягування id, мапінг помилок) без пароля.

Окремо — реальна мережева перевірка: сміття має бути відхилене
справжнім Supabase. Реальний вхід перевіряється в браузері.
"""
import asyncio
import io
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from dotenv import load_dotenv
load_dotenv(r"E:\learning\projects\anki-telegram-bot\.env")

import auth
from auth import AuthError, current_user_id, supabase_url, _extract_bearer, clear_cache
from fastapi import HTTPException

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


USER = "dc768abe-e8d4-4736-b210-0628c765a9d1"

print("Конфігурація")
check("URL прочитано", supabase_url(), "https://dgnqitkrkcfzgbwjyuom.supabase.co")
check("URL без слеша в кінці", supabase_url().endswith("/"), False)

print("\nРозбір заголовка Authorization")
check("Bearer з пробілом", _extract_bearer("Bearer abc.def.ghi"), "abc.def.ghi")
check("bearer у нижньому регістрі", _extract_bearer("bearer abc.def.ghi"), "abc.def.ghi")
check("BEARER у верхньому", _extract_bearer("BEARER abc.def.ghi"), "abc.def.ghi")
check("зайві пробіли обрізано", _extract_bearer("Bearer   abc  "), "abc")
for bad in (None, "", "Basic abc", "abc.def.ghi", "Bearer", "Bearer   ", "Token x"):
    got = False
    try:
        _extract_bearer(bad)
    except AuthError:
        got = True
    check(f"відхилено {bad!r}", got, True)

print("\nОбв'язка current_user_id (fetch_user підмінено)")
real_fetch = auth.fetch_user


def _resp(payload):
    async def _f(token):
        return payload
    return _f


def _none(token=None):
    async def _f(t):
        return None
    return _f


def _token_check(token=None):
    async def _f(t):
        if t != "good-token":
            raise AuthError("токен не той")
        return {"id": USER}
    return _f


def run(fetch_impl, token="good-token"):
    auth.fetch_user = fetch_impl
    clear_cache()
    try:
        return asyncio.run(current_user_id(f"Bearer {token}"))
    finally:
        auth.fetch_user = real_fetch
        clear_cache()


def status_of(fetch_impl, token="good-token"):
    auth.fetch_user = fetch_impl
    clear_cache()
    try:
        asyncio.run(current_user_id(f"Bearer {token}"))
    except HTTPException as e:
        return e.status_code
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {e}"
    finally:
        auth.fetch_user = real_fetch
        clear_cache()


check("id узято з відповіді", run(_resp({"id": USER})), USER)
check("id зберігається в UUID-вигляді",
      run(_resp({"id": USER.upper()})), USER)
check("не-UUID id відхилено", status_of(_resp({"id": "not-a-uuid"})), 401)
check("відсутній id відхилено", status_of(_resp({})), 401)
check("Supabase повернув None (токен битий)", status_of(_none()), 401)
check("роль service_role відхилено",
      status_of(_resp({"id": USER, "role": "service_role"})), 401)
check("роль authenticated прийнято",
      run(_resp({"id": USER, "role": "authenticated"})), USER)
check("запит ішов саме з цим токеном", run(_token_check()), USER)

print("\nКеш на 60 секунд")
calls = {"n": 0}


def counting(token=None):
    async def _f(t):
        calls["n"] += 1
        return {"id": USER}
    return _f


auth.fetch_user = counting()
clear_cache()
asyncio.run(current_user_id("Bearer cache-me"))
asyncio.run(current_user_id("Bearer cache-me"))
asyncio.run(current_user_id("Bearer cache-me"))
check("Supabase опитано один раз на 3 запити", calls["n"], 1)
clear_cache()
asyncio.run(current_user_id("Bearer other"))
check("інший токен — окремий запис у кеші", calls["n"], 2)

# Кешований токен мусить лишатись дійсним після зміни відповіді,
# інакше ми б робили запит на кожен виклик.
auth.fetch_user = counting()
clear_cache()
asyncio.run(current_user_id("Bearer cache-me-2"))
before = calls["n"]
auth.fetch_user = counting()
auth.fetch_user = lambda t: _raise_bad()
asyncio.run(current_user_id("Bearer cache-me-2"))
check("кеш не ходить у Supabase повторно", calls["n"], before)
auth.fetch_user = real_fetch
clear_cache()

print("\nПомилки транспорту не виглядають як 401")


def _raise_bad():
    async def _f(t):
        raise HTTPException(status_code=503, detail="Supabase недоступний")
    return _f


check("503, а не 401", status_of(_raise_bad()), 503)

print("\nAuthError — це 401 з WWW-Authenticate")
err = AuthError()
check("код", err.status_code, 401)
check("заголовок", err.headers.get("WWW-Authenticate"), "Bearer")
check("це HTTPException", isinstance(err, HTTPException), True)

print("\nРеальна перевірка в Supabase (сміття має відхилятись)")
result = status_of(real_fetch, token="obviously-not-a-real-token")
check("випадковий токен -> 401", result, 401)

anon_result = status_of(real_fetch, token=auth._anon_key())
check("anon-ключ не приймається як сесія", anon_result, 401)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
