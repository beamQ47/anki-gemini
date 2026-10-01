"""Застосування міграцій із db/migrations/*.sql у порядку імені файлу.

Використання:  venv\\Scripts\\python.exe db/migrate.py [шлях_до_файлу]

Скрипт ідемпотентний у межах однієї міграції: pg-обгортка з BEGIN/COMMIT
атомарна, тож частково застосованої міграції не буває. Але щоб не
застосувати двічі те, що уже в базі, кожна міграція має бути записана
в schema_migrations — таблицю створюємо тут, якщо її ще немає.

Перед застосуванням файлу показується, що саме зміниться: міграції до
справжньої бази пишуться одразу, тому задумка має читатися без
підглядання в git.
"""
import asyncio
import io
import pathlib
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import db

MIGRATIONS_DIR = ROOT / "db" / "migrations"

CREATE_TABLE = """
create table if not exists public.schema_migrations (
    name       text        primary key,
    applied_at timestamptz not null default now()
)
"""


async def pending(pool) -> list[pathlib.Path]:
    rows = [r["name"] for r in await pool.fetch("select name from public.schema_migrations")]
    files = sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.is_dir() else []
    return [f for f in files if f.name not in rows]


async def main() -> int:
    pool = await db.get_pool()
    try:
        await pool.execute(CREATE_TABLE)
        todo = await pending(pool)
        if not todo:
            print("Немає нових міграцій.")
            return 0

        for path in todo:
            print(f"\n=== {path.name} ===")
            sql = path.read_text(encoding="utf-8")
            print(sql.strip())
            print("--- застосовую ---")
            await pool.execute(sql)
            # pg-обгортка з COMMIT уже закрила транзакцію execute(), тому
            # позначку ставимо окремо: якщо падіння станеться тут,
            # міграція вже застосована, а таблиця просто не знає.
            await pool.execute(
                "insert into public.schema_migrations (name) values ($1) "
                "on conflict (name) do nothing",
                path.name,
            )
            print(f"OK: {path.name}")
    finally:
        await db.close_pool()
    return 0


sys.exit(asyncio.run(main()))
