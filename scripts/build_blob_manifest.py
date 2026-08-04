"""Hash a rendered card set for content-addressed publishing on Blossom.

Blossom addresses every blob by the SHA-256 of its bytes, so the digest *is* the
identifier: a server answers `GET /<sha256>` and any mirror holding the same bytes
answers identically. The same digest is what a NIP-94 file-metadata event carries
in its `x` tag, so one manifest covers both the upload and the event that points
at it.

The manifest is deliberately transport-agnostic. It records what each blob is and
what its hash is; which servers hold it and which events reference it are decided
at publish time, not here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
MIME = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg"}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    """Hash a file without loading it fully into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def blob_records(
    directory: Path, cards: list[dict[str, Any]], blossom_base: str | None
) -> list[dict[str, Any]]:
    """Describe every rendered face by content hash, joined back to its card."""
    by_name = {card["name"]: card for card in cards}
    records = []
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in MIME:
            continue
        card = by_name.get(path.stem)
        digest = sha256_file(path)
        record: dict[str, Any] = {
            "id": card["id"] if card else None,
            "name": path.stem,
            "file": path.name,
            "mime": MIME[path.suffix.lower()],
            "bytes": path.stat().st_size,
            "sha256": digest,
        }
        if card:
            record["card_type"] = card["card_type"]
            record["affinity"] = card["affinity"] or ["Neutral"]
            record["rarity"] = card["rarity"]
        if blossom_base:
            record["blossom"] = f"{blossom_base.rstrip('/')}/{digest}{path.suffix.lower()}"
        records.append(record)
    return records


def render_manifest(records: list[dict[str, Any]], source: Path) -> dict[str, Any]:
    """Wrap the records with the totals a publisher needs before uploading."""
    return {
        "set": "600B Timelock TCG — Edition One",
        "frame": "Node Runner",
        "source": source.name,
        "count": len(records),
        "total_bytes": sum(record["bytes"] for record in records),
        "unmatched": [record["name"] for record in records if record["id"] is None],
        "files": records,
    }


def nip94_events(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build unsigned NIP-94 file-metadata events, one per card.

    Kind 1063 carries the blob's `url`, `m` mime type, `x` SHA-256 and `size`.
    Signing is left to whatever holds the key; nothing here touches secrets.
    """
    events = []
    for record in records:
        if not record.get("blossom"):
            continue
        tags = [
            ["url", record["blossom"]],
            ["m", record["mime"]],
            ["x", record["sha256"]],
            ["size", str(record["bytes"])],
            ["alt", f"{record['name']} — 600B Timelock TCG card"],
        ]
        if record["id"]:
            tags.append(["d", record["id"]])
        events.append({"kind": 1063, "content": record["name"], "tags": tags})
    return events


def main() -> None:
    """Hash a rendered card directory and write its publishing manifest."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=REPO_ROOT / "art" / "cards" / "node-runner-web")
    parser.add_argument("--cards", type=Path, default=REPO_ROOT / "cards" / "e1-cards.json")
    parser.add_argument("--out", type=Path, default=None, help="default: <dir>/manifest.json")
    parser.add_argument(
        "--blossom-base", default=None, help="server base URL, e.g. https://blossom.example"
    )
    parser.add_argument(
        "--nip94",
        type=Path,
        default=None,
        help="also write unsigned NIP-94 events (requires --blossom-base)",
    )
    args = parser.parse_args()

    if not args.dir.is_dir():
        raise SystemExit(f"no rendered set at {args.dir} — run scripts/render_card_pngs.py first")

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    records = blob_records(args.dir, cards, args.blossom_base)
    if not records:
        raise SystemExit(f"no image files in {args.dir}")

    manifest = render_manifest(records, args.dir)
    out = args.out or args.dir / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"hashed {manifest['count']} files ({manifest['total_bytes'] / 1024 / 1024:.1f} MB)")
    print(f"wrote {out}")
    if manifest["unmatched"]:
        count = len(manifest["unmatched"])
        print(f"note: {count} file(s) matched no card, first: {manifest['unmatched'][0]}")

    if args.nip94:
        if not args.blossom_base:
            raise SystemExit("--nip94 needs --blossom-base to resolve each blob URL")
        events = nip94_events(records)
        args.nip94.write_text(
            json.dumps(events, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"wrote {args.nip94} with {len(events)} unsigned kind-1063 events")


if __name__ == "__main__":
    main()
