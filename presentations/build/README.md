# Deck build tooling

The Workshop 1 deck (`../converged-data-modeling-workshop1.html`) is generated and checked
from this folder. Every figure is drawn with `deckfig.py`, which refuses to emit an SVG with
anything out of frame, colliding, or a line running through text.

| Script | What it does |
|---|---|
| `build_deck.py` | Regenerates the pattern walk (slides 14-37) from `deck_patterns/pNN_*.py`; each module's `slides()` returns its four slides, speaker notes included |
| `build_act1_figs.py` | Rebuilds the figures on the hand-authored Act 1-2 slides (spliced between `ACT1FIG` markers) |
| `build_act45_figs.py` | Rebuilds the figures on the hand-authored Act 4-5 and backup slides (`ACT45FIG` markers) |
| `export_lab_figures.py` | Exports each pattern's figures to `../../patterns/<pattern>/figures/` for the lab console's help dialogs |
| `qa_deck.py` | Renders the deck in headless Chrome and checks every slide (`--dark` for the dark theme) |

```bash
python3 presentations/build/build_deck.py          # pattern slides 14-37
python3 presentations/build/build_act1_figs.py     # Act 1-2 figures
python3 presentations/build/build_act45_figs.py    # Act 4-5 + backup figures
python3 presentations/build/export_lab_figures.py  # lab copies of the pattern figures
python3 presentations/build/qa_deck.py presentations/converged-data-modeling-workshop1.html
```

Slides 1-13 and 38-46 (and their speaker notes) are hand-authored in the deck itself; the
builders only replace their own marked regions. Edit slide content in the generators, rebuild,
then re-export the lab figures so the console's help matches the deck. `CMP_DECK=<path>`
points the builders at another copy of the deck.
