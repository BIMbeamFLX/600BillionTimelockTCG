"""Build a derived art set with the canonical 600 000 000 000 mark."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import shutil
import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("normalize_sacred_number_art")

CANONICAL_VALUE = "600 000 000 000"
CANONICAL_LINES = ("600", "000", "000", "000")
SUPPORTED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


@dataclass(frozen=True)
class Overlay:
    """One deterministic brand overlay in source-image coordinates."""

    kind: str
    center: tuple[int, int]
    size: tuple[int, int]
    angle: float = 0.0
    filled: bool = False


OVERLAYS: dict[str, tuple[Overlay, ...]] = {
    "E1-003": (Overlay("circle", (536, 420), (72, 72)),),
    "E1-034": (Overlay("grid", (565, 204), (68, 82), filled=True),),
    "E1-051": (Overlay("circle", (638, 454), (86, 86)),),
    "E1-071": (
        Overlay("grid", (473, 456), (47, 72), filled=True),
        Overlay("grid", (331, 570), (70, 103), angle=2.0, filled=True),
    ),
    "E1-081": (
        Overlay("circle", (451, 575), (76, 76)),
        Overlay("grid", (835, 518), (86, 112), angle=-8.0),
    ),
    "E1-091": (Overlay("circle", (607, 368), (98, 98)),),
    "E1-095": (Overlay("grid", (421, 470), (48, 72), filled=True),),
    "E1-106": (Overlay("mask", (553, 224), (96, 130)),),
    "E1-120": (Overlay("mask", (642, 256), (102, 132), angle=-20.0),),
    "E1-124": (Overlay("circle", (505, 465), (82, 82)),),
    "E1-128": (Overlay("mask", (548, 228), (108, 136)),),
    "E1-151": (Overlay("circle", (510, 370), (82, 82)),),
    "E1-161": (Overlay("circle", (570, 390), (86, 86)),),
    "E1-192": (Overlay("circle", (520, 335), (86, 86)),),
    "E1-198": (
        Overlay("circle", (596, 344), (92, 92)),
        Overlay("circle", (862, 352), (82, 82)),
        Overlay("circle", (953, 1121), (88, 88)),
        Overlay("circle", (1073, 1140), (82, 82)),
        Overlay("circle", (1022, 1215), (88, 88)),
    ),
    "E1-225": (Overlay("circle", (600, 335), (84, 84)),),
    "E1-256": (Overlay("circle", (630, 450), (88, 88)),),
    "E1-268": (Overlay("circle", (560, 440), (86, 86)),),
}


def file_sha256(path: Path) -> str:
    """Return the SHA-256 digest for one file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prompt_cards(path: Path) -> list[dict[str, Any]]:
    """Read either the prompts-v2 catalog or the locked art-director catalog."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    cards = payload.get("prompts") or payload.get("cards")
    if not isinstance(cards, list):
        raise ValueError(f"{path} does not contain a prompt card list")
    return cards


def find_image(directory: Path, card_id: str) -> Path | None:
    """Find an image for one card without assuming its codec."""
    for suffix in SUPPORTED_EXTENSIONS:
        candidate = directory / f"{card_id}{suffix}"
        if candidate.exists():
            return candidate
    return None


def select_source(
    card_id: str,
    raw_dir: Path,
    reframed_dir: Path,
    cleaned_dir: Path,
) -> Path:
    """Select the most-derived immutable source available for a card."""
    for directory in (cleaned_dir, reframed_dir, raw_dir):
        source = find_image(directory, card_id)
        if source is not None:
            return source
    raise FileNotFoundError(f"missing source artwork for {card_id}")


def render_grid_badge(
    size: tuple[int, int],
    font_path: Path,
    *,
    filled: bool,
    mask: bool = False,
) -> Image.Image:
    """Render the exact canonical four-line number grid."""
    width, height = size
    badge = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)
    if mask:
        inset = max(2, min(width, height) // 30)
        points = (
            (inset, inset),
            (width - inset - 1, inset),
            (round(width * 0.78), height - inset - 1),
            (round(width * 0.5), height - 1),
            (round(width * 0.22), height - inset - 1),
        )
        draw.polygon(points, fill=(18, 17, 18, 246))
        draw.line(
            (*points, points[0]),
            fill=(245, 139, 25, 250),
            width=max(1, min(width, height) // 36),
            joint="curve",
        )
    elif filled:
        radius = max(3, min(width, height) // 12)
        border = max(1, min(width, height) // 36)
        draw.rounded_rectangle(
            (0, 0, width - 1, height - 1),
            radius=radius,
            fill=(18, 17, 18, 238),
            outline=(245, 139, 25, 245),
            width=border,
        )

    font_size = max(10, round(height / 4.75))
    font = ImageFont.truetype(str(font_path), font_size)
    line_height = height / 4
    fill = (255, 151, 31, 255)
    stroke_width = max(1, round(font_size / 20))
    stroke_fill = (18, 12, 10, 245)
    for row, line in enumerate(CANONICAL_LINES):
        box = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        text_width = box[2] - box[0]
        text_height = box[3] - box[1]
        x = (width - text_width) / 2 - box[0]
        y = row * line_height + (line_height - text_height) / 2 - box[1]
        draw.text(
            (round(x), round(y)),
            line,
            font=font,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
    return badge


def render_circle_badge(size: tuple[int, int], logo: Image.Image) -> Image.Image:
    """Resize the official canonical circular logo."""
    badge = ImageOps.contain(logo, size, Image.Resampling.LANCZOS).copy()
    alpha = badge.getchannel("A").point(lambda value: round(value * 0.97))
    badge.putalpha(alpha)
    return badge


def paste_centered(base: Image.Image, badge: Image.Image, overlay: Overlay) -> None:
    """Rotate and alpha-composite one badge at its specified center."""
    if overlay.angle:
        badge = badge.rotate(
            overlay.angle,
            resample=Image.Resampling.BICUBIC,
            expand=True,
        )
    x = round(overlay.center[0] - badge.width / 2)
    y = round(overlay.center[1] - badge.height / 2)
    base.alpha_composite(badge, (x, y))


def fit_font(text: str, font_path: Path, max_width: int, max_height: int) -> ImageFont.FreeTypeFont:
    """Return the largest font that fits within the supplied rectangle."""
    for size in range(max_height, 9, -1):
        font = ImageFont.truetype(str(font_path), size)
        box = font.getbbox(text, stroke_width=max(1, size // 28))
        if box[2] - box[0] <= max_width and box[3] - box[1] <= max_height:
            return font
    raise ValueError(f"cannot fit {text!r} into {max_width}x{max_height}")


def apply_fips_network_label(image: Image.Image, font_path: Path) -> None:
    """Place the exact fips.network domain on E1-202's blank hull plate."""
    plate = (432, 1043, 756, 1145)
    draw = ImageDraw.Draw(image)
    text = "fips.network"
    font = fit_font(text, font_path, plate[2] - plate[0] - 28, plate[3] - plate[1] - 30)
    stroke_width = max(1, font.size // 28)
    box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    x = (plate[0] + plate[2] - (box[2] - box[0])) / 2 - box[0]
    y = (plate[1] + plate[3] - (box[3] - box[1])) / 2 - box[1]
    draw.text(
        (round(x), round(y)),
        text,
        font=font,
        fill=(255, 151, 31, 255),
        stroke_width=stroke_width,
        stroke_fill=(4, 5, 8, 255),
    )


def record_batch(
    db_path: Path,
    cards: list[dict[str, Any]],
    sources: dict[str, Path],
    output_dir: Path,
) -> None:
    """Record every output decision before any derived image is written."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS art_sacred_number_outputs (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                output_path TEXT NOT NULL,
                overlays_json TEXT NOT NULL,
                canonical_value TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.executemany(
            """
            INSERT OR REPLACE INTO art_sacred_number_outputs (
                card_id, public_name, source_path, output_path, overlays_json,
                canonical_value, status, reason, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card["id"],
                    card["name"],
                    str(sources[card["id"]]),
                    str(output_dir / f"{card['id']}.png"),
                    json.dumps([asdict(item) for item in OVERLAYS.get(card["id"], ())]),
                    CANONICAL_VALUE,
                    "planned",
                    (
                        "apply deterministic canonical marks"
                        if card["id"] in OVERLAYS or card["id"] == "E1-202"
                        else (
                            "carry forward verified artwork without a visible sacred-number variant"
                        )
                    ),
                    "auto:codex:sacred-number-lock",
                    now,
                )
                for card in cards
            ],
        )
        connection.commit()


