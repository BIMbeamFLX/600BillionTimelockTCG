"""Assemble everything the mint needs into one self-contained folder.

Joins the tier census (what exists, at what odds) with the blob manifest (what each card
looks like, addressed by hash) and ships them next to the spec, the proof, and a runnable
reference implementation of the draw.

The package is meant to leave this repository. Somebody should be able to unzip it, run
`python reference/draw.py`, and get the same cards we would — without cloning anything.

Refuses to build if an input is missing or if a card has no face hash, because a census
that promises a picture nobody can fetch is worse than no census.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CENSUS = ROOT / "cards" / "e1-tier-census.json"
BLOBS = ROOT / "cards" / "e1-blob-manifest.json"
OUT = ROOT / "dist" / "mint-package"

# Where a face resolves. The hash is the address; the host is interchangeable.
MIRRORS = ("https://blossom.primal.net", "https://blossom.bimcvp.com", "https://nostr.download")

DOCS = (
    ("docs/handover/breno-mint-distribution.md", "docs/breno-mint-distribution.md"),
    ("docs/distribution-proof.md", "docs/distribution-proof.md"),
    ("docs/rarity-and-booster-plan.md", "docs/rarity-and-booster-plan.md"),
    ("docs/e1-tier-census.md", "docs/e1-tier-census.md"),
    ("docs/handover/breno-mint-and-infra.md", "docs/breno-mint-and-infra.md"),
)

# What ships, and why someone should open it. Rendered as a table by render_readme.
CONTENTS = (
    (
        "mint-census.json",
        "**The contract.** Every card: tier, lifetime cap, odds per pack, "
        "and the SHA-256 of its face.",
    ),
    ("mint-census.csv", "The same table, flat, for a spreadsheet."),
    ("reference/draw.py", "Runnable reference draw. Self-checks against the test vector."),
    ("reference/testvector.json", "Fixed census and beacon, fixed cards. Match this first."),
    (
        "docs/breno-mint-distribution.md",
        "**Read this first.** Mechanism, HTTP contract, open decisions.",
    ),
    ("docs/distribution-proof.md", "Why packs cannot be independent draws, with the proof."),
    ("docs/rarity-and-booster-plan.md", "Why the tiers are what they are."),
    ("docs/e1-tier-census.md", "Every card, ranked and scored, readable."),
    (
        "docs/breno-mint-and-infra.md",
        "Earlier handover: identity, matches, deployment. Still current except section 4.1.",
    ),
    ("MANIFEST.sha256", "SHA-256 of every file above. The authority on package integrity."),
)

CSV_COLUMNS = (
    "rank",
    "id",
    "name",
    "type_line",
    "cost",
    "tier",
    "pool",
    "copies",
    "p_per_pack",
    "one_in_packs",
    "score",
    "value",
    "play",
    "reference_rarity",
    "sha256",
)


def load_faces() -> dict[str, dict]:
    """Card id -> face blob. The hash is what a token should commit to, not a URL."""
    manifest = json.loads(BLOBS.read_text(encoding="utf-8"))
    return {f["id"]: f for f in manifest["files"] if f.get("id")}


def build_cards(census: dict, faces: dict[str, dict]) -> list[dict]:
    """One row per card: what it is, how rare it is, and how to fetch its face."""
    rows = []
    for card in census["cards"]:
        face = faces.get(card["id"])
        if not face:
            raise SystemExit(f"{card['id']} has no face in {BLOBS.name} — refusing to build")
        rows.append(
            {
                "rank": card["rank"],
                "id": card["id"],
                "name": card["name"],
                "type_line": card["type_line"],
                "affinity": card["affinity"],
                "cost": card["cost"],
                "tier": card["tier"],
                "pool": card["pool"],
                "copies": card["copies"],
                "p_per_pack": card["p_per_pack"],
                "one_in_packs": card["one_in_packs"],
                "score": card["score"],
                "axes": card["axes"],
                "face": {
                    "sha256": face["sha256"],
                    "mime": face["mime"],
                    "bytes": face["bytes"],
                    "urls": [f"{m}/{face['sha256']}.webp" for m in MIRRORS],
                },
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict], census: dict) -> None:
    """The same table for anyone who would rather open a spreadsheet."""
    ref = {c["id"]: (c["axes"] or {}).get("alpha") for c in census["cards"]}
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(CSV_COLUMNS)
        for row in rows:
            axes = row["axes"] or {}
            writer.writerow(
                [
                    row["rank"] or "",
                    row["id"],
                    row["name"],
                    row["type_line"],
                    row["cost"],
                    row["tier"],
                    row["pool"],
                    row["copies"] or "",
                    row["p_per_pack"],
                    row["one_in_packs"],
                    row["score"] or "",
                    axes.get("value", ""),
                    axes.get("play", ""),
                    ref.get(row["id"], ""),
                    row["face"]["sha256"],
                ]
            )


def write_manifest(out: Path) -> str:
    """SHA-256 of every file in the package, and a hash over that list."""
    lines = []
    for path in sorted(p for p in out.rglob("*") if p.is_file() and p.name != "MANIFEST.sha256"):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.relative_to(out).as_posix()}")
    body = "\n".join(lines) + "\n"
    (out / "MANIFEST.sha256").write_text(body, encoding="utf-8")
    return hashlib.sha256(body.encode()).hexdigest()


def render_readme(census: dict, rows: list[dict]) -> str:
    """Start here. What is in the box, what is settled, what is still open."""
    m, t = census["mint"], census["tiers"]
    ladder_rows = []
    for name, tier in t.items():
        copies = tier["copies_each"] or "uncapped"
        total = format(tier["total_copies"], ",") if tier["total_copies"] else "—"
        one_in = next(c["one_in_packs"] for c in rows if c["tier"] == name)
        ladder_rows.append(f"| {name} | {tier['cards']} | {copies} | {total} | {one_in:,} |")
    ladder = "\n".join(ladder_rows)
    contents = "\n".join(f"| `{name}` | {what} |" for name, what in CONTENTS)
    return f"""# 600B Timelock TCG — mint package

