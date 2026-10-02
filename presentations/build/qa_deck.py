"""Headless QA for the pattern-walk slides (class ``pat``) of a built deck.

  python3 presentations/build/qa_deck.py <deck.html> [--shots DIR] [--dark] [--slides 14,15]

Prints JSON per pattern slide: layout issues (figure/table/code overlapping the lede or the
takeaway, off-screen, scroll overflow), the smallest figure scale (SVG px per viewBox unit —
aim for >= 0.80 so 11px labels stay legible on a projector), and speaker-note length.
Exit code 1 if any slide has issues. ``--shots`` also writes a 1280x720 PNG per slide
(animation disabled) for visual review — always Read them; the checker can't judge taste.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NO_ANIM = "<style>.slide.active{animation:none!important}</style>"
DARK = "<script>document.documentElement.dataset.theme='dark'</script>"
QA_JS = r"""<script>
window.addEventListener('load', () => {
  const out = []; const W = innerWidth;
  slides.forEach((s, i) => {
    if (!s.classList.contains('pat')) return;
    go(i);
    const ld = s.querySelector('.lede'), tk = s.querySelector('.takeaway');
    const tb = ld ? ld.getBoundingClientRect().bottom : 0;
    const kt = tk ? tk.getBoundingClientRect().top : 1e9;
    const bad = [];
    s.querySelectorAll('.body svg, .body table, .body pre, .body figcaption, .body .facts, .body .flipnote, .body .card, .body ol').forEach(el => {
      const r = el.getBoundingClientRect(); if (!r.height) return;
      if (r.top < tb - 1) bad.push(el.tagName + ' overlaps lede by ' + Math.round(tb - r.top) + 'px');
      if (r.bottom > kt + 1) bad.push(el.tagName + ' overlaps takeaway by ' + Math.round(r.bottom - kt) + 'px');
      if (r.right > W - 8 || r.left < 8) bad.push(el.tagName + ' off-screen');
    });
    if (s.scrollHeight > s.clientHeight + 2) bad.push('scroll overflow ' + (s.scrollHeight - s.clientHeight) + 'px');
    let scale = null;
    s.querySelectorAll('svg.fig').forEach(svg => {
      const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      const k = Math.min(r.width / vb.width, r.height / vb.height);
      scale = scale === null ? k : Math.min(scale, k);
    });
    const notes = (s.querySelector('aside.notes') || {}).innerHTML || '';
    out.push({slide: i + 1, label: s.getAttribute('aria-label'), issues: [...new Set(bad)],
              min_fig_scale: scale === null ? null : +scale.toFixed(2), notes_chars: notes.length});
  });
  const pre = document.createElement('pre'); pre.id = 'qa-out'; pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
});
</script>"""


def chrome() -> str:
    for c in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(c):
            return c
    sys.exit("no chrome/chromium on PATH")


def variant(src: Path, extra: str, tmpdir: Path, name: str) -> Path:
    s = src.read_text(encoding="utf-8")
    i = s.rindex("</body>")  # the deck's JS contains a literal '</body>' string — inject at the real one
    s = s[:i] + extra + s[i:]
    s = s.replace("<head>", "<head>" + NO_ANIM, 1)
    p = tmpdir / name
    p.write_text(s, encoding="utf-8")
    return p


def viewport_args(ch: str, w=1280, h=720) -> list[str]:
    """Headless 'window-size' includes window chrome; probe and correct so the *viewport* is w x h."""
    base = ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars"]
    with tempfile.TemporaryDirectory() as td:  # probe a file:// page — data: URLs report a different size
        pf = Path(td) / "probe.html"
        pf.write_text("<body><script>addEventListener('load',()=>{document.body.textContent="
                      "'VP'+innerWidth+'x'+innerHeight})</script></body>", encoding="utf-8")
        dom = subprocess.run([ch, *base, f"--window-size={w},{h}", "--virtual-time-budget=1000",
                              "--dump-dom", pf.as_uri()], capture_output=True, text=True, timeout=60).stdout
    m = re.search(r"VP(\d+)x(\d+)", dom)
    dw, dh = (w - int(m.group(1)), h - int(m.group(2))) if m else (0, 0)
    return base + [f"--window-size={w + dw},{h + dh}"]


def run(deck: Path, shots: Path | None, dark: bool, only: set[int] | None) -> int:
    ch = chrome()
    base = viewport_args(ch)
    with tempfile.TemporaryDirectory(dir=deck.parent) as td:
        td = Path(td)
        # The variant lives in a temp dir: bring the deck's relative assets along so QA
        # measures with the fonts and images the deck really uses.
        for sub in ("fonts", "images"):
            if (deck.parent / sub).is_dir():
                shutil.copytree(deck.parent / sub, td / sub)
        qa = variant(deck, (DARK if dark else "") + QA_JS, td, "qa.html")
        dom = subprocess.run([ch, *base, "--virtual-time-budget=6000", "--dump-dom", qa.as_uri()],
                             capture_output=True, text=True, timeout=180).stdout
        m = re.search(r'<pre id="qa-out">(.*?)</pre>', dom, re.S)
        if not m:
            sys.exit("QA script produced no output (page error?)")
        res = json.loads(html.unescape(m.group(1)))
        if only:
            res = [r for r in res if r["slide"] in only]
        if shots:
            shots.mkdir(parents=True, exist_ok=True)
            sv = variant(deck, DARK if dark else "", td, "shot.html")
            for r in res:
                png = shots / f"slide-{r['slide']:02d}{'-dark' if dark else ''}.png"
                subprocess.run([ch, *base, "--virtual-time-budget=3000", f"--screenshot={png}",
                                sv.as_uri() + f"#{r['slide']}"], capture_output=True, timeout=120)
                r["png"] = str(png)
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 1 if any(r["issues"] for r in res) else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("deck", type=Path)
    ap.add_argument("--shots", type=Path)
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--slides", help="comma-separated slide numbers to report")
    a = ap.parse_args()
    sel = {int(x) for x in a.slides.split(",")} if a.slides else None
    sys.exit(run(a.deck.resolve(), a.shots, a.dark, sel))
