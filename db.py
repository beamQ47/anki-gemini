"""
Доступ до PostgreSQL (Supabase) через asyncpg.

Правило, без якого тут небезпечно: сервер підключається напряму
роллю postgres, а та Role обходить RLS — політики Supabase на
прямому з'єднанні не діють. Тому кожен запит мусить містити
WHERE user_id = $1 (а для карток — перевірку, що колода належить
користувачеві). Без цього будь-який авторизований користувач читав
би й змінював чужі колоди, просто підставивши чужий id у запит.
"""

import json
import os

import asyncpg
from fastapi import HTTPException
from urllib.parse import quote

from anki_ids import deck_anki_id, model_anki_id, model_name_for

_pool: asyncpg.Pool | None = None


def dsn() -> str:
    """Рядок підключення до PostgreSQL.

    Пріоритет у DATABASE_URL. Якщо його немає — збираємо з окремих
    змінних DB_*, щоб вистачало одного DB_PASSWORD, а не всього DSN.
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        url = _dsn_from_parts()
    if not url:
        missing = [k for k in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
                   if not os.getenv(k, "").strip()]
        raise HTTPException(
            status_code=503,
            detail="Немає налаштувань БД. Додай у .env DATABASE_URL або DB_PASSWORD. "
                   "Бракує: " + (", ".join(missing) if missing else "нічого"),
        )
    # asyncpg не приймає стару схему postgres:// — потрібна postgresql://
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def _dsn_from_parts() -> str:
    """Складає DSN із DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD."""
    host = os.getenv("DB_HOST", "").strip()
    port = os.getenv("DB_PORT", "").strip()
    name = os.getenv("DB_NAME", "").strip()
    user = os.getenv("DB_USER", "").strip()
    password = os.getenv("DB_PASSWORD", "")
    if not all((host, port, name, user, password)):
        return ""
    return (f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}"
            f"@{host}:{port}/{name}")


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn(),
            # Обов'язково для transaction pooler (:6543) — інакше
            # asyncpg готує запити заради і кешує їх, а пулер щоразу
            # віддає інший бекенд, і підготовлений запит більше не
            # дійшов би до сервера.
            statement_cache_size=0,
            min_size=1,
            max_size=5,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# --- ПЕРЕТВОРЕННЯ РЯДКІВ У ФОРМАТ ФРОНТЕНДУ ---

def deck_to_json(row) -> dict:
    """Колода в тому ж вигляді, який очікує decks.js."""
    return {
        "id": str(row["id"]),
        "parentId": str(row["parent_id"]) if row["parent_id"] else None,
        "title": row["title"],
        "fieldNames": json.loads(row["field_names"]) if isinstance(row["field_names"], str) else (row["field_names"] or []),
        "css": row["css"] or "",
        "templates": json.loads(row["templates"]) if isinstance(row["templates"], str) else (row["templates"] or []),
        "styles": json.loads(row["styles"]) if isinstance(row["styles"], str) else (row["styles"] or EMPTY_STYLES),
        "state": row["state"],
        "updatedAt": int(row["updated_at"].timestamp() * 1000),
        "createdAt": int(row["created_at"].timestamp() * 1000),
    }


def note_to_json(row) -> dict:
    return {
        "id": str(row["id"]),
        "values": json.loads(row["field_values"]) if isinstance(row["field_values"], str) else (row["field_values"] or {}),
        "createdAt": int(row["created_at"].timestamp() * 1000),
    }


DECK_COLUMNS = "id, parent_id, title, state, field_names, css, templates, styles, created_at, updated_at"

# Бібліотека стилів — об'єкт, бо активний стиль живе в ньому сам
# (styles.activeId). Окремою колонкою він був би другим джерелом
# істини: можна було б зберегти активний стиль, якого в бібліотеці немає.
EMPTY_STYLES = {"activeId": "", "items": []}


def styles_json(styles) -> str:
    """Бібліотека стилів для jsonb: завжди об'єкт, ніколи null."""
    if not isinstance(styles, dict):
        return json.dumps(EMPTY_STYLES, ensure_ascii=False)
    items = styles.get("items")
    active = styles.get("activeId")
    payload = {
        "activeId": active if isinstance(active, str) else "",
        "items": items if isinstance(items, list) else [],
    }
    return json.dumps(payload, ensure_ascii=False)


# --- ІЄРАРХІЯ КОЛОД ---
#
# parent_id — єдине джерело істини про вкладеність. Назва з "::" у ній
# не зберігається: вона лише вигляд для Anki і для інтерфейсу, а
# розгадувати її знову на сервері — значить допускати розбіжність між
# тим, що бачить користувач, і тим, що лежить у базі.

