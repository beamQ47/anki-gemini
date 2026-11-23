// Вхід у Supabase Auth і робота з токеном.
//
// Зроблено на прямі виклики REST замість supabase-js: не треба тягнути
// CDN-бібліотеку, немає ризику розбіжності версій, а код лишається
// таким самим плоским fetch, як решта застосунку. Файл підключений
// як звичайний скрипт — разом з іншими, без модульної системи.
//
// Що тут неочевидного:
//  * refresh_token не одноразовий, тож зберігаємо обидва токени;
//    access-токен живе близько години, і без refresh сесія просто
//    відвалилася б посеред роботи.
//  * поновлення робиться заздалегідь, за хвилину до кінця дії
//    токена, інакше запит міг би впасти з 401.
//  * паралельні запити не плодять купу оновлень: усі чекають на
//    одне й те саме Promise.

window.AnkiAuth = (function () {
  const TOKEN_KEY = 'anki.auth.session';
  const REFRESH_MARGIN_MS = 60 * 1000;

  let configPromise = null;
  let refreshPromise = null;
  let onSessionLost = null;

  function storage() {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (err) {
      return null;
    }
  }

  function getSession() {
    const store = storage();
    if (!store) return null;
    try {
      const parsed = JSON.parse(store.getItem(TOKEN_KEY) || 'null');
      return parsed && parsed.accessToken ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function saveSession(session) {
    const store = storage();
    if (!store) return;
    try {
      if (session) store.setItem(TOKEN_KEY, JSON.stringify(session));
      else store.removeItem(TOKEN_KEY);
    } catch (err) {
      /* приватний режим браузера — сесія живе до перезавантаження */
    }
  }

  function setSessionLostHandler(handler) {
    onSessionLost = typeof handler === 'function' ? handler : null;
  }

  function getConfig() {
    if (!configPromise) {
      const configUrl = typeof window !== 'undefined' && typeof window.getApiUrl === 'function'
        ? window.getApiUrl('/api/config')
        : (typeof getApiUrl === 'function' ? getApiUrl('/api/config') : '/api/config');
      configPromise = fetch(configUrl, { headers: { Accept: 'application/json' } })
        .then((response) => {
          if (!response.ok) throw new Error('Не вдалося отримати конфігурацію');
          return response.json();
        })
        .catch((error) => {
          // Помилку не кешуємо: інакше після разової невдачі
          // сторінка назавжди залишилася б без anon-ключа.
          configPromise = null;
          throw error;
        });
    }
    return configPromise;
  }

  function authRequest(path, body, token) {
    return getConfig().then((config) => {
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('Сервер не налаштований на вхід у Supabase');
      }
      const headers = {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      return fetch(`${config.supabaseUrl}/auth/v1${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }).then((response) =>
        response.json()
          .catch(() => ({}))
          .then((data) => {
            if (!response.ok) {
              throw new Error(
                data.error_description || data.msg || data.message || 'Не вдалося увійти'
              );
            }
            return data;
          })
      );
    });
  }

  function toSession(data) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      userId: data.user ? data.user.id : null,
      email: data.user ? data.user.email : null
    };
  }

  function signIn(email, password) {
    return authRequest('/token?grant_type=password', { email, password })
      .then((data) => {
        const session = toSession(data);
        saveSession(session);
        return session;
      });
  }

  function signOut() {
    saveSession(null);
  }

  // Повертає діючий access-токен, оновлюючи його за потреби.
  function getAccessToken() {
    const session = getSession();
    if (!session) return Promise.resolve(null);

    if (Date.now() < session.expiresAt - REFRESH_MARGIN_MS) {
      return Promise.resolve(session.accessToken);
    }
    if (!session.refreshToken) {
      signOut();
      if (onSessionLost) onSessionLost();
      return Promise.resolve(null);
    }

    if (!refreshPromise) {
      refreshPromise = authRequest(
        '/token?grant_type=refresh_token',
        { refresh_token: session.refreshToken }
      )
        .then((data) => {
          const next = toSession(data);
          saveSession(next);
          return next.accessToken;
        })
        .catch((error) => {
          // refresh-токен протерміновано або відкликано —
          // сесію можна вважати завершеною.
          saveSession(null);
          if (onSessionLost) onSessionLost();
          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    return refreshPromise;
  }

  function signOutRemotely() {
    const session = getSession();
    saveSession(null);
    if (!session || !session.accessToken) return Promise.resolve();
    return authRequest('/logout', {}, session.accessToken).catch(() => {
      /* локально вже вийшли — відповідь сервера не важлива */
    });
  }

  return {
    getSession,
    getConfig,
    signIn,
    signOut,
    signOutRemotely,
    getAccessToken,
    setSessionLostHandler
  };
})();
