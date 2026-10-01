"""Перед деплоєм: що саме потрапить у репозиторій і чи немає там секретів.

.gitignore ми не застосовуємо через git (репозиторію ще немає) — правила
переносимо вручну з того самого файлу, щоб перевірка була чесною, а не
«усе чисто, бо нічого не читала».
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ті самі правила, що в .gitignore.
IGNORE_DIRS = {'venv', 'node_modules', '__pycache__', '.vscode', '.idea', '.git', 'test-results'}
IGNORE_EXT = {'.pyc', '.apkg', '.anki2'}
IGNORE_FILES = {'.env'}

# Шаблони, за якими шукаємо секрети в файлах, що йдуть у коміт.
SECRET_PATTERNS = [
    (r'AIza[0-9A-Za-z_\-]{35}', 'ключ Gemini (префікс AIza)'),
    (r'sk-[A-Za-z0-9]{20,}', 'відкритий ключ у стилі OpenAI'),
    (r'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.', 'JWT'),
    (r'postgres(ql)?://[^\s\'"]+:[^\s\'"]+@', 'рядок підключення з паролем'),
    (r'supabase\.co', 'домен Supabase'),
    (r'sb_[A-Za-z0-9_\-]{20,}', 'service_role ключ Supabase'),
]
# Рядки, де секрет — це нормально: там лише назви змінних і порожні значення.
ALLOW = re.compile(r'sync:\s*false|key:\s*[A-Z_]+$|^\s*#')

files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
    for name in filenames:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, ROOT)
        if name in IGNORE_FILES or os.path.splitext(name)[1] in IGNORE_EXT:
            continue
        if any(part in IGNORE_DIRS for part in rel.split(os.sep)):
            continue
        files.append(rel.replace('\\', '/'))

files.sort()
print(f'У коміт піде {len(files)} файлів:\n')
for rel in files:
    size = os.path.getsize(os.path.join(ROOT, rel))
    print(f'  {size:>8,}  {rel}')

print('\n=== Пошук секретів ===')
problems = 0
for rel in files:
    path = os.path.join(ROOT, rel)
    try:
        text = io.open(path, encoding='utf-8', errors='replace').read()
    except OSError as exc:
        print(f'  не прочитано: {rel}: {exc}')
        continue
    for number, line in enumerate(text.split('\n'), 1):
        if ALLOW.search(line):
            continue
        for pattern, label in SECRET_PATTERNS:
            for hit in re.findall(pattern, line):
                problems += 1
                print(f'  ЗНАЙДЕНО {label}: {rel}:{number}')
                print(f'    {hit[:40]}...<обрізано>')
                break

print(f'\nвисновок: {problems} збігів' if problems
      else '\nвисновок: секретів у файлах коміту немає')

# Окремо: .env не комітиться, але перевіримо, що він усе одно не протече
# через .env.example (там мають бути лише порожні значення).
example = io.open(os.path.join(ROOT, '.env.example'), encoding='utf-8').read()
leaks = [l for l in example.split('\n')
         if re.match(r'^[A-Z_]+=\s*\S', l) and '://' not in l]
print(f'.env.example: {len(leaks)} рядків із непорожнім значенням '
      f'(без URL-ів — тобто ключів)' if leaks else '.env.example: усі значення порожні')

sys.exit(1 if problems else 0)
