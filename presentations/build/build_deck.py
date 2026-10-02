"""Build the expanded pattern walk into converged-modeling-patterns/presentations/converged-data-modeling-workshop1.html.

Idempotent. On first run it:
  * moves every speaker note out of the JS ``speakerNotes`` object into an
    ``<aside class="notes" hidden>`` inside its own slide (so inserting slides can never
    shift notes), and points the notes pop-out at the aside;
  * wraps the six single pattern slides in PATTERNS:START/END markers and saves each as a
    legacy fragment;
  * adds the pattern-walk CSS (flow token, split layouts, figure sizing).
Every run then replaces the marked region with the generated 4-slide groups from
``deck_patterns/pNN_*.py`` (each exposes ``slides() -> list[str]``). A pattern whose
module doesn't exist yet falls back to its legacy single slide, so partial builds work.

Usage:  python3 presentations/build/build_deck.py
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # presentations/build
# The deck lives one level up (presentations/), next to its images and bundled fonts.
# Override with CMP_DECK=/path/to/deck.html.
DECK = Path(os.environ.get("CMP_DECK", ROOT.parent / "converged-data-modeling-workshop1.html"))
PAT_DIR = ROOT / "deck_patterns"
LEGACY = PAT_DIR / "_legacy"
sys.path.insert(0, str(ROOT))

PATTERNS = [  # (number, legacy comment title, module prefix)
    ("01", "13. EXTENDED REFERENCE", "p01"),
    ("02", "14. COMPUTED", "p02"),
    ("03", "15. BUCKET / TIME SERIES", "p03"),
    ("04", "16. SUBSET", "p04"),
    ("05", "17. TREE / HIERARCHY", "p05"),
    ("06", "18. OUTLIER", "p06"),
]

CSS = """
  /* PATTERNS-CSS: pattern-walk additions (figures, split layouts) */
  :root { --flow: #2563EB; --flow-soft: rgba(37, 99, 235, 0.10); }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --flow: #60A5FA; --flow-soft: rgba(96, 165, 250, 0.16); }
  }
  :root[data-theme="dark"] { --flow: #60A5FA; --flow-soft: rgba(96, 165, 250, 0.16); }
  /* figures scale to the space the slide actually has (SVG letterboxes via viewBox) */
  .pat .body > figure, .pat .split > figure { display: flex; flex-direction: column; justify-content: center;
                                    min-height: 0; min-width: 0; margin: 0; }
  .pat .body > figure { flex: 1 1 0; }
  .pat .split > figure { height: 100%; }
  .pat svg.fig { flex: 1 1 0; min-height: 0; width: 100%; height: 100%; display: block; }
  .pat .stack > figure { margin: 0; }
  .pat .stack > figure > svg.fig { flex: none; height: auto; }
  .pat .body > figure > figcaption, .pat .split > figure > figcaption { flex: none; }
  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px;
           align-items: center; width: 100%; max-width: 1140px; margin: 0 auto; flex: 1 1 0; min-height: 0; }
  .split.wide-l { grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr); }
  .split.wide-r { grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); }
  .split.top { align-items: start; }
  .split > figure { align-self: stretch; }
  .stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
  .pill { white-space: nowrap; }
  table.qtable.compact { font-size: 12.5px; }
  table.qtable.compact th { padding: 5px 10px; font-size: 10.5px; }
  table.qtable.compact td { padding: 6px 10px; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px; }
  .facts span { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px;
                background: var(--chip); border-radius: 20px; padding: 3px 11px; color: var(--muted); }
  .facts b { color: var(--ink); font-weight: 600; }
  pre.code.tight { font-size: clamp(10px, 0.95vw, 12px); line-height: 1.5; padding: 10px 12px; }
  .flipnote { border-left: 3px solid var(--flow); background: var(--flow-soft); border-radius: 0 8px 8px 0;
              padding: 9px 13px; font-size: 13.5px; color: var(--muted); }
  .flipnote b { color: var(--ink); }
  .flipnote.sec { border-left-color: var(--cool); background: var(--cool-soft); }
  .flipnote code, .flipnote.sql code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.95em; color: var(--ink); }
  .flipnote.sql { border-left-color: var(--flow); background: var(--flow-soft); font-size: 14.5px; }
  pre.code mark.hl { background: var(--flow-soft); color: var(--flow); font-weight: 700; border-radius: 3px;
                     outline: 1.5px solid var(--flow); padding: 0 2px; }
  aside.notes { display: none; }
  /* /PATTERNS-CSS */
