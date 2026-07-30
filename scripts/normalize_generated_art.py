"""Normalize generated Edition One art to the locked 1920x2400 JPEG standard."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

from brand_watermark import (
    WATERMARK_MARGIN_RATIO,
    WATERMARK_OPACITY,
    WATERMARK_WIDTH_RATIO,
    paste_subtle_watermark,
)
from PIL import Image, ImageOps

log = logging.getLogger("normalize_generated_art")

ART_WIDTH = 1920
ART_HEIGHT = 2400
ART_FORMAT_VERSION = "600B-E1-art-1920x2400-v1"
SUPPORTED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def file_sha256(path: Path) -> str:
    """Hash one generated or normalized image."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_raw(raw_dir: Path, card_id: str) -> Path | None:
    """Find one generated source without assuming its codec."""
    for extension in SUPPORTED_EXTENSIONS:
        candidate = raw_dir / f"{card_id}{extension}"
        if candidate.exists():
            return candidate
    return None


def center_crop_box(width: int, height: int) -> tuple[int, int, int, int]:
    """Return the largest centered 4:5 portrait crop."""
    target_ratio = ART_WIDTH / ART_HEIGHT
    current_ratio = width / height
    if current_ratio > target_ratio:
        crop_width = round(height * target_ratio)
        left = (width - crop_width) // 2
        return left, 0, left + crop_width, height
    crop_height = round(width / target_ratio)
    top = (height - crop_height) // 2
    return 0, top, width, top + crop_height


def record_decisions(
    db_path: Path,
    prompt_cards: list[dict[str, Any]],
    raw_dir: Path,
    output_dir: Path,
) -> None:
    """Record the normalization batch before image files are written."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS art_normalization_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                format_version TEXT NOT NULL,
                raw_directory TEXT NOT NULL,
                output_directory TEXT NOT NULL,
                output_size TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM art_normalization_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO art_normalization_decisions (
                card_id, public_name, format_version, raw_directory,
                output_directory, output_size, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card["id"],
                    card["name"],
                    ART_FORMAT_VERSION,
                    str(raw_dir),
                    str(output_dir),
                    json.dumps([ART_WIDTH, ART_HEIGHT]),
                    "planned",
                    "normalize generated key art to locked Full-HD portrait standard",
                    "auto:codex:e1-art-normalize",
                )
                for card in prompt_cards
            ],
        )
        connection.commit()


def normalize_one(
    source: Path,
    output: Path,
    *,
    watermark_logo: Image.Image | None = None,
) -> dict[str, Any]:
    """Crop and resize one generated image, optionally adding the official watermark."""
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        original_size = list(image.size)
        crop_box = center_crop_box(*image.size)
        image = image.crop(crop_box)
        image = image.resize((ART_WIDTH, ART_HEIGHT), Image.Resampling.LANCZOS)
        watermark_box = None
        if watermark_logo is not None:
            watermark_box = paste_subtle_watermark(image, watermark_logo)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, "JPEG", quality=95, optimize=True, progressive=True)
    result = {
        "source_file": source.as_posix(),
        "source_size": original_size,
        "source_sha256": file_sha256(source),
        "crop_box": list(crop_box),
        "file": output.name,
        "size": [ART_WIDTH, ART_HEIGHT],
        "sha256": file_sha256(output),
        "status": "art-locked",
    }
    if watermark_box is not None:
        result["watermark"] = {
            "asset": "art/brand/600B-logo-primary.png",
            "placement": "bottom-right",
            "box": list(watermark_box),
            "width_ratio": WATERMARK_WIDTH_RATIO,
            "margin_ratio": WATERMARK_MARGIN_RATIO,
            "opacity": WATERMARK_OPACITY,
        }
        result["status"] = "art-locked-watermarked"
    return result


def main() -> None:
    """Normalize every available raw image and optionally require the full set."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
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
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "illustrations",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Normalize available files without requiring all 295.",
    )
    args = parser.parse_args()

    prompt_payload = json.loads(args.prompts.read_text(encoding="utf-8"))
    prompt_cards = prompt_payload["cards"]
    record_decisions(args.audit_db, prompt_cards, args.raw, args.out)

    files = []
    missing = []
    for card in prompt_cards:
        source = find_raw(args.raw, card["id"])
        if source is None:
            missing.append(card["id"])
            continue
        output = args.out / f"{card['id']}.jpg"
        item = normalize_one(source, output)
        item.update(
            {
                "id": card["id"],
                "name": card["name"],
                "prompt_sha256": card["prompt_sha256"],
            }
        )
        files.append(item)
        log.info("normalized %s", card["id"])

    if missing and not args.allow_partial:
        raise ValueError(f"missing {len(missing)} raw artworks: {missing}")

    manifest = {
        "phase": "standalone-artwork-lock",
        "format_version": ART_FORMAT_VERSION,
        "card_count": len(files),
        "required_card_count": len(prompt_cards),
        "required_size": [ART_WIDTH, ART_HEIGHT],
        "aspect_ratio": "4:5 portrait",
        "card_frames_included": False,
        "procedural_patterns": False,
        "character_identity_source": "join.600.wtf Detailed ·front",
        "missing_count": len(missing),
        "missing_ids": missing,
        "files": files,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info(
        "art normalization: %d ready, %d missing at %dx%d",
        len(files),
        len(missing),
        ART_WIDTH,
        ART_HEIGHT,
    )


if __name__ == "__main__":
    main()
