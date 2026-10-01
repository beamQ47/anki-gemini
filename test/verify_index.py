"""Перевірка індексу перед комітом: що реально піде в репозиторій.

На відміну від preflight_deploy.py, який покладається на власний список
виключень, тут джерело істини — сам git: перевіряється те, що вже
застейджено. Тобто якщо .gitignore раптом перестане працювати, помилка
вискочить тут, а не після пуша.
"""
import re
import subprocess
import sys

RUN = ['git', '-C', r'E:\learning\projects\anki-telegram-bot']


def git(*args, binary=False):
    out = subprocess.run(RUN + list(args), capture_output=True, check=True).stdout
    return out if binary else out.decode('utf-8', 'replace')


# --diff-filter=d прибирає видалені файли: 'git show :path' для них падає,
# бо їх більше немає в індексі. Перевіряти треба лише те, що реально додається.
staged = [p for p in git('diff', '--cached', '--name-only', '--diff-filter=d').split('\n') if p]
deleted = [p for p in git('diff', '--cached', '--name-only', '--diff-filter=D').split('\n') if p]
print(f'staged files: {len(staged)}' + (f' (+{len(deleted)} deleted)' if deleted else ''))

# 1. Жоден файл із Secrets не повинен бути в індексі.
FORBIDDEN = {'.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'}
leaked = [p for p in staged if p in FORBIDDEN or p.startswith('.env')
          and p != '.env.example']
print(f'1. заборонені файли в індексі: {leaked or "немає"}')

# 2. Вміст застейдженого — саме він потрапить у коміт, а не те, що лежить
#    на диску: .env міг бути змінений після add, тож перевіряємо index.
PATTERNS = [
    (rb'AIza[0-9A-Za-z_\-]{35}', 'gemini-key'),
    (rb'eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}', 'jwt-anon-key'),
    (rb'postgres(ql)?://[^\s\'"]+:[^\s\'"]+@', 'pg-url-with-password'),
]
# .env.example — це документація: там рядки з паролем записані як
# postgresql://postgres.<проєкт>:<пароль>@..., і регулярка вважала би
# «<пароль>» паролем. Кутові дужки — плейсхолдери, а не секрети.
PLACEHOLDER = re.compile(rb'<[^>\n]{1,60}>')
COMMENT_LINE = re.compile(rb'^\s*#')


def scrub(blob):
    """Прибирає коментарі та кутові плейсхолдери, лишаючи лише реальні значення."""
    lines = [l for l in blob.split(b'\n') if not COMMENT_LINE.match(l)]
    return PLACEHOLDER.sub(b'<...>', b'\n'.join(lines))


hits = []
for path in staged:
    blob = scrub(git('show', f':{path}', binary=True))
    for pattern, label in PATTERNS:
        if re.search(pattern, blob):
            hits.append(f'{label} -> {path}')
print(f'2. secrets in staged content: {hits or "none"}')

# 3. Переконуємось, що в історії гілки немає чужих комітів: так видно,
#    що ми не причепилися до чужого репозиторію. Після першого коміту
#    історія зростає — це нормально, тож перевіряємо авторів, а не кількість.
authors = git('log', '--format=%ae').split()
mine = git('config', 'user.email').strip()
foreign = sorted({a for a in authors if a != mine})
print(f'3. commits: {len(authors)}, foreign authors: {foreign or "none"}')

bad = bool(leaked or hits or foreign)
print('\nVERDICT:', 'STOP - something to fix' if bad else 'safe to commit')
sys.exit(1 if bad else 0)
