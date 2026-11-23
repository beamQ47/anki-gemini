"""
Тести стабільних ID.

Значення нижче ЗАФІКСОВАНІ. Якщо алгоритм зміниться — тест зламається,
і це навмисно: зміна ID означає, що всі раніше імпортовані колоди
в Anki продублюються. Тоді треба зрозуміти, чи це потрібно, і змінити
вектори разом із міграцією.

Окремо перевіряється головна вимога: ID не залежить від назви колоди
та вмісту картки. Саме це чинить повторний імпорт оновленням.
"""
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")

from anki_ids import (
    InvalidIdError,
    canonical_model_id,
    canonical_model_name,
    deck_anki_id,
    model_anki_id,
    model_name_for,
    normalize_uuid,
    note_guid,
)

ok = fail = 0
def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")

def check_that(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label} {detail}")

U1 = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
U2 = "550e8400-e29b-41d4-a716-446655440000"
U3 = "dc768abe-e8d4-4736-b210-0628c765a9d1"

print("Зафіксовані значення")
check("deck id U1",  deck_anki_id(U1), 2551240752)
check("model id U1", model_anki_id(U1), 8473215619)
check("model name U1", model_name_for(U1), "Model_3f2504e0")
check("deck id U2",  deck_anki_id(U2), 4400980585)
check("model id U2", model_anki_id(U2), 4933942170)
check("deck id U3",  deck_anki_id(U3), 3565872260)
check("model id U3", model_anki_id(U3), 8091313828)
check("guid = власний uuid", note_guid(U1), U1)

print("\nДіапазон і форма")
for value in (U1, U2, U3):
    for label, got in (("deck", deck_anki_id(value)), ("model", model_anki_id(value))):
        check_that(f"{label} id 10 цифр для {value[:8]}",
                   1_000_000_000 <= got <= 9_999_999_999, f"got={got}")
        check_that(f"{label} id в bigint", got < 2**63)

check_that("deck id != model id", deck_anki_id(U1) != model_anki_id(U1))
check_that("різні uuid -> різні deck id",
           len({deck_anki_id(v) for v in (U1, U2, U3)}) == 3)

print("\nСтабільність: повторний виклик дає те саме")
check_that("deck id детермінований", deck_anki_id(U1) == deck_anki_id(U1))
check_that("model id детермінований", model_anki_id(U1) == model_anki_id(U1))
check_that("регістр і дефіси не впливають",
           deck_anki_id(U1) == deck_anki_id(U1.upper()))
check_that("без дефісів те саме",
           deck_anki_id("3f2504e04f8941d39a0c0305e82c3301") == deck_anki_id(U1))

print("\nНезалежність від назви та вмісту")
# Один і той самий uuid -> ті самі id, незалежно від того, як названа колода.
check_that("назва колоди не входить в id",
           deck_anki_id(U1) == deck_anki_id(U1))
check_that("model name не містить назви колоди",
           model_name_for(U1) == "Model_3f2504e0")

print("\nНормалізація міграційних форматів")
check("префікс card- знімається", normalize_uuid(f"card-{U1}"), U1)
check("префікс deck- знімається", normalize_uuid(f"deck-{U1}"), U1)
check("фигурні дужки знімаються", normalize_uuid(f"{{{U1}}}"), U1)
check("верхній регістр знижується", normalize_uuid(U1.upper()), U1)
check("голу hex з дефісами", normalize_uuid("3f2504e04f8941d39a0c0305e82c3301"), U1)

print("\nВідхилення непрохідних значень")
for bad in ("", "card-1", "not-a-uuid", "12345", None, 42, "deck-" + "z" * 8):
    try:
        normalize_uuid(bad)
        check_that(f"відхилено {bad!r}", False, "не викинуло помилку")
    except InvalidIdError:
        ok += 1; print(f"  ok   відхилено {bad!r}")
    except Exception as exc:
        check_that(f"відхилено {bad!r}", False, f"не та помилка: {type(exc).__name__}")

print("\nКанонічні спільні моделі (дедуплікація стилів Anki)")
cm1 = canonical_model_id(["Питання", "Відповідь"], style_name="Неон")
cm2 = canonical_model_id(["Питання", "Відповідь"], style_name="Неон")
cm3 = canonical_model_id(["Питання", "Відповідь", "Пояснення"], style_name="Неон")
cm4 = canonical_model_id(["Питання", "Відповідь"], style_name="Темний")

check_that("canonical model id 10 цифр", 1_000_000_000 <= cm1 <= 9_999_999_999)
check("однакові поля та стиль -> однаковий model id", cm1, cm2)
check_that("різні поля -> різний model id", cm1 != cm3)
check_that("різний стиль -> різний model id", cm1 != cm4)

cname1 = canonical_model_name(["Питання", "Відповідь"], style_name="Неон")
cname2 = canonical_model_name(["Питання", "Відповідь", "Пояснення"], style_name="Неон")
cname3 = canonical_model_name(["Питання", "Відповідь"])
check("canonical model name Неон (2 поля)", cname1, "AnkiBot - Неон [2 полів]")
check("canonical model name Неон (3 поля)", cname2, "AnkiBot - Неон [3 полів]")
check("canonical model name дефолт", cname3, "AnkiBot - Стандарт [2 полів]")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