async def _resolve_parent(user_id: str, parent_id, deck_id: str | None = None):
    """Перевіряє батька і повертає його uuid або None.

    Чужий або неіснуючий батьк — це не помилка запиту, а відсутність
    батька: колода опиняється в корені. Так користувач не втрачає
    колоду через одну неправильну посилання в localStorage.

    Для створення це єдино правильна поведінка: батька ще нема, тож
    втрачати нічого. Для перенесення — ні: там мовчки кинути колоду в
    корінь означало б непомітно зруйнувати наявне дерево, тому
    move_deck використовує _parent_for_move, яка відмовляє голосно.
    """
    if parent_id in (None, ""):
        return None
    try:
        parent_uuid = _uuid(parent_id, "deck")
    except HTTPException:
        return None
    if deck_id and str(parent_uuid) == str(deck_id):
        return None

    pool = await get_pool()
    owned = await pool.fetchval(
        "select 1 from decks where id = $1 and user_id = $2", parent_uuid, user_id
    )
    if not owned:
        return None
    if deck_id and await _is_descendant(pool, user_id, str(parent_uuid), str(deck_id)):
        return None
    return parent_uuid


async def _parent_for_move(user_id: str, deck_id: str, parent_id):
    """Те саме, але для перенесення: поганий батьк — це помилка, а не корінь.

    Різниця з _resolve_parent не косметична. «Перенести під іншу гілку»
    означає «зміни наявного батька»; якщо замість цього колода тихо
    опиниться в корені, користувач втратить зв'язок, який бачив на
    екрані, і не дізнається про це — аж поки не спробує експортувати
    лекцію й не знайде її не в тому дереві.
    """
    if parent_id in (None, ""):
        return None
    parent_uuid = _uuid(parent_id, "deck")  # кривий id -> 422
    if str(parent_uuid) == str(deck_id):
        raise HTTPException(status_code=409, detail="Колоду не можна вкласти в саму себе")

    pool = await get_pool()
    owned = await pool.fetchval(
        "select 1 from decks where id = $1 and user_id = $2", parent_uuid, user_id
    )
    if not owned:
        # 404, а не 403: колода чужа і колоди не існує — неоднозначно
        # повідомляти, що вона десь є.
        raise HTTPException(status_code=404, detail="Батьківської колоди не знайдено")
    if await _is_descendant(pool, user_id, str(parent_uuid), str(deck_id)):
        raise HTTPException(
            status_code=409, detail="Не можна перенести колоду в її власну підколоду"
        )
    return parent_uuid


async def _is_descendant(pool, user_id: str, candidate_id: str, ancestor_id: str) -> bool:
    """Чи є candidate_id нащадком ancestor_id (замикання вниз по parent_id).

    Рекурсивний CTE, бо глибину заздалегідь не знаємо, а обмежень на
    неї в схемі немає. Без цієї перевірки A можна було б підвісити під B,
    а B під A, і дерево втратило б обидві колоди назавжди.
    """
    return bool(await pool.fetchval(
        """
        with recursive subtree as (
            select id from decks where id = $2 and user_id = $1
            union all
            select d.id from decks d
            join subtree s on d.parent_id = s.id
            where d.user_id = $1
        )
        select 1 from subtree where id = $3 limit 1
        """,
        user_id, _uuid(ancestor_id, "deck"), _uuid(candidate_id, "deck"),
    ))


async def count_descendants(user_id: str, deck_id: str) -> int:
    """Скільки колод зникне разом із цією (ON DELETE CASCADE)."""
    pool = await get_pool()
    return int(await pool.fetchval(
        """
        with recursive subtree as (
            select id from decks where id = $2 and user_id = $1
            union all
            select d.id from decks d
            join subtree s on d.parent_id = s.id
            where d.user_id = $1
        )
        select count(*) from subtree
        """,
        user_id, _uuid(deck_id, "deck"),
    ) or 0) - 1


# --- КОЛОДИ ---

async def list_decks(user_id: str) -> list[dict]:
    pool = await get_pool()
    decks = await pool.fetch(
        f"select {DECK_COLUMNS} from decks where user_id = $1 order by updated_at desc",
        user_id,
    )
    if not decks:
        return []

    notes = await pool.fetch(
        """
        select n.id, n.deck_id, n.field_values, n.created_at
        from notes n
        join decks d on d.id = n.deck_id
        where d.user_id = $1
        order by n.created_at
        """,
        user_id,
    )

    by_deck: dict[str, list] = {}
    for note in notes:
        by_deck.setdefault(str(note["deck_id"]), []).append(note)

    result = []
    for deck in decks:
        payload = deck_to_json(deck)
        payload["cards"] = [note_to_json(n) for n in by_deck.get(payload["id"], [])]
        result.append(payload)
    return result


