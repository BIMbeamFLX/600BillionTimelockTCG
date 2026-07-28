"""Emit a compact JSON batch of Edition One prompts whose raw art is missing."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SUPPORTED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def has_raw(raw_dir: Path, card_id: str) -> bool:
    """Return whether a generated source exists for one card."""
    return any((raw_dir / f"{card_id}{extension}").exists() for extension in SUPPORTED_EXTENSIONS)


def pending_cards(
    prompt_payload: dict[str, Any],
    raw_dir: Path,
    limit: int,
) -> list[dict[str, Any]]:
    """Return the next deterministic prompt batch."""
    pending = []
    for card in prompt_payload["cards"]:
        if has_raw(raw_dir, card["id"]):
            continue
        pending.append(
            {
                "id": card["id"],
                "name": card["name"],
                "prompt": card["prompt"],
                "references": [item["path"] for item in card["references"]],
            }
        )
        if len(pending) == limit:
            break
    return pending


def main() -> None:
    """Write one pending batch as JSON on stdout."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prompts",
        type=Path,
        default=repo_root / "art" / "prompts" / "e1-art-prompts.json",
    )
    parser.add_argument(
        "--raw",
        type=Path,
        default=repo_root / "art" / "generated" / "raw",
    )
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    payload = json.loads(args.prompts.read_text(encoding="utf-8"))
    batch = pending_cards(payload, args.raw, args.limit)
    sys.stdout.write(json.dumps(batch, ensure_ascii=False))


if __name__ == "__main__":
    main()
