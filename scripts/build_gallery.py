"""Build cards.html — a card gallery with full-card images and complete card text.

Each card shows its current in-game graphic (finished art from art/cards/ when present,
otherwise the generated placeholder) next to its full rules-facing text, with search and
affinity filters. Static output, local assets only.

Usage:
    python scripts/build_gallery.py
"""

from __future__ import annotations

import html
import logging
from pathlib import Path

from build_placeholders import ACCENTS, NEUTRAL, affinity_letters
from build_set import Card, load_cards

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "cards.html"

AFFINITY_NAMES = {
    "P": "Power",
    "B": "Bitcoin",
    "K": "Keys",
    "S": "Signal",
    "T": "Timelock",
}

log = logging.getLogger("build_gallery")


def image_path(card: Card) -> str:
    """Finished art wins over the placeholder render."""
    for ext in (".png", ".jpg", ".jpeg"):
        if (REPO_ROOT / "art" / "cards" / f"{card.name}{ext}").is_file():
            return f"art/cards/{card.name}{ext}"
    return f"art/cards/placeholders/{card.name}.png"


def card_article(card: Card) -> str:
    """One gallery entry: image plus full text panel."""
    letters = affinity_letters(card) or "N"
    accent = ACCENTS.get(letters[0], NEUTRAL)
    haystack = html.escape(
        f"{card.name} {card.type_line} {card.text} {card.rarity}".lower(), quote=True
    )
    cost = html.escape(card.cost) if card.cost else "—"
    ar = f'<p class="ar">{html.escape(card.ar)}</p>' if card.ar else ""
    text = (
        f'<p class="rules">{html.escape(card.text)}</p>'
        if card.text
        else '<p class="rules empty">(no rules text yet)</p>'
    )
    return f"""
<article class="card" data-affinity="{letters}" data-search="{haystack}" style="--accent:{accent}">
  <img src="{html.escape(image_path(card), quote=True)}" alt="{html.escape(card.name, quote=True)}" loading="lazy">
  <div class="meta">
    <h2>{html.escape(card.name)}</h2>
    <p class="line">Cost <strong>{cost}</strong> · {html.escape(card.type_line)} · {html.escape(card.rarity)}</p>
    {text}
    {ar}
  </div>
</article>"""


def build_page(cards: list[Card]) -> str:
    """Assemble the full gallery page."""
    chips = ['<button class="chip active" data-filter="all">All</button>']
    for letter, name in AFFINITY_NAMES.items():
        chips.append(
            f'<button class="chip" data-filter="{letter}" style="--accent:{ACCENTS[letter]}">'
            f"{name}</button>"
        )
    chips.append(
        f'<button class="chip" data-filter="N" style="--accent:{NEUTRAL}">Neutral</button>'
    )
    articles = "\n".join(card_article(c) for c in cards)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>600B Timelock TCG — E1 Card Gallery</title>
<style>
@font-face {{
  font-family: "Anton";
  src: url("art/fonts/Anton-Regular.ttf") format("truetype");
  font-display: swap;
}}
* {{ box-sizing: border-box; margin: 0; }}
body {{
  background: #000;
  color: #FFF7EC;
  font-family: system-ui, sans-serif;
  padding: 24px clamp(16px, 4vw, 48px) 64px;
}}
header {{ display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }}
header img {{ height: 64px; }}
h1 {{ font-family: Anton, sans-serif; font-size: clamp(26px, 4vw, 40px); letter-spacing: 1px; }}
h1 span {{ color: #F7931A; }}
header p {{ color: #8A8F98; width: 100%; }}
.controls {{ display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0; align-items: center; }}
#search {{
  background: #111; color: #FFF7EC; border: 1px solid #2A2A2A; border-radius: 10px;
  padding: 10px 16px; font-size: 16px; min-width: min(340px, 100%);
}}
#search:focus {{ outline: 2px solid #F7931A; }}
.chip {{
  --accent: #F7931A;
  background: #111; color: #FFF7EC; border: 2px solid var(--accent);
  border-radius: 999px; padding: 6px 16px; font-size: 14px; cursor: pointer;
}}
.chip.active {{ background: var(--accent); color: #000; font-weight: 700; }}
.grid {{
  display: grid; gap: 24px;
  grid-template-columns: repeat(auto-fill, minmax(min(460px, 100%), 1fr));
}}
.card {{
  display: flex; gap: 16px; background: #111; border: 1px solid #2A2A2A;
  border-left: 4px solid var(--accent); border-radius: 14px; padding: 16px;
}}
.card img {{ width: 200px; max-width: 40%; height: auto; border-radius: 10px; flex-shrink: 0; }}
.card h2 {{ font-family: Anton, sans-serif; font-size: 22px; letter-spacing: .5px; }}
.card .line {{ color: #8A8F98; font-size: 14px; margin: 6px 0 12px; }}
.card .rules {{ font-size: 15px; line-height: 1.5; }}
.card .rules.empty {{ color: #8A8F98; font-style: italic; }}
.card .ar {{
  margin-top: 12px; font-family: Anton, sans-serif; font-size: 20px; color: var(--accent);
}}
.card.hidden {{ display: none; }}
#count {{ color: #8A8F98; margin-bottom: 16px; }}
</style>
</head>
<body>
<header>
  <img src="art/brand/600B-logo-primary.png" alt="600B logo">
  <h1>600B TIMELOCK TCG — <span>E1 CARD GALLERY</span></h1>
  <p>Work in progress · placeholder renders stand in until finished art lands in art/cards/ · <a href="index.html" style="color:#F7931A">rulebook</a></p>
</header>
<div class="controls">
  <input id="search" type="search" placeholder="Search name, text, type…">
  {"".join(chips)}
</div>
<p id="count"></p>
<main class="grid">{articles}
</main>
<script>
const cards = [...document.querySelectorAll(".card")];
const chipsEls = [...document.querySelectorAll(".chip")];
const search = document.getElementById("search");
const count = document.getElementById("count");
let affinity = "all";

function apply() {{
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  for (const card of cards) {{
    const okAffinity = affinity === "all" || card.dataset.affinity.includes(affinity);
    const okText = !q || card.dataset.search.includes(q);
    card.classList.toggle("hidden", !(okAffinity && okText));
    if (okAffinity && okText) shown++;
  }}
  count.textContent = shown + " / " + cards.length + " cards";
}}

for (const chip of chipsEls) {{
  chip.addEventListener("click", () => {{
    chipsEls.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    affinity = chip.dataset.filter;
    apply();
  }});
}}
search.addEventListener("input", apply);
apply();
</script>
</body>
</html>
"""


def main() -> None:
    """Generate cards.html from cards.csv."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cards = load_cards(REPO_ROOT / "cards" / "cards.csv")
    OUT_PATH.write_text(build_page(cards), encoding="utf-8")
    log.info("wrote %s with %d cards", OUT_PATH, len(cards))


if __name__ == "__main__":
    main()