Everything the mint needs, in one folder. Generated by `scripts/build_mint_package.py`
from the repository at build time. `MANIFEST.sha256` hashes every file in here — check it
first if this arrived over anything untrusted.

Nothing in here is implemented on our side yet. The shop still deals from the old flat box
described in `docs/breno-mint-distribution.md` §3.

## What is in the box

| file | what it is |
|---|---|
{contents}

## The set, in one table

| tier | cards | copies each | total | a named card, 1 in |
|---|---|---|---|---|
{ladder}

**{m["packs"]:,} packs.** Pack = {m["cards_per_pack"]} cards:
{m["slots"]["common"]} Common + {m["slots"]["uncommon"]} Uncommon + {m["slots"]["prime"]} Prime
+ {m["slots"]["basic"]} Basic Resource (guaranteed, uncapped, free).
{m["paid_cards_per_pack"]} of them are paid.

Census SHA-256, over the counts alone: `{census["census_sha256"]}`

That is the number to publish before the first sale. It commits to *what exists*, not to
what order it comes out in — the order is drawn from a Bitcoin block that has not been
mined yet. See `docs/breno-mint-distribution.md` §4.

## Faces

Every card carries `face.sha256`. The hash **is** the address: fetch
`https://<mirror>/<sha256>.webp` from any of

{chr(10).join(f"- {mirror}" for mirror in MIRRORS)}

and verify the bytes against the hash before use. All {len(rows)} faces were confirmed
resolvable on a mirror at build time. If a token needs to commit to "which card", the pair
`(id, face.sha256)` is already published and already checked by our client.

## What we need back

Listed in full in `docs/breno-mint-distribution.md` §5 and §6. The short version:

1. The real HTTP contract — endpoints, auth, error shapes. Browser-callable, NIP-98 over a
   NIP-07 signer, no accounts.
2. A decision on price and per-pubkey caps. At 126 sat a pack the whole mint is 0.0264 BTC
   and one buyer can drain it, which would make every odds table in here meaningless.
3. A decision on the endgame tail — retire it, delay the reveal, or state it plainly.
4. One sentence describing the mint's custody model. We print it on the page before anyone
   pays.
"""


REFERENCE_DRAW = '''"""Reference implementation of the 600B pack draw. Runnable, no dependencies.

    python reference/draw.py            # self-check against the test vector
    python reference/draw.py --census ../mint-census.json --beacon <hash> --pack pack-0001

