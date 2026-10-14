import re, os, sys

AR_CH = r'؀-ۿ'
AR = re.compile(f'[{AR_CH}]')
ARRUN = f'[{AR_CH}][{AR_CH}\\s\\u060C\\u061F!؟.،/%()0-9-]*?[{AR_CH}]|[{AR_CH}]'
LATIN = re.compile(r'[A-Za-zÀ-ÿ]')

def clean(seg: str) -> str:
    s = seg
    # "(Latin / عربي)"  ->  "(Latin)"
    s = re.sub(r'\(([^()]*?[A-Za-z][^()]*?)\s*[/|•·-]\s*(?:' + ARRUN + r')\s*\)', r'(\1)', s)
    # "(عربي / Latin)"  ->  "(Latin)"
    s = re.sub(r'\(\s*(?:' + ARRUN + r')\s*[/|•·-]\s*([^()]*?[A-Za-z][^()]*?)\)', r'(\1)', s)
    # "(عربي)"  ->  removed
    s = re.sub(r'\s*\(\s*(?:' + ARRUN + r')\s*\)', '', s)
    # "Latin • عربي"  /  "Latin - عربي"  ->  "Latin"
    s = re.sub(r'\s*[•·|]\s*(?:' + ARRUN + r')\s*$', '', s)
    # "عربي • Latin"  ->  "Latin"
    s = re.sub(r'^\s*(?:' + ARRUN + r')\s*[•·|/]\s*', '', s)
    # "عربي (Latin)"  ->  "Latin"
    m = re.match(r'^\s*(?:' + ARRUN + r')\s*\(([^()]*[A-Za-z][^()]*)\)\s*$', s)
    if m and re.search(r'[A-Za-z]\s+\S*[A-Za-z]', m.group(1)):
        s = m.group(1)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    s = re.sub(r'\s+([,.;:!?])', r'\1', s)
    return s

STRLIT = re.compile(r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")""")

def process(text):
    changes = []
    def repl(m):
        lit = m.group(0)
        q, body = lit[0], lit[1:-1]
        if not AR.search(body):
            return lit
        new = clean(body)
        if new == body or not LATIN.search(new) or not new or AR.search(new):
            return lit                      # needs a real translation, leave it
        changes.append((body, new))
        return q + new + q
    text2 = STRLIT.sub(repl, text)

    # JSX text nodes:  >  Latin (عربي)  <
    def repl_jsx(m):
        body = m.group(1)
        if not AR.search(body):
            return m.group(0)
        new = clean(body)
        if new == body or not LATIN.search(new) or not new or AR.search(new):
            return m.group(0)
        changes.append((body.strip(), new))
        return '>' + new + '<'
    text2 = re.sub(r'>([^<>{}\n]*[؀-ۿ][^<>{}\n]*)<', repl_jsx, text2)
    return text2, changes

apply = '--apply' in sys.argv
total = 0
for root, _, names in os.walk('src'):
    for n in sorted(names):
        if not n.endswith(('.ts', '.tsx')):
            continue
        p = os.path.join(root, n)
        if p.endswith('translations.ts'):
            continue
        src = open(p, encoding='utf-8').read()
        if not AR.search(src):
            continue
        out, ch = process(src)
        if not ch:
            continue
        total += len(ch)
        print(f"\n{p}  ({len(ch)})")
        for a, b in ch[:4]:
            print(f"    - {a[:70]}")
            print(f"    + {b[:70]}")
        if len(ch) > 4:
            print(f"    … +{len(ch)-4}")
        if apply:
            open(p, 'w', encoding='utf-8').write(out)
print(f"\n{'APPLIED' if apply else 'PREVIEW'}: {total} نص")
