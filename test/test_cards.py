import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"E:\learning\projects\anki-telegram-bot")
from main import normalize_cards_for_frontend as norm

ok = fail = 0
def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1; print(f"  ok   {label}")
    else:
        fail += 1; print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")

F = ["Код", "Назва", "Приклад"]

print("вкладена форма (як у промпті)")
check("повна картка", norm({
    "model": {"fields": F},
    "cards": [{"fields": {"Код": "200", "Назва": "OK", "Приклад": "HTTP 200"}}],
}), [{"Код": "200", "Назва": "OK", "Приклад": "HTTP 200"}])

print("\nвкладена, друга картка неповна")
check("пропущені поля порожні", norm({
    "model": {"fields": F},
    "cards": [{"fields": {"Код": "404", "Назва": "NF"}}],
}), [{"Код": "404", "Назва": "NF", "Приклад": ""}])

print("\nплоска форма (модель відхилилася від схеми)")
check("читається як є", norm({
    "model": {"fields": F},
    "cards": [{"Код": "200", "Назва": "OK", "Приклад": "HTTP"}],
}), [{"Код": "200", "Назва": "OK", "Приклад": "HTTP"}])

print("\nбез model.fields — імена з ключів")
check("виводиться з картки", norm({
    "cards": [{"Код": "200", "Назва": "OK"}],
}), [{"Код": "200", "Назва": "OK"}])

print("\nзахисні випадки")
check("порожня відповідь", norm({}), [])
check("без cards", norm({"model": {"fields": F}}), [])
check("картка без даних відкидається", norm({
    "model": {"fields": F},
    "cards": [{"fields": {}}, {"fields": {"Код": "500"}}],
}), [{"Код": "500", "Назва": "", "Приклад": ""}])
check("None замість значень", norm({
    "model": {"fields": F},
    "cards": [{"fields": {"Код": None, "Назва": "OK"}}],
}), [{"Код": "", "Назва": "OK", "Приклад": ""}])
check("пробіли обрізано", norm({
    "model": {"fields": F},
    "cards": [{"fields": {"Код": "  200  "}}],
}), [{"Код": "200", "Назва": "", "Приклад": ""}])
check("не dict у cards", norm({
    "model": {"fields": F},
    "cards": ["текст", None, {"fields": {"Код": "200"}}],
}), [{"Код": "200", "Назва": "", "Приклад": ""}])
check("фільтри як поля не стають", norm({
    "cards": [{"guid": "abc", "position": 1, "Код": "200"}],
}), [{"Код": "200"}])
check("філери та тире в додаткових полях стають порожніми", norm({
    "model": {"fields": F},
    "cards": [
        {"fields": {"Код": "200", "Назва": "—", "Приклад": "немає"}},
        {"fields": {"Код": "201", "Назва": "Created", "Приклад": "N/A"}},
    ],
}), [
    {"Код": "200", "Назва": "", "Приклад": ""},
    {"Код": "201", "Назва": "Created", "Приклад": ""},
])

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