def write_one(
    card_id: str,
    source: Path,
    output: Path,
    logo: Image.Image,
    font_path: Path,
) -> None:
    """Write one derived image without modifying its source."""
    overlays = OVERLAYS.get(card_id, ())
    if not overlays and card_id != "E1-202" and source.suffix.lower() == ".png":
        shutil.copy2(source, output)
        return

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    for overlay in overlays:
        if overlay.kind == "circle":
            badge = render_circle_badge(overlay.size, logo)
        elif overlay.kind in {"grid", "mask"}:
            badge = render_grid_badge(
                overlay.size,
                font_path,
                filled=overlay.filled,
                mask=overlay.kind == "mask",
            )
        else:
            raise ValueError(f"unknown overlay kind: {overlay.kind}")
        paste_centered(image, badge, overlay)
    if card_id == "E1-202":
        apply_fips_network_label(image, font_path)
    image.save(output, "PNG", optimize=True)


def complete_batch(db_path: Path, files: list[dict[str, Any]]) -> None:
    """Mark written files complete in the audit database."""
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.executemany(
            """
            UPDATE art_sacred_number_outputs
            SET status='generated', updated_at=?
            WHERE card_id=?
            """,
            [(now, item["id"]) for item in files],
        )
        connection.executemany(
            """
            UPDATE sacred_number_normalization
            SET status='generated', derived_path=?, updated_at=?
            WHERE card_id=?
            """,
            [(item["file"], now, item["id"]) for item in files],
        )
        connection.commit()


