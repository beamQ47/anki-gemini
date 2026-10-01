"""
Стабільні Anki ID.

Чому це окремий модуль, а не функція в main.py: той самий алгоритм
має бути в js/model.js, щоб локальний .apkg (без сервера) і серверний
експорт давали однакові ID. Спільна реалізація — єдина можливість
перевірити, що вони не розійшлися: test/test_ids.py звіряє обидва
проти спільних тестових векторів.

Головне правило: жоден ID не залежить від назви колоди, номера картки
або її вмісту. Інакше перейменування колоди чи редагування питання
створює в Anki нову картку замість оновлення — і колода розмножується.
"""

import hashlib
import re

# Anki зберігає id як 64-бітне ціле. Реальні Anki-id — це,~10 цифр
# (від мілісекундної епохи). Тримаємось того ж діапазону: це вкладається
# в bigint, не виглядає підозріло в TSV і не зіткнеться з майбутніми
# обмеженнями Anki.
_ID_MIN = 1_000_000_000
_ID_SPAN = 9_000_000_000

_UUID_RE = re.compile(
    r"^\{?([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?"
    r"([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})\}?$"
)


class InvalidIdError(ValueError):
    """ID не схожий на UUID. Краще явна помилка, ніж тихий hash від рядка."""


def normalize_uuid(value: str) -> str:
    """Будь-який запис UUID -> канонічний рядок з дефісами, нижній регістр.

    Приймаємо 'deck-<uuid>', '{<uuid>}' і голу hex — міграція старих
    даних має бути терплячою, а не вимагати ручного чищення.
    """
    if not isinstance(value, str):
        raise InvalidIdError(f"ID має бути рядком, отримано {type(value).__name__}")

    text = value.strip()
    # Знімаємо старий префікс на кшталт 'card-'/'deck-'.
    if "-" in text and not _UUID_RE.match(text):
        _, _, tail = text.partition("-")
        if _UUID_RE.match(tail):
            text = tail

    match = _UUID_RE.match(text)
    if not match:
        raise InvalidIdError(f"Не схоже на UUID: {value!r}")
    return "-".join(match.groups()).lower()


def stable_anki_id(uuid_value: str, salt: str) -> int:
    """Детермінований 10-значний Anki-id із UUID.

    salt розділяє простори: deck-id і model-id виходять різними навіть
    для одного UUID, а колоди з однаковими назвами не зливаються.
    """
    canonical = normalize_uuid(uuid_value)
    digest = hashlib.sha256(f"{salt}:{canonical}".encode("utf-8")).digest()
    return _ID_MIN + (int.from_bytes(digest[:8], "big") % _ID_SPAN)


def deck_anki_id(deck_uuid: str) -> int:
    return stable_anki_id(deck_uuid, "deck")


def model_anki_id(deck_uuid: str) -> int:
    return stable_anki_id(deck_uuid, "model")


def model_name_for(deck_uuid: str) -> str:
    """Назвa моделі без пробілів, стабільна для колоди.

    Anki не любить пробіли в іменах моделей, а назва колоди може їх
    містити — тому беремо з UUID, а не з title.
    """
    return "Model_" + normalize_uuid(deck_uuid).replace("-", "")[:8]


def note_guid(note_uuid: str) -> str:
    """GUID нотатки = власний UUID нотатки.

    Найпростіше рішення, яке важко зламати: GUID не обчислюється ні з
    чого, а значить не може випадково залежати від вмісту. Унікальність
    гарантує UNIQUE (deck_id, guid) у схемі БД.
    """
    return normalize_uuid(note_uuid)