async def get_deck(user_id: str, deck_id: str) -> dict | None:
    pool = await get_pool()
    deck = await pool.fetchrow(
        f"select {DECK_COLUMNS} from decks where id = $1 and user_id = $2",
        _uuid(deck_id, "deck"),
        user_id,
    )
    if not deck:
        return None
    notes = await pool.fetch(
        "select id, field_values, created_at from notes where deck_id = $1 order by created_at",
        deck["id"],
    )
    payload = deck_to_json(deck)
    payload["cards"] = [note_to_json(n) for n in notes]
    return payload


async def create_deck(user_id: str, deck_id: str, title: str, field_names: list[str],
                      css: str, templates: list, parent_id=None, styles=None) -> dict:
    parent_uuid = await _resolve_parent(user_id, parent_id, deck_id)
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            """
            insert into decks (id, user_id, parent_id, title, state, field_names, css, templates,
                               styles, anki_deck_id, anki_model_id, model_name)
            values ($1, $2, $3, $4, 'draft', $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
            on conflict (id) do update
                set title = excluded.title,
                    parent_id = excluded.parent_id,
                    field_names = excluded.field_names,
                    css = excluded.css,
                    templates = excluded.templates,
                    styles = excluded.styles,
                    anki_deck_id = excluded.anki_deck_id,
                    anki_model_id = excluded.anki_model_id,
                    model_name = excluded.model_name,
                    updated_at = now()
            where decks.user_id = $2
            returning {cols}
            """.format(cols=DECK_COLUMNS),
            _uuid(deck_id, "deck"), user_id, parent_uuid, title,
            json.dumps(field_names, ensure_ascii=False), css or "",
            json.dumps(templates or [], ensure_ascii=False), styles_json(styles),
            deck_anki_id(deck_id), model_anki_id(deck_id), model_name_for(deck_id),
        )
    except asyncpg.UniqueViolationError:
        # decks_sibling_title_idx: два однакові назви в одній батьківській
        # колоді. 409, а не 500 — клієнт має зрозуміти, що треба змінити назву.
        raise HTTPException(
            status_code=409,
            detail=f"У цій колоді вже є підколода «{title}»",
        )
    if not row:
        return None
    payload = deck_to_json(row)
    payload["cards"] = []
    return payload


async def update_deck(user_id: str, deck_id: str, title: str, field_names: list[str],
                      css: str, templates: list, parent_id=None, styles=None) -> dict | None:
    # parent_id=None означає «не змінювати вкладеність», а не «перенести в
    # корінь»: PUT редагує вміст колоди, і раптове відчеплення від батька
    # було б несподіваним. Явний перенос — окремий запит move_deck.
    parent_uuid = await _resolve_parent(user_id, parent_id, deck_id)
    pool = await get_pool()
    try:
        if parent_uuid is None and parent_id in (None, ""):
            row = await pool.fetchrow(
                """
                update decks
                set title = $3, field_names = $4::jsonb, css = $5, templates = $6::jsonb,
                    styles = $7::jsonb, updated_at = now()
                where id = $1 and user_id = $2
                returning {cols}
                """.format(cols=DECK_COLUMNS),
                _uuid(deck_id, "deck"), user_id, title,
                json.dumps(field_names, ensure_ascii=False), css or "",
                json.dumps(templates or [], ensure_ascii=False), styles_json(styles),
            )
        else:
            row = await pool.fetchrow(
                """
                update decks
                set title = $3, parent_id = $8, field_names = $4::jsonb, css = $5,
                    templates = $6::jsonb, styles = $7::jsonb, updated_at = now()
                where id = $1 and user_id = $2
                returning {cols}
                """.format(cols=DECK_COLUMNS),
                _uuid(deck_id, "deck"), user_id, title,
                json.dumps(field_names, ensure_ascii=False), css or "",
                json.dumps(templates or [], ensure_ascii=False), styles_json(styles),
                parent_uuid,
            )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=409,
            detail=f"У цій колоді вже є підколода «{title}»",
        )
    return deck_to_json(row) if row else None


async def move_deck(user_id: str, deck_id: str, parent_id) -> dict | None:
    """Переносить колоду в іншу гілку, зберігаючи вміст.

    Окремий запит, а не правець update_deck: перенесення змінює структуру
    для всіх нащадків, тому воно мусить бути помітним кроком, а не
    побічним ефектом редагування колоди.
    """
    deck_uuid = _uuid(deck_id, "deck")
    pool = await get_pool()

    owned = await pool.fetchval(
        "select 1 from decks where id = $1 and user_id = $2", deck_uuid, user_id
    )
    if not owned:
        return None

    parent_uuid = await _parent_for_move(user_id, str(deck_uuid), parent_id)

    try:
        row = await pool.fetchrow(
            f"update decks set parent_id = $3, updated_at = now() "
            f"where id = $1 and user_id = $2 returning {DECK_COLUMNS}",
            deck_uuid, user_id, parent_uuid,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="У цієї колоди вже є така підколода")
    return deck_to_json(row) if row else None


