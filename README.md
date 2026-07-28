# TCG600nap

A custom trading card game built on Magic: The Gathering Alpha mechanics, played in
[Cockatrice](https://cockatrice.github.io/). Cards are defined as data in a CSV; a small
Python script generates the Cockatrice set XML.

## Layout

```
cards/cards.csv       # card definitions — edit this to add/change cards
art/                  # card images, named exactly like the card (Spark Bolt.png)
scripts/build_set.py  # CSV -> Cockatrice v4 XML generator
dist/                 # generated XML (not committed)
tests/                # pytest suite for the generator
```

## Workflow

1. Edit `cards/cards.csv`. Columns:
   - `name` — card name (must match the art filename)
   - `maintype` — Creature / Instant / Sorcery / Artifact / Enchantment / Basic Land
   - `subtype` — optional, e.g. `Goblin` (renders as `Creature — Goblin`)
   - `manacost` — e.g. `1W`, `UU`, `4GG`; empty for lands
   - `pt` — power/toughness for creatures, e.g. `2/1`
   - `rarity` — common / uncommon / rare
   - `text` — rules text; use `\n` for line breaks, `{T}`, `{W}` etc. for symbols
2. Drop card images into `art/` as `<Card Name>.png` (or .jpg).
3. Build and install into Cockatrice:

```bash
.venv/Scripts/python scripts/build_set.py --install
```

4. In Cockatrice: restart, then check **Card Database → Edit sets** — the set
   `TCG600nap (T6N)` should be listed. Deck editor will show all cards.

Without `--install` the XML is only written to `dist/01.tcg600nap.xml`; you can load it
manually via **Card Database → Add custom sets/cards**.

## Development

```bash
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install pytest ruff
.venv/Scripts/python -m pytest
.venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format .
```

## Card design notes

Mechanics follow MTG Alpha-era rules (tap, five colors, creatures with power/toughness,
instants/sorceries, first strike, flying, trample, haste). Game mechanics are not
copyrightable, but WotC card names, rules text, and artwork are — all cards here use
original names and art.