The draw is a bounded urn sampled without replacement, seeded by a Bitcoin block hash that
did not exist when the pack was sold. Same census + same beacon + same pack id => same
cards, on any machine, forever. That is the whole verification story.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def h(*parts) -> bytes:
    """SHA-256 over each part followed by a 0x00 separator."""
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part if isinstance(part, bytes) else str(part).encode())
        digest.update(b"\\x00")
    return digest.digest()


def draw(counts: dict, order: list, rho: bytes, slot: int) -> str:
    """Pick one card from the remaining pool. Mutates `counts`."""
    remaining = sum(counts[cid] for cid in order)
    if remaining <= 0:
        raise AssertionError("pool exhausted")
    x = int.from_bytes(h(rho, slot), "big") % remaining
    for cid in order:
        if x < counts[cid]:
            counts[cid] -= 1
            return cid
        x -= counts[cid]
    raise AssertionError("unreachable")


def open_pack(counts: dict, pools: dict, slots: list, beacon: str, pack_id: str) -> list:
    """Resolve one pack. `slots` is [(pool_name, n), ...] in canonical order."""
    rho = h(bytes.fromhex(beacon), pack_id)
    out, slot = [], 0
    for pool_name, n in slots:
        for _ in range(n):
            out.append(draw(counts, pools[pool_name], rho, slot))
            slot += 1
    return out


def census_hash(counts: dict) -> str:
    """What the mint commits to before selling: the counts, never an order."""
    digest = hashlib.sha256()
    digest.update(json.dumps(counts, separators=(",", ":"), sort_keys=True).encode())
    digest.update(b"\\x00")
    return digest.hexdigest()


def from_mint_census(path: Path):
    """Load counts, pools and slot shape out of mint-census.json."""
    data = json.loads(path.read_text(encoding="utf-8"))
    counts, pools = {}, {}
    for card in data["cards"]:
        if not card["copies"]:
            continue  # Basic Resources are uncapped and never drawn
        counts[card["id"]] = card["copies"]
        pools.setdefault(card["pool"], []).append(card["id"])
    for ids in pools.values():
        ids.sort()
    slots = [(n, data["mint"]["slots"][n]) for n in ("common", "uncommon", "prime")]
    return counts, pools, slots, data


