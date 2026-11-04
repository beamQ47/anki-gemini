"""
Тести доступу до БД на живій базі.

Робота йде на справжньому Supabase, але з окремим тестовим
користувачем і прибиранням за собою. Справжній `dc768abe-...`
не чіпається: тест мусить бути безпечним для повторного запуску.

Найважливіші перевірки тут — про ізоляцію. Обхід RLS роллю postgres
робить фільтр WHERE user_id обов'язковим, а не формальним, тому
кожен запит перевіряється на спробу дістати чужі дані.
"""
import asyncio
import io
import os
import sys
import uuid as uuid_mod

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from dotenv import load_dotenv
load_dotenv(r"E:\learning\projects\anki-telegram-bot\.env")

import db
from anki_ids import deck_anki_id, model_anki_id

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


REAL_USER = "dc768abe-e8d4-4736-b210-0628c765a9d1"
ALICE = None
BOB = None
DECK = None
FIELDS = ["Питання", "Відповідь"]


async def make_user(pool, email: str) -> str:
    """Створює інертного користувача в auth.users.

    Потрібний, бо на decks.user_id є зовнішній ключ на auth.users —
    без реального рядка INSERT падає. encrypted_password лишається
    NULL: такий користувач не може увійти за паролем, тож навіть
    випадково не стане живим обліковим записом.
    """
    user_id = uuid_mod.uuid4()
    await pool.execute(
        """
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                                email_confirmed_at, raw_app_meta_data,
                                raw_user_meta_data, created_at, updated_at)
        values ($1,
                coalesce((select instance_id from auth.users limit 1),
                         '00000000-0000-0000-0000-000000000000'::uuid),
                'authenticated', 'authenticated', $2, null, now(),
                '{"provider":"email","providers":["email"]}'::jsonb,
                '{}'::jsonb, now(), now())
        """,
        user_id, email,
    )
    return str(user_id)


