"""
Тест ієрархії колод на живій базі: батьки, перенесення, цикли, каскад.

Найважливіші тут не щасливі випадки, а відмови. Три способи розірвати
дерево, які перевіряються окремо:
  * батько, який належить іншому користувачеві, — не приймається за батька;
  * колода не може стати нащадком себе або власного нащадка (цикл);
  * видалення батька тягне за собою гілку — і клієнт мусить знати про це
    заздалегідь, бо відновити таке неможливо.
"""
import asyncio
import io
import sys
import uuid as uuid_mod

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from dotenv import load_dotenv
load_dotenv(r"E:\learning\projects\anki-telegram-bot\.env")

import db
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


def new_id() -> str:
    return str(uuid_mod.uuid4())


async def make_user(pool, email: str) -> str:
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
    pool = await db.get_pool()
    ALICE = await make_user(pool, f"hier-alice-{uuid_mod.uuid4().hex[:8]}@example.invalid")
    BOB = await make_user(pool, f"hier-bob-{uuid_mod.uuid4().hex[:8]}@example.invalid")

    U, M, L1, L2, F1 = new_id(), new_id(), new_id(), new_id(), new_id()
    BOB_DECK = new_id()
    FIELDS = ["Питання", "Відповідь"]

    def make(deck_id, title, parent=None):
        return db.create_deck(ALICE, deck_id, title, FIELDS, ".card{}", [], parent)

    def status_of(fn, *args):
        """Код помилки від sync-функції або 'без помилки'."""
        try:
            fn(*args)
            return "без помилки"
        except HTTPException as e:
            return e.status_code

    async def status_of_a(fn, *args):
        """Те саме для coroutine-функцій."""
        try:
            await fn(*args)
            return "без помилки"
        except HTTPException as e:
            return e.status_code

    try:
        print("Трирівневе дерево")
        check("корінь у базі", (await make(U, "університет"))["parentId"], None)
        check("дитина зберігає parent_id", (await make(M, "математика", U))["parentId"], U)
        check("листок зберігає parent_id", (await make(L1, "лекція 1", M))["parentId"], M)
        await make(L2, "лекція 2", M)
        await make(F1, "фізика", U)

        print("\nparent_id у відповіді сервера")
        listed = {d["id"]: d for d in await db.list_decks(ALICE)}
        check("усі п'ять на місці", len(listed), 5)
        check("кожна має parentId", all("parentId" in d for d in listed.values()), True)
        check("коефіцієнт математики", listed[M]["parentId"], U)
        check("коефіцієнт лекції", listed[L1]["parentId"], M)
        check("коефіцієнт фізики", listed[F1]["parentId"], U)
        check("uuid у нормалізованому вигляді", listed[L1]["parentId"], M)

        print("\nІЗОЛЯЦІЯ — чужий батьк не приймається")
        await db.create_deck(BOB, BOB_DECK, "Чужа", FIELDS, "", [])
        hijacked = await make(new_id(), "Під чужим", BOB_DECK)
        check("колода створилась у корені", hijacked["parentId"], None)
        check("у Bob та колода зберіглася в його списку",
              (await db.get_deck(BOB, BOB_DECK))["title"], "Чужа")
        check("перенесення під колоду Alice -> 404",
              await status_of_a(db.move_deck, BOB, BOB_DECK, U), 404)
        check("Bob не підчепився до чужого дерева",
              (await db.get_deck(BOB, BOB_DECK))["parentId"], None)
        check("колода Alice не стала нащадком чужої",
              (await db.get_deck(ALICE, U))["parentId"], None)

        print("\nЦикли")
        check("себе під себе -> 409",
              await status_of_a(db.move_deck, ALICE, U, U), 409)
        check("U не став нащадком свого онука",
              (await db.get_deck(ALICE, U))["parentId"], None)
        deep = await db.move_deck(ALICE, M, F1)
        check("перенесення сусідньої гілки дозволено", deep["parentId"], F1)
        check("прямий батьок нащадка не змінився",
              (await db.get_deck(ALICE, L1))["parentId"], M)
        check("U тепер у корені, досі не нащадок F1",
              (await db.get_deck(ALICE, U))["parentId"], None)
        check("перенесення U під L1 (нащадка) -> 409",
              await status_of_a(db.move_deck, ALICE, U, L1), 409)
        check("U не змінився після відмови",
              (await db.get_deck(ALICE, U))["parentId"], None)
        check("кривий батьк -> 422",
              await status_of_a(db.move_deck, ALICE, L2, "не-uuid"), 422)
        check("неіснуючий батьк -> 404",
              await status_of_a(db.move_deck, ALICE, L2, new_id()), 404)
        check("L2 не випала з математики", (await db.get_deck(ALICE, L2))["parentId"], M)
        await db.move_deck(ALICE, M, U)
        check("повернули maths під університет",
              (await db.get_deck(ALICE, M))["parentId"], U)

        print("\nОднакові назви серед сусідів")
        twin = await make(new_id(), "Математика")
        check("корінь із такою назвою можна", twin["parentId"], None)
        check("під університелем такий дубль -> 409",
              await status_of_a(db.move_deck, ALICE, twin["id"], U), 409)
        check("дубль лишився в корені",
              (await db.get_deck(ALICE, twin["id"]))["parentId"], None)
        check("регістр не ходить в обхід",
              await status_of_a(db.create_deck, ALICE, new_id(), "ЛЕКЦІЯ 1", FIELDS, "", [], M), 409)
        await db.delete_deck(ALICE, twin["id"])

        print("\nЦикл через create_deck теж не проходить")
        cyc = await make(U, "перейменований", L1)
        check("U не став нащадком лекції", cyc["parentId"], None)
        check("назву оновили", cyc["title"], "перейменований")

        print("\nПеренесення в корінь")
        check("L2 у корінь", (await db.move_deck(ALICE, L2, None))["parentId"], None)
        check("update_deck не чіпає вкладеність без parent_id",
              (await db.update_deck(ALICE, L2, "Лекція 2 (rename)", FIELDS, "", []))["parentId"], None)

        print("\nНезнайдений батьк не ламає колоду")
        orphan = await make(new_id(), "сирота", new_id())
        check("у корені", orphan["parentId"], None)
        check("кривий рядок теж у корені",
              (await make(new_id(), "кривий", "не-uuid"))["parentId"], None)

        print("\ncount_descendants")
        check("у гілці університету 3 нащадки", await db.count_descendants(ALICE, U), 3)
        check("листок без нащадків", await db.count_descendants(ALICE, L1), 0)
        check("математика має лише лекцію 1 (лекція 2 пішла в корінь)",
              await db.count_descendants(ALICE, M), 1)

        print("\nКаскадне видалення")
        check("видалено корінь", await db.delete_deck(ALICE, U), True)
        survivors = {d["id"]: d["title"] for d in await db.list_decks(ALICE)}
        check("гілка зникла разом із коренем",
              [t for t in survivors.values() if t in ("математика", "лекція 1", "фізика")], [])
        check("лісні колоди, над якими не працювали, лишилися",
              sorted(survivors.values()),
              sorted(["Лекція 2 (rename)", "сирота", "кривий", "Під чужим"]))
        check("жодна колода не лишилась без батька",
              [d for d in await db.list_decks(ALICE) if d["parentId"]], [])
        check("картки нащадків теж",
              await pool.fetchval(
                  "select count(*) from notes n join decks d on d.id = n.deck_id "
                  "where d.user_id = $1", uuid_mod.UUID(ALICE)),
              0)
    finally:
        await pool.execute(
            "delete from decks where user_id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
        await pool.execute(
            "delete from auth.users where id = any($1::uuid[])",
            [uuid_mod.UUID(ALICE), uuid_mod.UUID(BOB)],
        )
        print("\n[прибрано за собою]")

    await db.close_pool()


asyncio.run(main())
print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
