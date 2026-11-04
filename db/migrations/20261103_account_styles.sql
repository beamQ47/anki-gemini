-- Що додає: бібліотеку стилів на рівні акаунта.
--
-- Застосувати: venv\Scripts\python.exe db\migrate.py
--
-- До цієї міграції стилі жили всередині колоди (decks.styles jsonb).
-- Через це один і той самий стиль існував лише в одній колоді: щоб
-- застосувати його до іншої, доводилося створювати копію, а редагування
-- копії не змінювало оригінал. Тепер стиль — окремий рядок public.styles,
-- який належить користувачу, а колода лише посилається на нього.
--
-- Що саме зміниться:
--
-- 1. Створюється public.styles (id, user_id, name, css, created_at,
--    updated_at). Назва унікальна в межах користувача без урахування
--    регістру: два стилі «Темний» і «темний» у списку вибору неможливо
--    розрізнити.
--
-- 2. Колода отримує style_id. ON DELETE SET NULL — видалення стилю не
--    повинно видаляти колоду: у неї лишається знімок css, який уже
--    поїхав у .apkg.
--
-- 3. Бекфіл старих стилів із decks.styles: кожен унікальний стиль стає
--    рядком бібліотеки, а активний стиль колоди — її style_id. Без цього
--    після оновлення список стилів був би порожнім, хоча колоди вже
--    стилізовані.
--
-- 4. RLS і ті самі права, що в decks/notes: прямий доступ із anon-ключа
--    заборонено, сервер ходить роллю postgres і фільтрує WHERE user_id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.styles (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name       text        NOT NULL DEFAULT 'Стиль',
    css        text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS styles_user_name_idx
    ON public.styles (user_id, lower(name));
CREATE INDEX IF NOT EXISTS styles_user_updated_idx
    ON public.styles (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS styles_touch ON public.styles;
CREATE TRIGGER styles_touch BEFORE UPDATE ON public.styles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.decks
    ADD COLUMN IF NOT EXISTS style_id uuid
        REFERENCES public.styles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS decks_style_id_idx ON public.decks (style_id);

-- Бекфіл. Один стиль на (user_id, lower(name)); при однакових назвах
-- беремо перший — у межах акаунта це той самий стиль, і розмножувати
-- його копіями означало б знову завести те, від чого міграція йде.
WITH legacy AS (
    SELECT d.user_id,
           item->>'name' AS name,
           item->>'css'  AS css
      FROM public.decks d
      CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(d.styles->'items') = 'array'
               THEN d.styles->'items' ELSE '[]'::jsonb END
      ) AS item
     WHERE btrim(COALESCE(item->>'name', '')) <> ''
       AND btrim(COALESCE(item->>'css', '')) <> ''
), unique_style AS (
    SELECT DISTINCT ON (user_id, lower(name)) user_id, name, css
      FROM legacy
     ORDER BY user_id, lower(name), name
)
INSERT INTO public.styles (user_id, name, css)
SELECT user_id, name, css FROM unique_style
ON CONFLICT (user_id, lower(name)) DO NOTHING;

UPDATE public.decks d
   SET style_id = s.id
  FROM public.styles s
 WHERE s.user_id = d.user_id
   AND lower(s.name) = lower((
       SELECT item->>'name'
         FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.styles->'items') = 'array'
                  THEN d.styles->'items' ELSE '[]'::jsonb END
         ) AS item
        WHERE item->>'id' = d.styles->>'activeId'
        LIMIT 1
   ));

ALTER TABLE public.styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS styles_own ON public.styles;
CREATE POLICY styles_own ON public.styles
    FOR ALL
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.styles FROM anon;
REVOKE ALL ON public.styles FROM authenticated;

COMMIT;