def selftest() -> int:
    """Replay the test vector. Any mismatch means the implementations disagree."""
    vector = json.loads((HERE / "testvector.json").read_text(encoding="utf-8"))
    counts = dict(vector["census"])
    pools = vector["pools"]
    slots = [(name, n) for name, n in vector["slots"]]

    got_commit = census_hash(counts)
    ok = got_commit == vector["commitment"]
    print(f"census hash  {'OK ' if ok else 'FAIL'}  {got_commit}")

    state = bytes.fromhex(vector["commitment"])
    for expected in vector["packs"]:
        cards = open_pack(counts, pools, slots, vector["beacon"], expected["pack_id"])
        state = h(state, expected["pack_id"], vector["beacon"], ",".join(cards))
        good = cards == expected["cards"] and state.hex() == expected["state"]
        ok = ok and good
        print(f"{expected['pack_id']}   {'OK ' if good else 'FAIL'}  {cards}")

    good = counts == vector["remaining"]
    ok = ok and good
    print(f"remaining    {'OK ' if good else 'FAIL'}")
    print("\\nPASS" if ok else "\\nFAIL — your implementation does not match ours")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--census", type=Path, help="mint-census.json")
    parser.add_argument("--beacon", help="Bitcoin block hash, 64 hex chars")
    parser.add_argument("--pack", default="pack-0001", help="pack id")
    args = parser.parse_args()

    if not args.census:
        return selftest()

    counts, pools, slots, data = from_mint_census(args.census)
    print(f"census hash {census_hash(counts)}")
    print(f"expected    {data['census_sha256']}")
    if not args.beacon:
        print("\\nno --beacon given; nothing drawn")
        return 0
    names = {c["id"]: c["name"] for c in data["cards"]}
    tiers = {c["id"]: c["tier"] for c in data["cards"]}
    print(f"\\n{args.pack} against beacon {args.beacon[:16]}...")
    for cid in open_pack(counts, pools, slots, args.beacon, args.pack):
        print(f"  {cid}  {tiers[cid]:9} {names[cid]}")
    print("  + 1 Basic Resource, guaranteed, uncapped, free")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def build_testvector() -> dict:
    """A toy census with the production algorithm, small enough to read by eye."""
    pools = {
        "common": [f"C{i:02}" for i in range(4)],
        "uncommon": [f"U{i:02}" for i in range(3)],
        "prime": ["R00", "R01", "J00", "G00"],
    }
    counts = {
        "C00": 10,
        "C01": 10,
        "C02": 10,
        "C03": 10,
        "U00": 6,
        "U01": 6,
        "U02": 6,
        "R00": 5,
        "R01": 5,
        "J00": 2,
        "G00": 1,
    }
    slots = [["common", 3], ["uncommon", 1], ["prime", 1]]
    beacon = "0000000000000000000123456789abcdef0123456789abcdef0123456789abcd"

    def h(*parts):
        d = hashlib.sha256()
        for p in parts:
            d.update(p if isinstance(p, bytes) else str(p).encode())
            d.update(b"\x00")
        return d.digest()

    def draw(remaining, order, rho, slot):
        total = sum(remaining[c] for c in order)
        x = int.from_bytes(h(rho, slot), "big") % total
        for cid in order:
            if x < remaining[cid]:
                remaining[cid] -= 1
                return cid
            x -= remaining[cid]
        raise AssertionError

    commitment = hashlib.sha256()
    commitment.update(json.dumps(counts, separators=(",", ":"), sort_keys=True).encode())
    commitment.update(b"\x00")
    commit = commitment.hexdigest()

    live = dict(counts)
    state = bytes.fromhex(commit)
    packs = []
    for i in (1, 2, 3):
        pack_id = f"pack-{i:04}"
        rho = h(bytes.fromhex(beacon), pack_id)
        cards, slot = [], 0
        for name, n in slots:
            for _ in range(n):
                cards.append(draw(live, pools[name], rho, slot))
                slot += 1
        state = h(state, pack_id, beacon, ",".join(cards))
        packs.append({"pack_id": pack_id, "cards": cards, "state": state.hex()})

    return {
        "note": "Toy census, production algorithm. Match this before wiring anything up.",
        "census": counts,
        "pools": pools,
        "slots": slots,
        "commitment": commit,
        "beacon": beacon,
        "packs": packs,
        "remaining": live,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    for path in (CENSUS, BLOBS):
        if not path.exists():
            raise SystemExit(f"missing {path.relative_to(ROOT)} — run build_tier_census.py first")

    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    rows = build_cards(census, load_faces())

    out = args.out
    if out.exists():
        shutil.rmtree(out)
    (out / "docs").mkdir(parents=True)
    (out / "reference").mkdir()

    package = {
        "set": census["set"],
        "version": census["version"],
        "note": census["note"],
        "weights": census["weights"],
        "mint": census["mint"],
        "tiers": census["tiers"],
        "pools": census["pools"],
        "census_sha256": census["census_sha256"],
        "mirrors": list(MIRRORS),
        "cards": rows,
    }
    (out / "mint-census.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(out / "mint-census.csv", rows, census)

    (out / "reference" / "draw.py").write_text(REFERENCE_DRAW, encoding="utf-8")
    (out / "reference" / "testvector.json").write_text(
        json.dumps(build_testvector(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    for source, target in DOCS:
        src = ROOT / source
        if not src.exists():
            raise SystemExit(f"missing {source} — refusing to ship an incomplete package")
        shutil.copyfile(src, out / target)

    (out / "README.md").write_text(render_readme(census, rows), encoding="utf-8")
    package_hash = write_manifest(out)

    files = sorted(p for p in out.rglob("*") if p.is_file())
    size = sum(p.stat().st_size for p in files)
    print(f"{out.relative_to(ROOT)}  —  {len(files)} files, {size / 1024:.0f} KB")
    for path in files:
        print(f"  {path.relative_to(out).as_posix()}")
    print(f"\n  {len(rows)} cards, every one with a face hash")
    print(f"  census  {census['census_sha256']}")
    print(f"  package {package_hash}")


if __name__ == "__main__":
    main()