async def main():
    print("Підключення")
    pool = await db.get_pool()
    check("пул створено", pool is not None, True)
    check("повторний виклик повертає той самий пул", await db.get_pool() is pool, True)
    check("dsn нормалізовано на postgresql://", db.dsn().startswith("postgresql://"), True)

    global ALICE, BOB, DECK
    ALICE = await make_user(pool, f"dbtest-alice-{uuid_mod.uuid4().hex[:8]}@example.invalid")
    BOB = await make_user(pool, f"dbtest-bob-{uuid_mod.uuid4().hex[:8]}@example.invalid")
    DECK = str(uuid_mod.uuid4())
    print(f"\nТестові користувачі створено (видаляться у finally)")

    try:
        print("\nСтворення колоди")
        created = await db.create_deck(ALICE, DECK, "Тестова колода", FIELDS, ".card{}", [])
        check("колода створена", created["id"], DECK)
        check("title", created["title"], "Тестова колода")
        check("fieldNames", created["fieldNames"], FIELDS)
        check("css", created["css"], ".card{}")
        check("cards порожній", created["cards"], [])
        check("state", created["state"], "draft")
        check("uuid нормалізовано у відповіді", created["id"], DECK.lower())

        print("\nAnki-ідентифікація збережена разом із колодою")
        row = await pool.fetchrow(
            "select anki_deck_id, anki_model_id, model_name from decks where id = $1", uuid_mod.UUID(DECK))
        check("anki_deck_id == deck_anki_id(uuid)", row["anki_deck_id"], deck_anki_id(DECK))
        check("anki_model_id == model_anki_id(uuid)", row["anki_model_id"], model_anki_id(DECK))
        check("model_name не порожній", bool(row["model_name"]), True)

        print("\nКартки")
        n1 = await db.add_note(ALICE, DECK, str(uuid_mod.uuid4()), {"Питання": "a", "Відповідь": "b"})
        n2 = await db.add_note(ALICE, DECK, str(uuid_mod.uuid4()), {"Питання": "c", "Відповідь": "d"})
        check_that("картка створена", n1 is not None)
        check("значення збережено", n1["values"], {"Питання": "a", "Відповідь": "b"})

        n1_id = n1["id"]
        updated = await db.update_note(ALICE, n1_id, {"Питання": "a2", "Відповідь": "b2"})
        check("картку оновлено", updated["values"], {"Питання": "a2", "Відповідь": "b2"})

        deck = await db.get_deck(ALICE, DECK)
        check("у колоді дві картки", len(deck["cards"]), 2)
        check("картки мають values", all("values" in c for c in deck["cards"]), True)
        check("картки не мають flattened-ключів", "Питання" in deck["cards"][0], False)

        print("\nСписок колод")
        mine = await db.list_decks(ALICE)
        check("одна колода", len(mine), 1)
        check("це моя колода", mine[0]["id"], DECK)
        check("з картками", len(mine[0]["cards"]), 2)

        print("\nІЗОЛЯЦІЯ — Bob не має доступу до колоди Alice")
        check("Bob не бачить її у списку", [d["id"] for d in await db.list_decks(BOB)], [])
        check("get_deck -> None", await db.get_deck(BOB, DECK), None)
        check("update_deck -> None", await db.update_deck(BOB, DECK, "Взламано", FIELDS, "", []), None)
        check("update_note -> None", await db.update_note(BOB, n1_id, {"Питання": "злом"}), None)
        check("add_note -> None", await db.add_note(BOB, DECK, str(uuid_mod.uuid4()), {"Питання": "x"}), None)
        check("delete_note -> False", await db.delete_note(BOB, n1_id), False)
        check("delete_deck -> False", await db.delete_deck(BOB, DECK), False)

        print("\nПеревірка, що злом не вдався")
        still = await db.get_deck(ALICE, DECK)
        check("назва не змінилася", still["title"], "Тестова колода")
        edited = [c for c in still["cards"] if c["id"] == n1_id][0]
        check("значення не змінилися", edited["values"], {"Питання": "a2", "Відповідь": "b2"})

        print("\nСправжній користувач не сміє бачити тестові дані")
        real_decks = await db.list_decks(REAL_USER)
        check("тестової колоди в його списку немає", DECK in [d["id"] for d in real_decks], False)

        print("\nСтворення картки в чужій колоді не проходить")
        check("add_note у колоду Alice від Bob -> None",
              await db.add_note(BOB, DECK, str(uuid_mod.uuid4()), {"Питання": "x"}), None)

        print("\nПовна заміна карток (сценарій повторного імпорту)")
        removed = await db.delete_notes_of_deck(ALICE, DECK)
        check("видалено обидві", removed, 2)
        check("колода порожніша", len((await db.get_deck(ALICE, DECK))["cards"]), 0)
        check("повторний виклик нічого не видаляє", await db.delete_notes_of_deck(ALICE, DECK), 0)

        print("\nПовторне створення тієї самої колоди не дублює")
        again = await db.create_deck(ALICE, DECK, "Оновлена", FIELDS, ".card{}2", [])
        check("title оновлено", again["title"], "Оновлена")
        check("усього одна колода", len(await db.list_decks(ALICE)), 1)

        print("\nБібліотека стилів акаунта")
        STYLE = str(uuid_mod.uuid4())
        style = await db.create_style(ALICE, STYLE, "Основний", ".card{color:red}")
        check("стиль створено", style["id"], STYLE)
        check("назва стилю", style["name"], "Основний")
        check("css стилю", style["css"], ".card{color:red}")
        check("стиль у списку", [s["id"] for s in await db.list_styles(ALICE)], [STYLE])
        check("Bob не бачить стиль", await db.list_styles(BOB), [])
        check("get_style для Bob -> None", await db.get_style(BOB, STYLE), None)
        check_that("update_style для Bob -> None",
                   await db.update_style(BOB, STYLE, "злом", "x") is None)

        bound = await db.update_deck(ALICE, DECK, "Оновлена", FIELDS, ".card{}", [],
                                     style_id=STYLE)
        check("колода посилається на стиль", bound["styleId"], STYLE)
        updated = await db.update_style(ALICE, STYLE, "Основний 2", ".card{color:blue}")
        check("стиль оновлено", updated["name"], "Основний 2")
        deck_after = await db.get_deck(ALICE, DECK)
        check("css колоди оновився разом зі стилем", deck_after["css"], ".card{color:blue}")
        check("посилання на стиль не змінилось", deck_after["styleId"], STYLE)

        # Чужий style_id не можна прив'язати навіть через create_deck:
        # інакше колода посилалася б на невидимий стиль.
        BOB_DECK = str(uuid_mod.uuid4())
        bob_deck = await db.create_deck(BOB, BOB_DECK, "Чужа", FIELDS, "", [],
                                        style_id=STYLE)
        check("чужий стиль не прив'язався", bob_deck["styleId"], None)
        await db.delete_deck(BOB, BOB_DECK)

        check("стиль видалено", await db.delete_style(ALICE, STYLE), True)
        orphan = await db.get_deck(ALICE, DECK)
        check("колода лишилась після видалення стилю", bool(orphan), True)
        check("посилання на стиль очищено", orphan["styleId"], None)
        check("css-знімок лишився в колоді", orphan["css"], ".card{color:blue}")

        print("\nВидалення")
        check("колоду видалено", await db.delete_deck(ALICE, DECK), True)
        check("повторне видалення -> False", await db.delete_deck(ALICE, DECK), False)
        check("список порожній", await db.list_decks(ALICE), [])

        print("\nКриваві id дають 422, а не 500")
        from fastapi import HTTPException
        for bad in ("не-uuid", "", "123", None):
            try:
                await db.get_deck(ALICE, bad)
                got = "без помилки"
            except HTTPException as e:
                got = e.status_code
            check(f"deck id {bad!r}", got, 422)

    finally:
        await pool.execute("delete from decks where id = $1", uuid_mod.UUID(DECK))
        await pool.execute(
            "delete from auth.users where id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
        print("\n[прибрано за собою: колоду і двох тестових користувачів]")

    await db.close_pool()


asyncio.run(main())
print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
