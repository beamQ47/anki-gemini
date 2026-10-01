-- Міграція: унікальність назв серед СУСІДІВ для всіх станів.
--
-- Застосувати: psql "$DATABASE_URL" -f db/migrations/20260928_deck_sibling_title.sql
--
-- Навіщо. Раніше індекс був частковим і без user_id:
--
--   CREATE UNIQUE INDEX decks_sibling_title_idx
--       ON decks (COALESCE(parent_id, '000...'), lower(title))
--       WHERE state = 'published';
--
-- Дві проблеми, обидві через те, що state ніколи не стає 'published'
-- (публікації в застосунку немає):
--
-- 1. WHERE state = 'published' робив індекс мертвим. Дві чернетки-"Лекція 1"
--    під одним батьком проходили без помилки — а далі експорт давав їм
--    однаковий шлях "університет::математика::Лекція 1", і в Anki їхні
--    картки опинялися б в одній колоді. Вкладеність у нас будується з
--    назв, тому однакові сусідські назви — це не косметика, а втрата даних.
--
-- 2. Без user_id індекс був наскрізним. COALESCE(parent_id, '000...') однаковий
--    для кореня в кого завгодно, тому колода "Моя колода" (дефолтна назва)
--    одного користувача робила б таку саму назву в іншого користувача
--    нестворенною.

BEGIN;

-- Обережно: індекс не накладає жодних обмежень на дані, лише відмовляє
-- в майбутніх записах, тож перед створенням перевіряємо, чи є нащадки,
-- які не дадуть створити унікальний індекс.
DO $$
DECLARE
    clashes int;
BEGIN
    SELECT count(*) INTO clashes FROM (
        SELECT 1 FROM public.decks
        GROUP BY user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(title)
        HAVING count(*) > 1
    ) d;
    IF clashes > 0 THEN RAISE EXCEPTION
        'Є % груп дублікатів серед сусідів. Перейменуй їх перед застосуванням міграції.', clashes;
    END IF;
END $$;

DROP INDEX IF EXISTS public.decks_sibling_title_idx;

-- user_id у першій позиції: і унікальність, і найкраще для запитів виду
-- "усі колоди користувача", які є майже в кожному запиті.
CREATE UNIQUE INDEX decks_sibling_title_idx
    ON public.decks (user_id,
                     COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     lower(title));

COMMIT;