"""

NOTES_JS_OLD = "const notes = speakerNotes[slideIndex] || '<em style=\"color:#888;\">No speaker notes for this slide.</em>';"
NOTES_JS_NEW = ("const aside = slideEl.querySelector('aside.notes');\n"
                "    const notes = (aside && aside.innerHTML.trim()) || speakerNotes[slideIndex] || "
                "'<em style=\"color:#888;\">No speaker notes for this slide.</em>';")


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def migrate(s: str) -> str:
    if 'class="notes"' in s:
        return s
    m = re.search(r"  const speakerNotes = \{\n(.*?)\n  \};", s, re.S)
    notes = {}
    for line in m.group(1).split("\n"):
        mm = re.match(r'\s*(\d+): (".*"),\s*$', line)
        notes[int(mm.group(1))] = json.loads(mm.group(2))
    # drop the JS object first (positions in ``m`` are only valid for the unmodified text)
    s = s[:m.start()] + "  const speakerNotes = {}; // notes live in each slide's <aside class=\"notes\">" + s[m.end():]
    parts = s.split("</section>")
    assert len(parts) - 1 == len(notes), (len(parts) - 1, len(notes))
    out = []
    for i, p in enumerate(parts[:-1]):
        out.append(p + f'  <aside class="notes" hidden>{notes[i]}</aside>\n  </section>')
    s = "".join(out) + parts[-1]
    assert NOTES_JS_OLD in s
    s = s.replace(NOTES_JS_OLD, NOTES_JS_NEW)
    # wrap the pattern slides + save legacy fragments
    start = s.index("<!-- ============ 13. EXTENDED REFERENCE")
    end = s.index("<!-- ============ 19. RAPID ROUND")
    region = s[start:end]
    LEGACY.mkdir(parents=True, exist_ok=True)
    for i, (num, title, _) in enumerate(PATTERNS):
        a = region.index(f"<!-- ============ {title}")
        b = region.index(f"<!-- ============ {PATTERNS[i + 1][1]}") if i + 1 < len(PATTERNS) else len(region)
        (LEGACY / f"{num}.html").write_text(region[a:b].rstrip() + "\n\n", encoding="utf-8")
    s = s[:start] + "<!-- PATTERNS:START -->\n<!-- PATTERNS:END -->\n\n  " + s[end:]
    s = s.replace("</style>", CSS + "</style>", 1)
    return s


def build(only: str | None = None, out: Path | None = None):
    """only='03' builds just that pattern (others stay legacy) into ``out``, used for isolated
    previews so parallel authors never touch the real deck or each other's work."""
    s = DECK.read_text(encoding="utf-8")
    s = migrate(s)
    a = s.index("  /* PATTERNS-CSS")
    b = s.index("  /* /PATTERNS-CSS */") + len("  /* /PATTERNS-CSS */\n") if "/* /PATTERNS-CSS */" in s else s.index("</style>")
    s = s[:a] + CSS.lstrip("\n") + s[b:]
    groups, built = [], []
    for num, _, pref in PATTERNS:
        mods = sorted(PAT_DIR.glob(f"{pref}_*.py")) if (only is None or only == num) else []
        if mods:
            slides = load_module(mods[0]).slides()
            groups.append(f"  <!-- ============ PATTERN {num} ============ -->\n" + "\n\n".join(slides))
            built.append(f"{num}:{len(slides)}")
        else:
            groups.append((LEGACY / f"{num}.html").read_text(encoding="utf-8").rstrip())
            built.append(f"{num}:legacy")
    a = s.index("<!-- PATTERNS:START -->") + len("<!-- PATTERNS:START -->")
    b = s.index("<!-- PATTERNS:END -->")
    s = s[:a] + "\n" + "\n\n".join(groups) + "\n" + s[b:]
    n = s.count('<section class="slide')
    s = re.sub(r'(<span class="counter" id="counter">)1 / \d+', rf"\g<1>1 / {n}", s)
    target = out or DECK
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(s, encoding="utf-8")
    tmp.replace(target)  # atomic
    missing = [i for i, sec in enumerate(s.split('<section class="slide')[1:]) if 'class="notes"' not in sec]
    print(f"deck: {n} slides · patterns [{', '.join(built)}] · slides without notes: {missing or 'none'}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="pattern number, e.g. 03 (preview build)")
    ap.add_argument("--out", type=Path, help="output file (required with --only)")
    a = ap.parse_args()
    if a.only and not a.out:
        ap.error("--only needs --out (never overwrite the real deck from a partial build)")
    build(a.only, a.out)
