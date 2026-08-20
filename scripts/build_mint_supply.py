"""Re-derive the mint's supply numbers from one declared pack shape.

The scoring pipeline that ranked Edition One is not in this repo: rank, score,
axes, tier, face and mirrors are inputs here and are never touched. Everything
downstream of the PACK is derived - copies per card, pool depth, tier shares,
per-card odds, the capped total, and the SHA-256 commitment the mint publishes
and the shop re-hashes (server/nutft-draw.js, censusHash).

Two rules make a pack shape legal.

Every pool must divide evenly across the cards drawing from it. A pool that does
not divide leaves a tail of cards printed one copy deeper than their neighbours -
a rarity nobody declared and nobody can see.

The prime caps are NOT derived from the pack shape, and they are the one thing
here that is a decision rather than a consequence. Changing the PACK grows the
bottom of the curve and nothing else; changing the mint SIZE is what moves them,
and only because they are written down beside PACKS and moved deliberately.

That is the trade, stated plainly: the caps are what "only N complete sets can
ever exist" means. Tripling the mint tripled them, so that sentence now reads 63
rather than 21. Every ratio survives untouched -- a named Genesis is still one
pack in 998, the tier shares do not move, and the copy spread is unchanged --
but the headline scarcity number is three times what it was, and anyone who
repeats the old one is repeating something that stopped being true here.

`p_per_pack` is the exact chance of seeing a named card in one pack: drawing is
without replacement, so it is one minus the product of the misses over the
pool's slots. At one slot that is copies/pool, unchanged. At ten it is 5% under
the copies-per-pack figure a plain multiplication gives, and `one_in_packs`
rounds to the same integer either way.

    uv run python scripts/build_mint_supply.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CENSUS = ROOT / "cards" / "nutft-census.json"

# The pack. 15 cards: 10 Common, 3 Uncommon, one Prime - Rare, Vault or Genesis,
# the only slot whose tier is uncertain - and one free uncapped Basic Resource.
# Change these numbers and every supply figure in the census follows.
PACKS = 62775
SLOTS = {"common": 10, "uncommon": 3, "prime": 1, "basic": 1}

# Moved WITH the mint size, not held against it - see the module docstring. At
# 20,925 packs these were 21 / 63 / 216; tripling the mint tripled them, which is
# what puts 63 Genesis Lotus in the world instead of 21.
PRIME_CAPS = {"Genesis": 63, "Vault": 189, "Rare": 648}

VERSION = "tier-census-r3"
NOTE = "Scored Edition One scarcity census. See docs/adr/0004-mint-tier-authority.md."


def census_sha256(counts: dict[str, int]) -> str:
    """The mint's own recipe, byte for byte: sorted {id: copies}, then a zero byte."""
    canonical = json.dumps(dict(sorted(counts.items())), separators=(",", ":"))
    return hashlib.sha256(canonical.encode() + b"\x00").hexdigest()


def p_per_pack(pool_size: int, copies: int, slots: int) -> float:
    """Chance a named card with `copies` in `pool_size` shows up across `slots` draws."""
    miss = 1.0
    for i in range(slots):
        miss *= (pool_size - copies - i) / (pool_size - i)
    return 1.0 - miss


def copies_for(tier: str, pool: str, cards: int) -> int:
    """Copies of each card in `tier`: a fixed prime cap, or the pool divided up."""
    if tier in PRIME_CAPS:
        return PRIME_CAPS[tier]
    draws = PACKS * SLOTS[pool]
    if draws % cards:
        raise SystemExit(
            f"{tier}: {draws} {pool} draws do not divide across {cards} cards - "
            "pick a pack shape or a pack count that does"
        )
    return draws // cards


def resize(census: dict) -> dict:
    """Rewrite every supply number in `census` from PACKS and SLOTS. Mutates in place."""
    by_tier: dict[str, list[dict]] = {}
    for card in census["cards"]:
        by_tier.setdefault(card["tier"], []).append(card)

    copies: dict[str, int | None] = {}
    pool_size: dict[str, int] = {}
    for tier, meta in census["tiers"].items():
        pool = meta["pool"]
        if pool == "none":  # uncapped, outside the pull entirely
            copies[tier] = None
            continue
        copies[tier] = copies_for(tier, pool, len(by_tier[tier]))
        pool_size[pool] = pool_size.get(pool, 0) + copies[tier] * len(by_tier[tier])

    # Pools in pack order, so the census reads the way a pack is opened.
    pool_size = {pool: pool_size[pool] for pool in SLOTS if pool in pool_size}
    capped = sum(pool_size.values())
    for tier, meta in census["tiers"].items():
        cards = len(by_tier[tier])
        each = copies[tier]
        meta["cards"] = cards
        meta["copies_each"] = each
        meta["total_copies"] = None if each is None else each * cards
        if each is None:
            meta["share_of_mint"] = None
            meta["p_tier_per_pack"] = 1.0
        else:
            total = each * cards
            pool = meta["pool"]
            meta["share_of_mint"] = round(100 * total / capped, 4)
            meta["p_tier_per_pack"] = round(p_per_pack(pool_size[pool], total, SLOTS[pool]), 6)
        for card in by_tier[tier]:
            card["copies"] = each
            if each is None:
                card["p_per_pack"], card["one_in_packs"] = 1.0, 1
            else:
                p = p_per_pack(pool_size[meta["pool"]], each, SLOTS[meta["pool"]])
                card["p_per_pack"], card["one_in_packs"] = round(p, 8), round(1 / p)

    census["version"] = VERSION
    census["note"] = NOTE
    census["mint"] = {
        "packs": PACKS,
        "paid_cards_per_pack": sum(n for pool, n in SLOTS.items() if pool != "basic"),
        "cards_per_pack": sum(SLOTS.values()),
        "slots": dict(SLOTS),
        "capped_cards": capped,
        "pool_size": pool_size,
        # Printed deeper than the packs can reach. The prime pool is three caps
        # added together, so it lands where it lands; those copies exist in the
        # commitment and no buyer can ever draw one.
        "retired_tail": {pool: size - PACKS * SLOTS[pool] for pool, size in pool_size.items()},
    }
    for pool, tail in census["mint"]["retired_tail"].items():
        if tail < 0:
            raise SystemExit(f"{pool} pool is {-tail} copies short of {PACKS} packs")

    census["census_sha256"] = census_sha256(
        {card["id"]: card["copies"] for card in census["cards"] if card["copies"]}
    )
    return census


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--census", type=Path, default=CENSUS)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    census = resize(json.loads(args.census.read_text(encoding="utf-8")))
    out = args.out or args.census
    out.write_text(json.dumps(census, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    mint = census["mint"]
    print(f"wrote {out}")
    print(
        f"  {mint['packs']} packs of {mint['cards_per_pack']}, "
        f"{mint['paid_cards_per_pack']} of them numbered"
    )
    print(f"  {mint['capped_cards']} capped copies, pools {mint['pool_size']}")
    for tier, meta in census["tiers"].items():
        print(
            f"  {tier:9} {meta['cards']:3} cards x {meta['copies_each']} = {meta['total_copies']}"
        )
    print(f"  PUBLISH BEFORE SELLING - census sha256 = {census['census_sha256']}")


if __name__ == "__main__":
    main()
