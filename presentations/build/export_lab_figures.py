"""Export the deck's pattern figures as standalone SVGs for the companion lab.

The deck SVGs colour everything with CSS custom properties (var(--hot) ...), which an <img>
cannot see from the host page. Each exported file therefore carries its own <style> defining
the same tokens the lab uses, for light and dark schemes.

Usage:  python3 presentations/build/export_lab_figures.py [patterns-dir]   (default: this repo's patterns/)
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

MODULES = {
    "01-extended-reference": "p01_extended_reference",
    "02-computed": "p02_computed",
    "03-bucket": "p03_bucket",
    "04-subset": "p04_subset",
    "05-tree-hierarchy": "p05_tree_hierarchy",
    "06-outlier": "p06_outlier",
}
FIGS = {"doc-shape": "fig_doc", "erd": "fig_model", "model-curve": "fig_knobs", "flow": "fig_flow"}

LIGHT = ("--paper:#F6F8F9;--panel:#FFFFFF;--ink:#1C2733;--muted:#5A6B7C;--faint:#8B99A7;--hairline:#D8DEE4;"
         "--hot:#B3372B;--hot-soft:rgba(179,55,43,.10);--cool:#0E8A63;--cool-soft:rgba(14,138,99,.10);"
         "--flow:#2563EB;--flow-soft:rgba(37,99,235,.10);--chip:#EDF1F4;")
DARK = ("--paper:#131A22;--panel:#1A232E;--ink:#E8EDF2;--muted:#93A3B4;--faint:#6B7B8C;--hairline:#26313D;"
        "--hot:#E06552;--hot-soft:rgba(224,101,82,.14);--cool:#21A57F;--cool-soft:rgba(33,165,127,.14);"
        "--flow:#60A5FA;--flow-soft:rgba(96,165,250,.16);--chip:#222D39;")
STYLE = f"<style>svg{{{LIGHT}}}@media (prefers-color-scheme: dark){{svg{{{DARK}}}}}</style>"


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deck_patterns" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def standalone(svg: str) -> str:
    head, sep, rest = svg.partition(">")
    assert sep and head.startswith("<svg"), "unexpected SVG root"
    return head + ">" + STYLE + rest


def main(dest: Path) -> None:
    for pid, modname in MODULES.items():
        mod = load(modname)
        out = dest / pid / "figures"
        out.mkdir(parents=True, exist_ok=True)
        for fname, fn in FIGS.items():
            # fig_doc()/fig_model()/fig_knobs()/fig_flow() already return the rendered SVG
            # string (each calls Fig.svg() internally); there is no Fig object to re-render
            # with a different cls. Fig.check() (collision checks) already ran inside that
            # call, so a FigureError would already have surfaced above.
            if not hasattr(mod, fn):
                # The deck no longer draws this figure (e.g. a slide rebuilt as a step-through);
                # keep the lab's existing export rather than failing the whole run.
                print(f"{pid}/{fname}.svg  skipped (deck has no {fn}); existing file kept")
                continue
            svg = standalone(getattr(mod, fn)())
            (out / f"{fname}.svg").write_text(svg, encoding="utf-8")
            print(f"{pid}/{fname}.svg  {len(svg):,} B")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]) if len(sys.argv) == 2 else ROOT.parent.parent / "patterns")
