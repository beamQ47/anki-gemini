"""
Тест синхронності стилів картки між бекендом і переглядом.

Експорт бере стилі з BASE_CARD_CSS і FIELD_STYLES_CSS (main.py), а
перегляд у браузері дзеркалить їх у css/style.css під .deck-preview-scope.
Це дві копії одного й того самого, тож без охоронця вони розійдуться
за першу ж зміну макета — і перегляд почне брехати про те, що бачить
користувач в Anki.

Тому кожне правило з бекенду має бути присутнє у css/style.css з тим
самим набором оголошень (лише селектор має бути додатково обгорнутий
у .deck-preview-scope, бо в Anki такого класу немає).
"""
import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from main import BASE_CARD_CSS, FIELD_STYLES_CSS

ok = fail = 0


def check(label, got, want):
    global ok, fail
    if got == want:
        ok += 1
        print(f"  ok   {label}")
    else:
        fail += 1
        print(f"  FAIL {label}\n         got  {got!r}\n         want {want!r}")


def check_that(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ok   {label}")
    else:
        fail += 1
        print(f"  FAIL {label} {detail}")


def rules_of(css: str) -> dict:
    """{селектор: [набір оголошень, ...]} — по одному на кожну появу.

    Розбір навмисно простий і не розуміє вкладених @media. Це тут
    безпечно: нам треба не точний каскад, а те, щоб кожне правило
    бекенду знайшлося у перегляді. Тому збігаємо всі появи селектора
    разом, а мобільний дрібницький перевизначник (.card у @media)
    не робить перевірку безглуздою.
    """
    body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    found = {}
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
        selector = " ".join(match.group(1).split())
        decls = frozenset(
            norm_value(" ".join(d.split()))
            for d in match.group(2).split(";")
            if d.strip()
        )
        found.setdefault(selector, []).append(decls)
    return found


def union_decls(rules: dict, selector: str) -> frozenset:
    out = set()
    for group in rules.get(selector, []):
        out |= group
    return frozenset(out)


def norm_value(text: str) -> str:
    """Приводить значення до одного вигляду.

    .3 і 0.3 — те саме значення, як і 'Segoe UI' та "Segoe UI". Без
    цієї нормалізації тест падав би на форматуванні, а не на реальній
    розбіжності, і його швидко б перестали читати.
    """
    out = text.replace("'", '"')
    out = re.sub(r"(?<![\w.])0\.(?=\d)", ".", out)
    return " ".join(out.split())


def norm_decls(text: str) -> frozenset:
    return frozenset(
        norm_value(" ".join(d.split()))
        for d in text.split(";")
        if d.strip()
    )


scope = ".deck-preview-scope"
preview_css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
preview_rules = rules_of(preview_css)
scoped_rules = {k[len(scope):].strip() if k.startswith(scope) else k: v
                for k, v in preview_rules.items()}

print("BASE_CARD_CSS має бути в css/style.css під .deck-preview-scope")
for name, block in (("BASE_CARD_CSS", BASE_CARD_CSS), ("FIELD_STYLES_CSS", FIELD_STYLES_CSS)):
    for selector, groups in rules_of(block).items():
        want = frozenset().union(*groups) if groups else frozenset()
        got = union_decls(scoped_rules, selector)
        if got is None:
            check_that(f"{name}: {selector} — є у перегляді", False, "правила немає")
            continue
        ok += 1
        print(f"  ok   {name}: {selector} — є у перегляді")
        missing = want - got
        check_that(f"{name}: {selector} — усі властивості збігаються", not missing,
                   f"бракує: {sorted(missing)}")

print()
print("Структурні класи прев'ю збігаються з шаблоном картки")
for selector in (".deck-preview-scope .card", ".deck-preview-scope .anki-question",
                 ".deck-preview-scope #answer", ".deck-preview-scope .anki-field",
                 ".deck-preview-scope .anki-field-name", ".deck-preview-scope .anki-field-value"):
    check_that(f"{selector} — оголошено", selector in preview_rules, "")

print()
print("Картка прев'ю справді має клас .card (його ловить CSS користувача)")
html = (ROOT / "index.html").read_text(encoding="utf-8")
check_that("previewCardFront має class=\"card\"", 'id="previewCardFront" class="card' in html, "")
check_that("previewCardBack має class=\"card\"", 'id="previewCardBack" class="card' in html, "")
check_that("сцена має клас .deck-preview-scope", 'class="deck-preview-scope"' in html, "")

print()
print("Атрибут перевертання один і той самий в HTML, CSS і JS")
# Саме через розбіжність тут картка в перегляді колоди не переверталася:
# index.html і renderPreview ставили data-flipped, а CSS шукав data-flapped.
# Селектор не збігався з жодним елементом — і жоден тест цього не бачив,
# бо перевіряв лише dataset у JS, а не відповідність селектора.
html_attr = re.search(r'id="previewCardStage"[^>]*\bdata-([a-z-]+)=', html)
check_that("у previewCardStage є data-атрибут", bool(html_attr),
           "атрибута data-* не знайдено")
attr = html_attr.group(1) if html_attr else ""
check_that(f"HTML ставить data-{attr}", f"data-{attr}" in html, "")

js = (ROOT / "js" / "decks.js").read_text(encoding="utf-8")
check_that(f"js/decks.js пише dataset.{attr}",
           f"dataset.{attr}" in js,
           f"у js немає dataset.{attr}")
check_that("у css немає іншого data-атрибута на перевертання",
           f"[data-{attr}=" in preview_css,
           f"у css немає селектора [data-{attr}=...]")

# Усі селектори перевертання мають вживати саме цей атрибут.
flip_selectors = re.findall(r"^\.(deck-preview-scope[^{]*?)\{", preview_css, re.M)
foreign = [s for s in flip_selectors
           if "data-" in s and f"data-{attr}" not in s]
check_that("жоден селектор прев'ю не використовує інший data-атрибут",
           not foreign, f"знайдено: {foreign}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