async def delete_deck(user_id: str, deck_id: str) -> bool:
    pool = await get_pool()
    status = await pool.execute(
        "delete from decks where id = $1 and user_id = $2",
        _uuid(deck_id, "deck"), user_id,
    )
    return status.endswith("1")


# --- КАРТКИ ---

async def add_note(user_id: str, deck_id: str, note_id: str, values: dict) -> dict | None:
    pool = await get_pool()
    deck_uuid = _uuid(deck_id, "deck")
    row = await pool.fetchrow(
        """
        insert into notes (id, deck_id, guid, field_values, position)
        select $3::uuid, d.id, $3::text, $4::jsonb,
               coalesce((select count(*) from notes n2 where n2.deck_id = d.id), 0)
        from decks d
        where d.id = $1 and d.user_id = $2
        on conflict (id) do update
            set field_values = excluded.field_values, updated_at = now()
        returning id, field_values, created_at
        """,
        deck_uuid, user_id, _uuid(note_id, "card"),
        json.dumps(values or {}, ensure_ascii=False),
    )
    return note_to_json(row) if row else None


async def update_note(user_id: str, note_id: str, values: dict) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update notes n
        set field_values = $3::jsonb, updated_at = now()
        from decks d
        where n.id = $1 and n.deck_id = d.id and d.user_id = $2
        returning n.id, n.field_values, n.created_at
        """,
        _uuid(note_id, "card"), user_id,
        json.dumps(values or {}, ensure_ascii=False),
    )
    return note_to_json(row) if row else None


async def delete_note(user_id: str, note_id: str) -> bool:
    pool = await get_pool()
    status = await pool.execute(
        """
        delete from notes n using decks d
        where n.id = $1 and n.deck_id = d.id and d.user_id = $2
        """,
        _uuid(note_id, "card"), user_id,
    )
    return status.endswith("1")


async def replace_notes(user_id: str, deck_id: str, cards: list[dict]) -> dict | None:
    """Повна заміна карток колоди однією транзакцією.

    Сценарій повторного .apkg-імпорту: Anki очікує, що колода буде
    саме такою. Якщо видалення і вставка йшли б окремими запитами,
    збій посередині лишив би колоду без карток — а користувач побачив
    б порожню колоду замість своїх даних.
    """
    pool = await get_pool()
    deck_uuid = _uuid(deck_id, "deck")
    async with pool.acquire() as conn:
        async with conn.transaction():
            owned = await conn.fetchval(
                "select 1 from decks where id = $1 and user_id = $2", deck_uuid, user_id
            )
            if not owned:
                return None

            await conn.execute("delete from notes where deck_id = $1", deck_uuid)
            for position, card in enumerate(cards or []):
                await conn.execute(
                    """
                    insert into notes (id, deck_id, guid, field_values, position)
                    values ($1::uuid, $2, $1::text, $3::jsonb, $4)
                    on conflict (id) do update
                        set field_values = excluded.field_values,
                            position = excluded.position,
                            updated_at = now()
                    """,
                    _uuid(card["id"], "card"), deck_uuid,
                    json.dumps(card.get("values") or {}, ensure_ascii=False), position,
                )

    notes = await pool.fetch(
        "select id, field_values, created_at from notes where deck_id = $1 order by position, created_at",
        deck_uuid,
    )
    return {"cards": [note_to_json(n) for n in notes]}


async def delete_notes_of_deck(user_id: str, deck_id: str) -> int:
    """Видаляє всі картки колоди, не торкаючись самої колоди.

    Повертає кількість видалених рядків. Колода, її поля, CSS і шаблони
    лишаються на місці — саме це й потрібно для «очистити колоду».
    """
    pool = await get_pool()
    status = await pool.execute(
        """
        delete from notes n using decks d
        where n.deck_id = d.id and d.id = $1 and d.user_id = $2
        """,
        _uuid(deck_id, "deck"), user_id,
    )
    try:
        return int(status.split()[-1])
    except ValueError:
        return 0


def _uuid(value: str, what: str):
    import uuid as _uuid_mod
    try:
        return _uuid_mod.UUID(str(value))
    except (TypeError, ValueError):
        # Нехай буде 422, а не 500: клієнт надіслав не те, що очікували.
        raise HTTPException(status_code=422, detail=f"Невірний {what} id: {value!r}")
