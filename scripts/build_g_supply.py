"""Build the G edition census: 210 starter sets, listed set by set.

WHY THIS IS NOT build_mint_supply.py. Edition One is a BOX: a pack is a draw
from weighted pools, and the census publishes the odds so anyone can check them.
A starter set is the opposite kind of object. It is a precon — a known list of
cards, chosen to be playable straight out of the box against the set beside it.
There are no odds to publish because nothing is drawn.

So this census does not describe pools. It describes CONTENT: an explicit
manifest, one entry per set, naming every card in it. The mint issues set N by
reading entry N, and the commitment over that manifest is what makes the claim
"the first twenty-one sets carry a Genesis card" checkable by anybody, by
counting, with no beacon and no hashing.

THE THREE DECISIONS, stated rather than buried:

1. A set is TWO PRECONS plus two extra slots — 82 cards, the same for every set.
   Uniformity is not tidiness here: `cards_per_pack` is published, and a wallet
   that expects 82 and receives 80 has no way to tell a short set from a
   tampered one.

2. The first STRONG_SETS sets carry a Genesis card and the FIPS promo in those
   two slots. The rest carry a Vault card and a Basic Resource, so the slots are
   never empty and a plain set is still worth opening.

3. No Genesis card appears in more than PER_GENESIS_CARD of the strong sets, so
   the scarce copies land across several titles instead of piling onto one.

E1 IS NOT TOUCHED. This writes its own file with its own collection id, and the
E1 census keeps every number it published — which is the whole reason the G
edition exists as a separate edition rather than a slice of the first.

    uv run python scripts/build_g_supply.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------- the shape
SETS = 210
DECKS_PER_SET = 2
DECK_SIZE = 40
EXTRA_SLOTS = 2
CARDS_PER_SET = DECKS_PER_SET * DECK_SIZE + EXTRA_SLOTS

STRONG_SETS = 21  # the first N, and they are the first ON PURPOSE
PER_GENESIS_CARD = 3  # the most any one Genesis title may appear across them
PROMO_ID = "FIPS-P01"  # rides along in every strong set, and nowhere else

COLLECTION_ID = "600B-G"
VERSION = "g-census-r1"


def _load_js_global(path: Path, name: str) -> dict:
    """Read a generated `globalThis.X = {...};` bundle without a JS runtime."""
    text = path.read_text(encoding="utf-8")
    marker = f"globalThis.{name} ="
    start = text.index(marker) + len(marker)
    start += len(text[start:]) - len(text[start:].lstrip())
    # Brace-matched rather than cut at the last semicolon: these bundles end with
    # a `module.exports = ...;` line, so rindex(";") swallowed it and json choked
    # on "Extra data". Counting is the only version of this that survives a
    # generator adding another statement at the end of the file.
    opener = text[start]
    closer = {"{": "}", "[": "]"}[opener]
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        ch = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return json.loads(text[start : index + 1])
    raise SystemExit(f"{path.name}: never closed the {name} literal")


def _e1_cards() -> dict[str, dict]:
    census = json.loads((REPO / "cards" / "nutft-census.json").read_text(encoding="utf-8"))
    return {card["id"]: card for card in census["cards"]}


def _pairings(names: list[str]) -> list[tuple[str, str]]:
    """Which two precons share a box, for every set in the run.

    Walked deterministically rather than shuffled: the census is a published
    document, and "why did set 137 get these two decks" should have an answer
    that does not require re-running a random seed.
    """
    pairs: list[tuple[str, str]] = []
    count = len(names)
    index = 0
    while len(pairs) < SETS:
        a = names[index % count]
        b = names[(index // count + index + 1) % count]
        if a == b:
            b = names[(index + 2) % count]
        pairs.append((a, b))
        index += 1
    return pairs


def build(strict: bool = True) -> dict:
    precons = _load_js_global(REPO / "site" / "precons.js", "E1_PRECONS")
    cards = _e1_cards()
    promos = json.loads((REPO / "cards" / "promos.json").read_text(encoding="utf-8"))
    promo = next(card for card in promos["cards"] if card["id"] == PROMO_ID)

    names = sorted(precons)
    for name in names:
        deck = precons[name].get("cards", [])
        if len(deck) != DECK_SIZE:
            raise SystemExit(f"precon {name!r} has {len(deck)} cards, expected {DECK_SIZE}")

    genesis = [cid for cid, card in cards.items() if card.get("tier") == "Genesis"]
    vault = [cid for cid, card in cards.items() if card.get("tier") == "Vault"]
    basics = [cid for cid, card in cards.items() if card.get("tier") == "Basic"]
    genesis.sort()
    vault.sort()
    basics.sort()

    if strict and STRONG_SETS > len(genesis) * PER_GENESIS_CARD:
        raise SystemExit(
            f"{STRONG_SETS} strong sets need more Genesis copies than "
            f"{len(genesis)} titles x {PER_GENESIS_CARD} allows"
        )

    # GENESIS COMES OUT OF THE DECKS, and this is the subtlest thing here.
    #
    # The eleven precons are BUILT AROUND Genesis cards -- that is why the copy
    # limit for Genesis is one rather than three, so a precon can legally ship
    # the card it is built around. In the game those are untradeable PLAY
    # copies and cost the edition nothing.
    #
    # A mint does not issue play copies. It issues bearer assets, so minting a
    # precon verbatim would have printed 214 Genesis NutFTs across this run --
    # against the 21 the shop publishes, on a page whose whole argument is that
    # its numbers are the mint's. Caught by checking the census against its own
    # promises rather than trusting the generator.
    #
    # So a Genesis card inside a deck is replaced by a Vault card of the same
    # edition. The only Genesis NutFTs in G are the ones in the strong sets'
    # extra slot, which is exactly what "one of their two decks carries a single
    # Genesis card" was always supposed to mean.
    genesis_set = set(genesis)
    substitutions = 0

    def playable(deck: list[str], offset: int) -> list[str]:
        nonlocal substitutions
        out = []
        for position, cid in enumerate(deck):
            if cid in genesis_set:
                out.append(vault[(offset + position) % len(vault)])
                substitutions += 1
            else:
                out.append(cid)
        return out

    pairs = _pairings(names)
    manifest: list[dict] = []
    for index in range(SETS):
        left, right = pairs[index]
        contents = playable(precons[left]["cards"], index) + playable(
            precons[right]["cards"], index + DECK_SIZE
        )
        strong = index < STRONG_SETS
        if strong:
            # Round-robin across the titles, so the cap holds by construction
            # rather than by a check that someone has to remember to run.
            extras = [genesis[index % len(genesis)], PROMO_ID]
        else:
            extras = [vault[index % len(vault)], basics[index % len(basics)]]
        contents += extras
        if len(contents) != CARDS_PER_SET:
            raise SystemExit(f"set {index + 1} has {len(contents)} cards, expected {CARDS_PER_SET}")
        manifest.append(
            {
                "set": index + 1,
                "pack_id": f"set-{index + 1:04d}",
                "decks": [left, right],
                "strong": strong,
                "cards": contents,
            }
        )

    counts: dict[str, int] = {}
    for entry in manifest:
        for cid in entry["cards"]:
            counts[cid] = counts.get(cid, 0) + 1

    # The commitment covers the COUNTS, exactly as E1's does, so the two
    # editions are verified the same way and one hashing rule serves both.
    canonical = json.dumps(dict(sorted(counts.items())), separators=(",", ":"))
    commitment = hashlib.sha256(canonical.encode("utf-8") + b"\x00").hexdigest()

    def card_entry(cid: str) -> dict:
        if cid == PROMO_ID:
            return {
                "id": PROMO_ID,
                "name": promo["name"],
                "tier": "Promo",
                "type_line": promo["type_line"],
                "copies": counts[cid],
                "pool": "extra",
            }
        source = cards[cid]
        return {
            "id": cid,
            "name": source["name"],
            "tier": source["tier"],
            "type_line": source["type_line"],
            "copies": counts[cid],
            "pool": "extra" if source["tier"] in ("Genesis", "Vault") else "deck",
            "face": source.get("face"),
        }

    strong_genesis = {}
    for entry in manifest:
        if entry["strong"]:
            cid = entry["cards"][-2]
            strong_genesis[cid] = strong_genesis.get(cid, 0) + 1
    total_genesis = sum(count for cid, count in counts.items() if cid in genesis_set)
    if strict and total_genesis != STRONG_SETS:
        raise SystemExit(
            f"this run would mint {total_genesis} Genesis NutFTs; the published "
            f"promise is {STRONG_SETS}, one per strong set"
        )
    worst = max(strong_genesis.values()) if strong_genesis else 0
    if strict and worst > PER_GENESIS_CARD:
        raise SystemExit(
            f"a Genesis title appears in {worst} strong sets, cap is {PER_GENESIS_CARD}"
        )

    return {
        "set": COLLECTION_ID,
        "version": VERSION,
        "note": (
            f"{SETS} starter sets. Each is {DECKS_PER_SET} precon decks of {DECK_SIZE} "
            f"plus {EXTRA_SLOTS} extra cards. The first {STRONG_SETS} carry a Genesis "
            f"card and the {promo['name']} promo; the rest carry a Vault card and a "
            "Basic Resource. Nothing here is drawn: the manifest below is the print run."
        ),
        "mint": {
            "packs": SETS,
            "cards_per_pack": CARDS_PER_SET,
            "paid_cards_per_pack": CARDS_PER_SET,
            "issuance": "manifest",
            "strong_sets": STRONG_SETS,
            "per_genesis_card": PER_GENESIS_CARD,
        },
        "manifest": manifest,
        "census_sha256": commitment,
        "mirrors": [
            "https://blossom.primal.net",
            "https://blossom.bimcvp.com",
            "https://nostr.download",
        ],
        "cards": [card_entry(cid) for cid in sorted(counts)],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=REPO / "cards" / "g-census.json")
    parser.add_argument("--site-out", type=Path, default=REPO / "site" / "g-data.js")
    parser.add_argument(
        "--lenient", action="store_true", help="report cap breaches instead of refusing"
    )
    args = parser.parse_args()

    census = build(strict=not args.lenient)
    args.out.write_text(json.dumps(census, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    # The SHOP's copy of these numbers, generated rather than typed. The page had
    # "2 decks of 40 = 80 cards" hand-written in shop.js while this census printed
    # 82, and a page whose whole argument is that its figures are the mint's cannot
    # carry a figure the mint disagrees with. The manifest itself is 390KB and has
    # no business on a shop page; these few numbers do.
    strong_sets = sum(1 for entry in census["manifest"] if entry["strong"])
    genesis_copies = sum(c["copies"] for c in census["cards"] if c["tier"] == "Genesis")
    site = {
        "collectionId": census["set"],
        "version": census["version"],
        "sets": census["mint"]["packs"],
        "decksPerSet": DECKS_PER_SET,
        "deckSize": DECK_SIZE,
        "cardsPerSet": census["mint"]["cards_per_pack"],
        "extraSlots": EXTRA_SLOTS,
        "genesisSets": strong_sets,
        "genesisCopies": genesis_copies,
        "perGenesisCard": census["mint"]["per_genesis_card"],
        "promoId": PROMO_ID,
        "commitment": census["census_sha256"],
    }
    header = [
        "/* Generated by scripts/build_g_supply.py - do not edit by hand.",
        " * The G edition's published shape, so the shop states what the census",
        " * states and the two cannot drift. */",
        "globalThis.E1_G = " + json.dumps(site, indent=1) + ";",
        'if (typeof module === "object" && module.exports) module.exports = globalThis.E1_G;',
        "",
    ]
    args.site_out.write_text(chr(10).join(header), encoding="utf-8")

    strong = sum(1 for entry in census["manifest"] if entry["strong"])
    print(f"{args.out.relative_to(REPO)}")
    print(f"  sets            {census['mint']['packs']}")
    print(f"  cards per set   {census['mint']['cards_per_pack']}")
    total_cards = census["mint"]["packs"] * census["mint"]["cards_per_pack"]
    print(f"  cards in the run {total_cards:,}".replace(",", " "))
    print(f"  strong sets     {strong} (the first {strong})")
    print(f"  distinct cards  {len(census['cards'])}")
    print(f"  commitment      {census['census_sha256']}")
    minted_genesis = sum(c["copies"] for c in census["cards"] if c["tier"] == "Genesis")
    print(f"  genesis NutFTs  {minted_genesis}")


if __name__ == "__main__":
    main()
