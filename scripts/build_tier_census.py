"""Build the mint census — every card scored, tiered, capped and priced in odds.

Emits `cards/e1-tier-census.json` (what the mint commits to and the shop reads)
and `docs/e1-tier-census.md` (the same table, readable).

Rarity is not inherited from the historical reference set. Every card is scored on
three axes — market value, real playability, and reference rarity — and the tiers are
rank cuts on that score. A card that was common in 1993 but is expensive and played
today ends up scarce here, which is the point: we hold back the good cards regardless
of what they used to be.

Scores live in `cards/e1-card-scores.json`. The reference signals they came from stay
outside this repository (`rules/research-sources.md`); `--reference` regenerates them.
Weights below are the tunable part — change them and the tiers move.

Copies are lifetime caps, not per-box counts. The census hash is what the mint publishes
before the first sale; see `docs/handover/breno-mint-distribution.md`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "cards" / "e1-cards.json"
SCORES = ROOT / "cards" / "e1-card-scores.json"
OUT_JSON = ROOT / "cards" / "e1-tier-census.json"
OUT_MD = ROOT / "docs" / "e1-tier-census.md"

VERSION = "tier-census-r2"

# How much each axis counts. Value and playability lead; what the card used to be is a
# tiebreaker, not a verdict.
WEIGHTS = {"value": 0.40, "play": 0.40, "alpha": 0.20}

# Rank cuts on the composite score. `size` is how many cards land in the tier, in order.
# `pool` is which pack slot draws it. Sizes must sum to the number of scored cards.
# More Rares than Uncommons on purpose. With one slot per pack, the chance of a *named*
# card is driven by how many cards share that slot, so a fat Rare tier is what makes any
# single Rare hard to find. The 1993 reference had the same inverted shape for the same
# reason; here it falls out of wanting the ladder monotone rather than out of homage.
TIERS: list[dict] = [
    {"name": "Genesis", "size": 9, "pool": "prime"},
    {"name": "Vault", "size": 21, "pool": "prime"},
    {"name": "Rare", "size": 90, "pool": "prime"},
    {"name": "Uncommon", "size": 75, "pool": "uncommon"},
    {"name": "Common", "size": 90, "pool": "common"},
]

# Lifetime copies of each card, by tier. This is the whole scarcity design.
COPIES = {"Genesis": 21, "Vault": 63, "Rare": 216, "Uncommon": 279, "Common": 930}

# Paid slots per pack, plus one Basic Resource that is guaranteed, uncapped and free.
# A pack must never leave a player short of Resources, so that slot sits outside the pull.
SLOTS = {"common": 4, "uncommon": 1, "prime": 1}
BASIC_SLOT = 1


def composite(score: dict) -> float:
    """One number per card from the three axes."""
    return sum(WEIGHTS[axis] * score[axis] for axis in WEIGHTS)


def assign_tiers(scored: list[dict]) -> None:
    """Rank cut: sort by score, walk the tier sizes, stamp each card."""
    scored.sort(key=lambda c: (-c["score"], c["id"]))
    cut = 0
    for tier in TIERS:
        for card in scored[cut : cut + tier["size"]]:
            card["tier"] = tier["name"]
            card["pool"] = tier["pool"]
            card["copies"] = COPIES[tier["name"]]
        cut += tier["size"]
    if cut != len(scored):
        raise SystemExit(f"tier sizes sum to {cut}, but {len(scored)} cards are scored")


def solve_mint(rows: list[dict]) -> tuple[int, dict[str, int], dict[str, int]]:
    """How many whole packs the caps actually support, and what is left over.

    Each pool has to cover `slots` cards per pack. The mint can only sell as many packs
    as its tightest pool allows; the remainder is the retired tail, never sold.
    """
    pool_size = {name: sum(r["copies"] for r in rows if r["pool"] == name) for name in SLOTS}
    packs = min(pool_size[name] // SLOTS[name] for name in SLOTS)
    retired = {name: pool_size[name] - packs * SLOTS[name] for name in SLOTS}
    return packs, pool_size, retired


def census_hash(counts: dict[str, int]) -> str:
    """SHA-256 over the canonical counts — what the mint commits to before selling.

    Counts only, never an order: the order is drawn from a beacon at open time.
    """
    digest = hashlib.sha256()
    digest.update(json.dumps(counts, separators=(",", ":"), sort_keys=True).encode())
    digest.update(b"\x00")
    return digest.hexdigest()


def build(cards: list[dict], scores: dict) -> dict:
    """The whole census: scores, tiers, caps, pools, per-card odds."""
    by_id = {c["id"]: c for c in cards}
    scored = [
        {
            "id": cid,
            **{a: s[a] for a in WEIGHTS},
            "score": round(composite(s), 4),
            "source_slot": s["source_slot"],
        }
        for cid, s in scores["scores"].items()
    ]
    assign_tiers(scored)
    packs, pool_size, retired = solve_mint(scored)

    rows = []
    for rank, card in enumerate(scored, 1):
        base = by_id[card["id"]]
        p = SLOTS[card["pool"]] * card["copies"] / pool_size[card["pool"]]
        rows.append(
            {
                "rank": rank,
                "id": card["id"],
                "name": base["name"],
                "type_line": base.get("type_line", ""),
                "affinity": base.get("affinity", []),
                "cost": base.get("cost", ""),
                "current_rarity": base["rarity"],
                "tier": card["tier"],
                "pool": card["pool"],
                "copies": card["copies"],
                "score": card["score"],
                "axes": {a: card[a] for a in WEIGHTS},
                "p_per_pack": round(p, 8),
                "one_in_packs": round(1 / p),
                "source_slot": card["source_slot"],
            }
        )

    # Basic Resources are not scored, not capped and not pulled — one comes free per pack.
    scored_ids = {r["id"] for r in rows}
    for base in cards:
        if base["id"] in scored_ids:
            continue
        rows.append(
            {
                "rank": None,
                "id": base["id"],
                "name": base["name"],
                "type_line": base.get("type_line", ""),
                "affinity": base.get("affinity", []),
                "cost": base.get("cost", ""),
                "current_rarity": base["rarity"],
                "tier": "Basic",
                "pool": "none",
                "copies": None,
                "score": None,
                "axes": None,
                "p_per_pack": 1.0,
                "one_in_packs": 1,
                "source_slot": base["source_slot"],
            }
        )

    total = sum(pool_size.values())
    tiers = {}
    for tier in TIERS:
        members = [r for r in rows if r["tier"] == tier["name"]]
        copies = COPIES[tier["name"]]
        tiers[tier["name"]] = {
            "cards": len(members),
            "copies_each": copies,
            "total_copies": copies * len(members),
            "pool": tier["pool"],
            "share_of_mint": round(100 * copies * len(members) / total, 4),
            "p_tier_per_pack": round(
                1 - (1 - copies * len(members) / pool_size[tier["pool"]]) ** SLOTS[tier["pool"]],
                6,
            ),
            "score_range": [members[-1]["score"], members[0]["score"]],
        }
    basics = [r for r in rows if r["tier"] == "Basic"]
    tiers["Basic"] = {
        "cards": len(basics),
        "copies_each": None,
        "total_copies": None,
        "pool": "none",
        "share_of_mint": None,
        "p_tier_per_pack": 1.0,
        "score_range": None,
    }

    counts = {r["id"]: r["copies"] for r in sorted(rows, key=lambda r: r["id"]) if r["copies"]}
    return {
        "set": "600B-E1",
        "version": VERSION,
        "note": "Proposal. Not locked, not minted. See docs/rarity-and-booster-plan.md.",
        "weights": WEIGHTS,
        "mint": {
            "packs": packs,
            "paid_cards_per_pack": sum(SLOTS.values()),
            "cards_per_pack": sum(SLOTS.values()) + BASIC_SLOT,
            "slots": {**SLOTS, "basic": BASIC_SLOT},
            "capped_cards": total,
            "pool_size": pool_size,
            "retired_tail": retired,
        },
        "tiers": tiers,
        "pools": {n: [r["id"] for r in rows if r["pool"] == n] for n in SLOTS},
        "census_sha256": census_hash(counts),
        "cards": rows,
    }


def render_md(data: dict) -> str:
    """The same census as a document someone can read without a JSON viewer."""
    m, w, out = data["mint"], data["weights"], []
    out.append("# E1 tier census\n")
    out.append("Generated by `scripts/build_tier_census.py` — do not edit by hand.\n")
    out.append(f"{data['note']}\n")
    out.append(
        f"**{len(data['cards'])} cards · {m['capped_cards']:,} capped copies · "
        f"{m['packs']:,} packs**\n"
    )
    out.append(
        f"Pack = {m['paid_cards_per_pack']} paid ({m['slots']['common']} Common + "
        f"{m['slots']['uncommon']} Uncommon + {m['slots']['prime']} Prime) + "
        f"{m['slots']['basic']} Basic Resource, guaranteed and free — "
        f"**{m['cards_per_pack']} cards in the wrapper**.\n"
    )
    out.append(
        f"Tiers are rank cuts on a score of value {w['value']}, playability {w['play']}, "
        f"reference rarity {w['alpha']}. Historical rarity is an input, not a verdict.\n"
    )
    out.append(f"Census SHA-256: `{data['census_sha256']}`\n")
    tail = ", ".join(f"{v:,} {k}" for k, v in m["retired_tail"].items() if v)
    out.append(f"Retired tail, minted but never sold: {tail or 'none'}.\n")

    out.append("## Tiers\n")
    out.append("| tier | cards | copies each | total | share of mint | P(tier in a pack) | score |")
    out.append("|---|---|---|---|---|---|---|")
    for name, t in data["tiers"].items():
        if t["copies_each"] is None:
            out.append(f"| {name} | {t['cards']} | uncapped | — | — | 100% guaranteed | — |")
            continue
        lo, hi = t["score_range"]
        out.append(
            f"| {name} | {t['cards']} | {t['copies_each']} | {t['total_copies']:,} | "
            f"{t['share_of_mint']:.2f}% | {100 * t['p_tier_per_pack']:.4f}% | {lo:.3f}–{hi:.3f} |"
        )

    for name in data["tiers"]:
        members = [c for c in data["cards"] if c["tier"] == name]
        members.sort(key=lambda c: c["rank"] if c["rank"] else 999)
        t = data["tiers"][name]
        head = (
            f"{t['cards']} cards, uncapped and free, one guaranteed in every pack"
            if t["copies_each"] is None
            else f"{t['cards']} cards · {t['copies_each']} copies each · "
            f"1 in {members[0]['one_in_packs']:,} packs"
        )
        out.append(f"\n## {name}\n\n{head}\n")
        out.append(
            "| # | id | name | type | cost | copies | P per pack | 1 in | score | "
            "value | play | ref | was |"
        )
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for c in members:
            a = c["axes"] or {}
            score = format(c["score"], ".3f") if c["score"] else "—"
            value = format(a["value"], ".2f") if a else "—"
            play = format(a["play"], ".2f") if a else "—"
            ref = format(a["alpha"], ".1f") if a else "—"
            out.append(
                f"| {c['rank'] or '—'} | `{c['id']}` | {c['name']} | {c['type_line']} | "
                f"{c['cost'] or '—'} | {c['copies'] or '∞'} | {100 * c['p_per_pack']:.4f}% | "
                f"{c['one_in_packs']:,} | {score} | {value} | {play} | {ref} | "
                f"{c['current_rarity']} |"
            )
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=CARDS)
    parser.add_argument("--scores", type=Path, default=SCORES)
    parser.add_argument("--json", type=Path, default=OUT_JSON)
    parser.add_argument("--md", type=Path, default=OUT_MD)
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    scores = json.loads(args.scores.read_text(encoding="utf-8"))
    data = build(cards, scores)
    args.json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.md.write_text(render_md(data), encoding="utf-8")

    m = data["mint"]
    print(f"{len(data['cards'])} cards -> {args.json.relative_to(ROOT)}")
    print(f"{'':13} -> {args.md.relative_to(ROOT)}")
    print(
        f"  pack {m['cards_per_pack']} cards ({m['paid_cards_per_pack']} paid + 1 Basic), "
        f"{m['packs']:,} packs, {m['capped_cards']:,} capped copies"
    )
    for name, t in data["tiers"].items():
        if t["copies_each"] is None:
            print(f"  {name:9} {t['cards']:>3} cards x uncapped")
            continue
        one_in = next(c["one_in_packs"] for c in data["cards"] if c["tier"] == name)
        print(
            f"  {name:9} {t['cards']:>3} cards x {t['copies_each']:>4} copies  "
            f"named card 1 in {one_in:,} packs"
        )
    print(f"  retired tail {m['retired_tail']}")
    print(f"  census sha256 {data['census_sha256']}")


if __name__ == "__main__":
    main()