def main() -> None:
    """Build the complete immutable-source, canonical-number art set."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prompts",
        type=Path,
        default=repo_root / "cards" / "e1-art-prompts.json",
    )
    parser.add_argument(
        "--raw",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2",
    )
    parser.add_argument(
        "--reframed",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-reframed",
    )
    parser.add_argument(
        "--cleaned",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-cleaned",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-sacred-number",
    )
    parser.add_argument(
        "--logo",
        type=Path,
        default=repo_root / "art" / "brand" / "600B-logo-primary.png",
    )
    parser.add_argument(
        "--font",
        type=Path,
        default=repo_root / "art" / "fonts" / "Anton-Regular.ttf",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    cards = prompt_cards(args.prompts)
    if len(cards) != 295:
        raise ValueError(f"expected 295 cards, found {len(cards)}")
    if args.out.exists() and any(args.out.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty output directory: {args.out}")

    sources = {
        card["id"]: select_source(card["id"], args.raw, args.reframed, args.cleaned)
        for card in cards
    }
    record_batch(args.audit_db, cards, sources, args.out)

    args.out.mkdir(parents=True, exist_ok=True)
    with Image.open(args.logo) as opened_logo:
        logo = opened_logo.convert("RGBA")
    files: list[dict[str, Any]] = []
    for card in cards:
        card_id = card["id"]
        output = args.out / f"{card_id}.png"
        write_one(card_id, sources[card_id], output, logo, args.font)
        with Image.open(output) as image:
            size = list(image.size)
        if size != [1122, 1402]:
            raise ValueError(f"{card_id} has unexpected derived size: {size}")
        files.append(
            {
                "id": card_id,
                "name": card["name"],
                "source": sources[card_id].as_posix(),
                "file": output.as_posix(),
                "size": size,
                "sha256": file_sha256(output),
                "canonical_overlay": card_id in OVERLAYS,
                "fips_network_label": card_id == "E1-202",
            }
        )
        log.info("derived %s", card_id)

    manifest = {
        "phase": "sacred-number-lock",
        "canonical_value": CANONICAL_VALUE,
        "card_count": len(files),
        "source_data_modified": False,
        "canonical_overlay_cards": sorted(OVERLAYS),
        "fips_network_card": "E1-202",
        "files": files,
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    complete_batch(args.audit_db, files)
    log.info(
        "sacred-number lock: %d cards, %d canonical overlays, fips.network on E1-202",
        len(files),
        len(OVERLAYS),
    )


if __name__ == "__main__":
    main()
