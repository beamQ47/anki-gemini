"""
Тест перевірки швидкості та пріоритету моделей Gemini.

Перевіряє:
  1. Розташування ланцюжка моделей у порядку спадання швидкості
     (найшвидші lite-моделі відповідають першими, не витрачаючи час на 503).
  2. Відображення затримки (latency) у мілісекундах у статусі монітора процесів.
  3. Коректність визначення черги та fallback-моделей.
"""
import asyncio
import io
import os
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = r"E:\learning\projects\anki-telegram-bot"
os.chdir(ROOT)
sys.path.insert(0, ROOT)

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

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
        print(f"  FAIL {label}" + (f"\n         {detail}" if detail else ""))


print("Перевірка порядку моделей за швидкістю (спадання швидкодії)")
check("перша модель у ланцюжку — gemini-flash-lite-latest", main.MODEL_CHAIN[0], "gemini-flash-lite-latest")
check("друга модель у ланцюжку — gemini-3.5-flash-lite", main.MODEL_CHAIN[1], "gemini-3.5-flash-lite")
check("третя модель у ланцюжку — gemini-3.1-flash-lite", main.MODEL_CHAIN[2], "gemini-3.1-flash-lite")
check_that("lite-моделі передують важким моделям",
           main.MODEL_CHAIN.index("gemini-flash-lite-latest") < main.MODEL_CHAIN.index("gemini-3.8-flash"))
check_that("gemini-4-hydrogen у кінці як fallback",
           main.MODEL_CHAIN.index("gemini-4-hydrogen") > main.MODEL_CHAIN.index("gemini-3.1-flash-lite"))

print("\nПеревірка ендпоїнта статусу процесів та затримки")
with TestClient(main.app) as client:
    res = client.get("/api/system/process-status")
    check("код відповіді 200", res.status_code, 200)
    data = res.json()
    check_that("присутній active_model", "active_model" in data, str(data))
    check_that("присутній model_chain", isinstance(data.get("model_chain"), list), str(data))
    check_that("перша модель у статусі збігається з найшвидшою", data["model_chain"][0] == "gemini-flash-lite-latest")
    check_that("присутнє поле last_latency_ms", "last_latency_ms" in data)
    check_that("присутнє поле is_generating", "is_generating" in data)

print("\nІмітація швидкої відповіді та фіксація затримки")
class FakeSpeedModel:
    async def generate_content(self, model=None, config=None, contents=None):
        await asyncio.sleep(0.05)  # 50 ms
        return type("R", (), {"text": '{"cards": [{"Front": "Q", "Back": "A"}]}'})()

class FakeSpeedClient:
    class aio:
        models = FakeSpeedModel()

orig_client = main.client
try:
    main.client = FakeSpeedClient()
    main.MODEL_CHAIN = ["gemini-flash-lite-latest"]
    t0 = time.time()
    reply = asyncio.run(main.ask_ai("питання", [], None, None))
    elapsed = round((time.time() - t0) * 1000)
    check_that("отримано відповідь", "cards" in reply)
    check_that("затримка зафіксована у моніторі", main._process_monitor["last_latency_ms"] >= 40)
    check("остання успішна модель", main._process_monitor["last_model"], "gemini-flash-lite-latest")
finally:
    main.client = orig_client
    main.MODEL_CHAIN = [
        name.strip()
        for name in os.getenv("GEMINI_MODEL_CHAIN", main.DEFAULT_MODEL_CHAIN).split(",")
        if name.strip()
    ]

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
