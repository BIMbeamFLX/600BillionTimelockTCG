"""Build a NORD asset set for lnurl-mint from the rendered card faces.

The mint claims "the oldest still-queued asset of exactly `amount_msat`" when a mint
invoice settles (`NoteStore.claim_asset`), and `queue_asset` documents the queue as
"insertion order - a booster box, not a lottery". So a booster needs no new mint code:
price every card identically, shuffle the box before importing, and one payment pulls
the next card. Rarity is expressed by how many copies of each card are in the box,
exactly as a printed booster box works.

That leaves one honest problem: the operator chooses the order, so a buyer must take the
advertised odds on faith. This script closes that by emitting a commitment - the SHA-256
over the exact ordered box. Publish it before selling, reveal the set file once the box
is exhausted, and anyone can replay the order and check nothing was reshuffled.

Artwork is content-addressed: the sha256 comes from the render manifest and is the real
commitment, the Blossom URL only transport.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]

# Copies of each card in one box, by rarity. Commons are the floor of a set; rares are
# the reason to open another box.
DEFAULT_PRINT_RUN = {"common": 24, "uncommon": 8, "rare": 3, "promo": 1}


def mulberry32(seed: int):
    """The same seeded PRNG the card frame uses, so a box order is reproducible."""
    state = seed & 0xFFFFFFFF

    def next_float() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xFFFFFFFF
        t = (t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t ^= t >> 14
        return (t & 0xFFFFFFFF) / 4294967296

    return next_float


def shuffle(items: list[Any], seed: int) -> list[Any]:
    """Fisher-Yates with a seeded PRNG: the order is auditable from the seed alone."""
    out = list(items)
    rand = mulberry32(seed)
    for i in range(len(out) - 1, 0, -1):
        j = int(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def genesis_content(card: dict[str, Any]) -> dict[str, Any]:
    """The NORD genesis content for one card.

    Collection-defined schema, kept small because it is copied into every genesis
    event. Instances of the same card carry identical content and are distinguished
    by their genesis event id, so there are no printed serial numbers.
    """
    return {
        "set": "E1",
        "id": card["id"],
        "name": card["name"],
        "type": card["card_type"],
        "affinity": card["affinity"] or ["Neutral"],
        "rarity": card["rarity"],
    }


def build_box(
    cards: list[dict[str, Any]],
    faces: dict[str, dict[str, Any]],
    blossom_base: str,
    price_msat: int,
    print_run: dict[str, int],
    seed: int,
) -> list[dict[str, Any]]:
    """Expand the set into one entry per physical card, then shuffle the box."""
    box: list[dict[str, Any]] = []
    missing: list[str] = []
    for card in cards:
        face = faces.get(card["name"])
        if not face:
            missing.append(card["id"])
            continue
        copies = print_run.get(card["rarity"], 1)
        entry = {
            "content": genesis_content(card),
            "amount_msat": price_msat,
            "artwork_url": f"{blossom_base.rstrip('/')}/{face['sha256']}.webp",
            "artwork_sha256": face["sha256"],
            "collection": "600b",
        }
        box.extend(json.loads(json.dumps(entry)) for _ in range(copies))
    if missing:
        raise SystemExit(f"no rendered face for {len(missing)} card(s), first: {missing[0]}")
    return shuffle(box, seed)


def commitment(box: list[dict[str, Any]]) -> str:
    """SHA-256 over the exact ordered box. This is what you publish before selling."""
    digest = hashlib.sha256()
    for entry in box:
        digest.update(entry["artwork_sha256"].encode())
        digest.update(b"\x00")
    return digest.hexdigest()


def main() -> None:
    """Emit set.json for `python -m lnurl_mint.assets import`."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=REPO_ROOT / "cards" / "e1-cards.json")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=REPO_ROOT / "art" / "cards" / "node-runner-web" / "manifest.json",
    )
    parser.add_argument("--promos", type=Path, default=REPO_ROOT / "cards" / "promos.json")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "cards" / "e1-asset-set.json")
    parser.add_argument(
        "--blossom-base", required=True, help="server base URL, e.g. https://blossom.example"
    )
    parser.add_argument(
        "--price-msat",
        type=int,
        default=21000,
        help="price per card; MUST be identical across the box or the pull breaks (default 21000)",
    )
    parser.add_argument("--seed", type=int, default=600, help="box shuffle seed")
    parser.add_argument(
        "--print-run",
        default=None,
        help='override copies per rarity, e.g. \'{"common":24,"uncommon":8,"rare":3}\'',
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    if args.promos.exists():
        cards = cards + json.loads(args.promos.read_text(encoding="utf-8"))["cards"]
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    faces = {item["name"]: item for item in manifest["files"]}
    print_run = dict(DEFAULT_PRINT_RUN)
    if args.print_run:
        print_run.update(json.loads(args.print_run))

    box = build_box(cards, faces, args.blossom_base, args.price_msat, print_run, args.seed)
    args.out.write_text(
        json.dumps({"assets": box}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    by_rarity: dict[str, int] = {}
    for card in cards:
        by_rarity[card["rarity"]] = by_rarity.get(card["rarity"], 0) + 1
    print(f"wrote {args.out}")
    print(f"  {len(cards)} distinct cards -> {len(box)} physical cards in the box")
    for rarity, count in sorted(by_rarity.items()):
        copies = print_run.get(rarity, 1)
        print(f"    {rarity:9} {count:3} cards x {copies:2} copies = {count * copies:5}")
    total_sats = len(box) * args.price_msat // 1000
    print(f"  price {args.price_msat} msat/card -> full box {total_sats:,} sats")
    rare_copies = by_rarity.get("rare", 0) * print_run.get("rare", 1)
    print(f"  pull odds: rare {100 * rare_copies / len(box):.1f}%")
    print()
    print("  PUBLISH THIS BEFORE SELLING — it commits the box order:")
    print(f"    box-commitment sha256 = {commitment(box)}")
    print(f"    seed = {args.seed}  (reveal the set file once the box is exhausted)")


if __name__ == "__main__":
    main()
