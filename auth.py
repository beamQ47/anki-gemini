"""
Автентифікація запитів через Supabase Auth.

Токени перевіряються запитом до Supabase, а не локально.
Спокуса зробити інакше велика: anon-ключ — це теж HS256-JWT, і
здається, що можна перевіряти підпис без мережі. Не вийде:
підпис anon-ключа і JWT_SECRET, яким підписуються user-токени, —
різні речі. Перевірено: HMAC з підписом anon-ключа не збігається
з підписом самого anon-ключа. Тому єдине надійне джерело істини —
Supabase.

Що саме перевіряється:
  - схема заголовка "Bearer <токен>"
  - Supabase погоджується, що токен реальний і не прострочений
  - у відповіді є id — з нього береться user_id

user_id береться ТІЛЬКИ з відповіді Supabase. Ніколи з тіла
запиту — інакше можна було б записати в чужу колоду, просто
підставивши інший id у JSON.

Кеш відповідей на 60 секунд: без нього кожен запит платив би
мережевий round-trip. Це не послаблює захист — access-токен і так
лишається дійсним до свого exp, з кешем чи без.
"""

import asyncio
import hashlib
import os
import time
import uuid

import httpx
from fastapi import Header, HTTPException

CACHE_TTL = 60.0
ALLOWED_ROLES = {"authenticated"}


class AuthError(HTTPException):
    """401 із правильним WWW-Authenticate, щоб клієнт знав, що треба оновити токен."""

    def __init__(self, detail: str = "Потрібна автентифікація"):
        super().__init__(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def supabase_url() -> str:
    # Читаємо очікувано, а не на імпорті: main.py викликає
    # load_dotenv() після того, як уже імпортував auth. Значення,
    # прочитані на імпорті, були б порожніми.
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _anon_key() -> str:
    return os.getenv("SUPABASE_ANON_KEY", "")


_cache: dict[str, tuple[str, float]] = {}
_http_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client, _client_loop
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if _http_client is not None and (_http_client.is_closed or _client_loop is not current_loop):
        _http_client = None

    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
        _client_loop = current_loop
    return _http_client


async def close_http_client():
    global _http_client, _client_loop
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None
        _client_loop = None


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise AuthError("Заголовок Authorization відсутній")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Очікується заголовок виду 'Bearer <токен>'")
    return token.strip()


def _cache_key(token: str) -> str:
    # У пам'яті тримаємо хеш, а не сам токен.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def fetch_user(token: str) -> dict | None:
    """Питає Supabase, хто стоїть за токеном. None — токен не прийнятий."""
    url, key = supabase_url(), _anon_key()
    if not url or not key:
        raise AuthError("Сервер не налаштований: немає SUPABASE_URL або SUPABASE_ANON_KEY")

    try:
        client = _get_http_client()
        response = await client.get(
            f"{url}/auth/v1/user",
            headers={"apikey": key, "Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError as exc:
        # Supabase недоступний — це не вина клієнта, і 401 тут
        # змусив би його викинути сесію через тимчасовий збій.
        raise HTTPException(status_code=503, detail=f"Сервер автентифікації недоступний: {exc}")

    if response.status_code in (401, 403, 404):
        return None
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="Помилка перевірки токена")

    return response.json()


async def current_user_id(authorization: str | None = Header(default=None)) -> str:
    """FastAPI-залежність: повертає UUID автора запиту."""
    token = _extract_bearer(authorization)
    key = _cache_key(token)

    cached = _cache.get(key)
    if cached and cached[1] > time.time():
        return cached[0]

    user = await fetch_user(token)
    if not user:
        raise AuthError("Токен недійсний або прострочений — увійди знову")

    raw_id = user.get("id")
    try:
        user_id = str(uuid.UUID(str(raw_id)))
    except (TypeError, ValueError):
        raise AuthError("Supabase повернув некоректний id користувача")

    if user.get("role") and user.get("role") not in ALLOWED_ROLES:
        raise AuthError("Токен не має ролі користувача")

    _cache[key] = (user_id, time.time() + CACHE_TTL)
    return user_id


def clear_cache() -> None:
    _cache.clear()
