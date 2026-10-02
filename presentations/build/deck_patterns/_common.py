"""Slide builders shared by every pattern module (deck_patterns/pNN_*.py).

Each pattern module exposes ``slides() -> list[str]`` returning exactly four
``<section class="slide">`` strings (A problem · B model/ERD · C knobs · D converged), built
with ``slide()`` below. Notes go in the ``notes`` argument (HTML, same voice as the rest of
the deck: a bold opening line, ▸ beats, an <em>Land:</em> closer).
"""
from __future__ import annotations

from html import escape as _esc

BEATS = {"A": "The problem", "B": "The model", "C": "Where the knobs flip it", "D": "The converged answer"}


def slide(*, label: str, pattern: str, beat: str, clock: str, title: str, lede: str, body: str,
          takeaway: str, notes: str) -> str:
    """pattern e.g. 'Pattern 1: Extended Reference'; beat in A/B/C/D."""
    return f"""  <section class="slide pat" aria-label="{_esc(label, quote=True)}">
    <div class="eyebrow"><span>Act 3 · {pattern} · {beat}. {BEATS[beat]}</span><span class="clock">{clock}</span></div>
    <h2>{title}</h2>
    <p class="lede">{lede}</p>
    <div class="body">
{body}
    </div>
    <p class="takeaway">{takeaway}</p>
  <aside class="notes" hidden>{notes}</aside>
  </section>"""


def table(headers: list[str], rows: list[list[str]], cls="qtable compact", num_cols=()) -> str:
    """HTML table. Cells are raw HTML. num_cols: indexes rendered with the mono .n class."""
    th = "".join(f"<th>{h}</th>" for h in headers)
    trs = []
    for r in rows:
        tds = "".join(f'<td class="n">{c}</td>' if i in num_cols else f"<td>{c}</td>" for i, c in enumerate(r))
        trs.append(f"<tr>{tds}</tr>")
    return f'<table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{"".join(trs)}</tbody></table>'


def facts(items: list[tuple[str, str]]) -> str:
    """Row of mono fact chips: [(value, label)]."""
    return '<div class="facts">' + "".join(f"<span><b>{v}</b> {l}</span>" for v, l in items) + "</div>"


def code(sql: str, label: str = "", tone: str = "cool") -> str:
    """Pre-highlighted code block. ``sql`` is already HTML (use <span class="k|c|s">)."""
    lab = f'<p class="col-label {tone}">{label}</p>' if label else ""
    return f'{lab}<pre class="code tight {tone}-edge">{sql}</pre>'
