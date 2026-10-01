-- Що додає: іменовані стилі колоди — бібліотеку стилів, яку видно
-- у вікні стилів і з якої обирається активний.
--
-- Застосувати: psql "$DATABASE_URL" -f db/migrations/20260928_deck_styles.sql
--
-- До цієї міграції колода мала одну колонку css — поточний стиль.
-- Тепер css лишається тим самим (активний стиль, він і їде в .apkg),
-- а поряд з ним з'являється бібліотека styles, щоб стилі можна було
-- називати, перейменовувати, обирати й видаляти, не затираючи одне
-- одного.
--
-- Що саме зміниться:
--
-- 1. Додається колонка decks.styles jsonb NOT NULL за замовчуванням
--    '{"activeId": "", "items": []}'.
--
-- 2. Бекфіл: у колоди, де css не порожній, а бібліотеки ще немає,
--    заводиться стиль «Основний» і робиться активним. Інакше стара
--    колода лишилася б без стилів, а її CSS — поза бібліотекою: у
--    вікні стилів було б порожньо, хоча колода стилізована.
--    'main' як id — навмисно: id стилю це лише ключ у jsonb, не uuid
--    і не зв'язок з іншими таблицями.
--
-- 3. Оновлюється тригер decks_validate: тепер він перевіряє ще й
--    styles, щоб у базу не потрапив styles без items або з елементом
--    без id — інакше фронтенд показав би порожній або «NA» стиль.

BEGIN;

ALTER TABLE public.decks
    ADD COLUMN IF NOT EXISTS styles jsonb NOT NULL
        DEFAULT '{"activeId": "", "items": []}'::jsonb;

UPDATE public.decks
   SET styles = jsonb_build_object(
           'activeId', 'main',
           'items', jsonb_build_array(
               jsonb_build_object('id', 'main', 'name', 'Основний', 'css', css)
           )
       )
 WHERE btrim(css) <> ''
   AND jsonb_array_length(COALESCE(styles->'items', '[]'::jsonb)) = 0;

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

-- create or replace вже оновив тіло функції, але тригер посилається на
-- неї за іменем і сам не змінюється.

COMMIT;
