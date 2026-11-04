-- Схема БД для anki-telegram-bot (Supabase / PostgreSQL)
-- Застосувати: psql "$DATABASE_URL" -f db/schema.sql
--
-- Ключові рішення:
--   * decks.field_names — jsonb МАСИВ, а не об'єкт. jsonb не зберігає порядок
--     ключів об'єкта, а порядок полів у Anki = порядок колонок. Масив зберігає.
--   * notes.field_values — jsonb об'єкт "ім'я поля" -> значення. Порядок ключів
--     тут неважливий, бо доступ завжди йде за ім'ям.
--   * ЗАВЖДИ порядок колонок бери з decks.field_names, ніколи з keys(field_values).
--   * anki_deck_id / anki_model_id — стабільні, глобально унікальні. Ніколи не
--     хеш від назви колоди: перейменування колоди створило б нову колоду в Anki,
--     а однакова назва у двох юзерів злипла б в одну.
--   * published_at — щоб рахувати diff "що змінилося з часу імпорту".

BEGIN;

DROP TABLE IF EXISTS public.notes CASCADE;
DROP TABLE IF EXISTS public.cards CASCADE;
DROP TABLE IF EXISTS public.decks CASCADE;
DROP TABLE IF EXISTS public.styles CASCADE;

-- ---------------------------------------------------------------- styles
-- Бібліотека стилів на рівні акаунта. Стиль не належить колоді: одну
-- тему можна застосувати до будь-якої колоди й обрати для генерації.
CREATE TABLE public.styles (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name       text        NOT NULL DEFAULT 'Стиль',
    css        text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX styles_user_name_idx
    ON public.styles (user_id, lower(name));
CREATE INDEX styles_user_updated_idx
    ON public.styles (user_id, updated_at DESC);

-- ---------------------------------------------------------------- decks
CREATE TABLE public.decks (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_id     uuid        REFERENCES public.decks(id) ON DELETE CASCADE,
    -- Активний стиль колоди. NULL — стиль не вибрано; css нижче лишається
    -- знімком, щоб .apkg не залежав від наявності рядка в бібліотеці.
    style_id      uuid        REFERENCES public.styles(id) ON DELETE SET NULL,

    title         text        NOT NULL DEFAULT 'Моя колода',
    state         text        NOT NULL DEFAULT 'draft'
                              CHECK (state IN ('draft', 'published')),

    -- Нота-тип і колода в Anki
    anki_deck_id  bigint      UNIQUE,
    anki_model_id bigint      UNIQUE,
    model_name    text        NOT NULL DEFAULT '',

    -- Структура карток
    field_names   jsonb       NOT NULL DEFAULT '[]'::jsonb
                              CHECK (jsonb_typeof(field_names) = 'array'),
    css           text        NOT NULL DEFAULT '',
    templates     jsonb       NOT NULL DEFAULT '[]'::jsonb
                              CHECK (jsonb_typeof(templates) = 'array'),

    -- Бібліотека іменованих стилів: {"activeId": "...", "items": [{"id","name","css"}]}.
    -- Один стиль = один CSS на всі поля картки. Об'єктом, а не масивом,
    -- щоб активний стиль не довелось окремо зберігати в ще одній колонці:
    -- інакше їх можна було б розвести (активний не з бібліотеки), а
    -- колода зберігається одним запитом.
    styles        jsonb       NOT NULL DEFAULT '{"activeId": "", "items": []}'::jsonb
                              CHECK (jsonb_typeof(styles) = 'object'),

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    published_at  timestamptz
);

-- Ієрархія: "НПЗІБ" -> "Лекція 1", "Лекція 2"
CREATE INDEX decks_user_id_idx  ON public.decks (user_id);
CREATE INDEX decks_parent_id_idx ON public.decks (parent_id);
CREATE INDEX decks_state_idx     ON public.decks (user_id, state);
CREATE INDEX decks_style_id_idx  ON public.decks (style_id);

-- Один користувач не має двох колод з однаковим заголовком усередині однієї
-- батьківської гілки. Без user_id індекс був би наскрізним: COALESCE(parent_id,
-- '000...') однаковий для кореня в кого завгодно, тож колода "Моя колода"
-- одного користувача робила б таку саму в іншого нестворенною. Обмеження
-- діє на всі стани, а не лише на 'published': вкладеність будується з назв,
-- тому дві однакові сестри дали б однаковий шлях "A::B::Лекція 1" і в Anki
-- їхні картки злиплися б в одну колоду.
CREATE UNIQUE INDEX decks_sibling_title_idx
    ON public.decks (user_id,
                     COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     lower(title));

-- ---------------------------------------------------------------- notes
CREATE TABLE public.notes (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id      uuid        NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,

    -- Стабільний GUID. Саме він робить повторний імпорт оновленням,
    -- а не створенням дублікатів. Ніколи не рахувати з вмісту картки.
    guid         text        NOT NULL,

    field_values jsonb       NOT NULL DEFAULT '{}'::jsonb
                             CHECK (jsonb_typeof(field_values) = 'object'),

    position     integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (deck_id, guid)
);

CREATE INDEX notes_deck_id_idx ON public.notes (deck_id);
CREATE INDEX notes_updated_idx ON public.notes (deck_id, updated_at DESC);

-- ---------------------------------------------------------------- тригери
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- CHECK-обмеження не вміють підзапити, тому глибоку перевірку робимо тригером.
CREATE OR REPLACE FUNCTION public.validate_deck_model()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    bad jsonb;
BEGIN
    SELECT e INTO bad
    FROM jsonb_array_elements(NEW.field_names) e
    WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = ''
    LIMIT 1;

    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'field_names мусить бути масивом непорожніх рядків, знайдено: %', bad
            USING ERRCODE = 'check_violation';
    END IF;

    IF jsonb_typeof(NEW.templates) <> 'array' THEN
        RAISE EXCEPTION 'templates мусить бути масивом' USING ERRCODE = 'check_violation';
    END IF;

    -- styles: об'єкт із двома полями, items — масив об'єктів з id/name/css.
    IF jsonb_typeof(NEW.styles) <> 'object' THEN
        RAISE EXCEPTION 'styles мусить бути об''єктом, знайдено: %', jsonb_typeof(NEW.styles)
            USING ERRCODE = 'check_violation';
    END IF;

    IF jsonb_typeof(COALESCE(NEW.styles->'items', 'null'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'styles.items мусить бути масивом'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT e INTO bad
    FROM jsonb_array_elements(NEW.styles->'items') e
    WHERE jsonb_typeof(e) <> 'object'
       OR jsonb_typeof(e->'id') <> 'string'
       OR btrim(e->>'id') = ''
       OR jsonb_typeof(e->'css') <> 'string'
    LIMIT 1;

    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'стиль без id або css: %', bad
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER decks_validate BEFORE INSERT OR UPDATE ON public.decks
    FOR EACH ROW EXECUTE FUNCTION public.validate_deck_model();

CREATE TRIGGER decks_touch BEFORE UPDATE ON public.decks
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER notes_touch BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER styles_touch BEFORE UPDATE ON public.styles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
-- anon не має жодних прав: бот ходить у базу через service_role, тому
-- ключ anon у фронтенді не повинен нічого вміти. RLS нижче — другий рівень.

REVOKE ALL ON public.decks FROM anon;
REVOKE ALL ON public.notes FROM anon;
REVOKE ALL ON public.styles FROM anon;
REVOKE ALL ON public.decks FROM authenticated;
REVOKE ALL ON public.notes FROM authenticated;
REVOKE ALL ON public.styles FROM authenticated;

ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY decks_own ON public.decks
    FOR ALL
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY styles_own ON public.styles
    FOR ALL
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- notes належать юзеру через колоду
CREATE POLICY notes_own ON public.notes
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.decks d
                WHERE d.id = notes.deck_id AND d.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.decks d
                WHERE d.id = notes.deck_id AND d.user_id = auth.uid())
    );

COMMIT;
