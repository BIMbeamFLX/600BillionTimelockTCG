"""Build 295 standalone Edition One artworks before any card face is rendered.

The script combines six generated 600B world plates with deterministic protocol motifs.
Avatar cards additionally use only the official full-body character assets. Source
assets remain read-only. Intended art decisions are recorded in SQLite before raster
outputs are written.

Usage:
    python scripts/build_artwork.py --character-assets PATH/TO/assets/fullbody
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import random
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageEnhance,
    ImageFilter,
    ImageFont,
    ImageOps,
)

log = logging.getLogger("build_artwork")

ART_WIDTH = 768
ART_HEIGHT = 960
ACCENTS = {
    "Signal": (255, 247, 236),
    "Timelock": (94, 90, 203),
    "Keys": (116, 71, 184),
    "Power": (255, 106, 0),
    "Bitcoin": (243, 194, 68),
    "Neutral": (175, 112, 255),
}
WORLD_PLATES = {
    "Signal": "signal.png",
    "Timelock": "timelock.png",
    "Keys": "keys.png",
    "Power": "power.png",
    "Bitcoin": "bitcoin.png",
    "Neutral": "neutral.png",
}


@dataclass(frozen=True)
class ArtDecision:
    """Deterministic inputs for one standalone illustration."""

    card_id: str
    card_name: str
    world_plates: list[str]
    character_assets: list[str]
    seed: int
    output_file: str


def stable_seed(card_id: str, name: str) -> int:
    """Create a stable integer seed from public card identity."""
    digest = hashlib.sha256(f"{card_id}|{name}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def world_categories(affinities: list[str]) -> list[str]:
    """Choose one or two world plates for a card."""
    valid = [item for item in affinities if item in WORLD_PLATES]
    return valid[:2] or ["Neutral"]


def load_card_data(path: Path) -> list[dict[str, Any]]:
    """Load canonical text-locked card records."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    cards = payload["cards"]
    if len(cards) != 295:
        raise ValueError(f"expected 295 cards, found {len(cards)}")
    if not all(card["status"] == "text-locked" for card in cards):
        raise ValueError("all cards must pass text lock before artwork begins")
    return cards


def build_decisions(cards: list[dict[str, Any]]) -> list[ArtDecision]:
    """Build reproducible art decisions from canonical card data."""
    decisions: list[ArtDecision] = []
    for card in cards:
        character = card.get("character")
        character_assets = character["assets"] if character else []
        categories = world_categories(card["affinity"])
        decisions.append(
            ArtDecision(
                card_id=card["id"],
                card_name=card["name"],
                world_plates=[WORLD_PLATES[item] for item in categories],
                character_assets=character_assets,
                seed=stable_seed(card["id"], card["name"]),
                output_file=f"{card['id']}.jpg",
            )
        )
    return decisions


def record_art_decisions(db_path: Path, decisions: list[ArtDecision]) -> None:
    """Commit the complete intended art batch before writing image files."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS art_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                world_plates TEXT NOT NULL,
                character_assets TEXT NOT NULL,
                seed INTEGER NOT NULL,
                output_file TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM art_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO art_decisions (
                card_id, public_name, world_plates, character_assets, seed,
                output_file, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item.card_id,
                    item.card_name,
                    json.dumps(item.world_plates),
                    json.dumps(item.character_assets),
                    item.seed & ((1 << 63) - 1),
                    item.output_file,
                    "planned",
                    "text-lock passed; build standalone art before card faces",
                    "auto:codex:e1-artwork",
                )
                for item in decisions
            ],
        )
        connection.commit()


def fitted_plate(path: Path, seed: int) -> Image.Image:
    """Create a deterministic crop and grade from one generated world plate."""
    rng = random.Random(seed)
    with Image.open(path) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        zoom = 1.0 + rng.random() * 0.13
        scaled_size = (round(ART_WIDTH * zoom), round(ART_HEIGHT * zoom))
        fitted = ImageOps.fit(source, scaled_size, method=Image.Resampling.LANCZOS)
        max_x = fitted.width - ART_WIDTH
        max_y = fitted.height - ART_HEIGHT
        x = round(max_x * rng.random())
        y = round(max_y * rng.random())
        fitted = fitted.crop((x, y, x + ART_WIDTH, y + ART_HEIGHT))
        if rng.random() < 0.5:
            fitted = ImageOps.mirror(fitted)
        fitted = ImageEnhance.Contrast(fitted).enhance(1.05)
        return ImageEnhance.Color(fitted).enhance(0.93)


def combine_plates(paths: list[Path], seed: int) -> Image.Image:
    """Blend one or two affinity plates into the common canvas."""
    first = fitted_plate(paths[0], seed)
    if len(paths) == 1:
        return first
    second = fitted_plate(paths[1], seed ^ 0x600B)
    mask = Image.new("L", (ART_WIDTH, ART_HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    offset = (seed % 260) - 130
    draw.polygon(
        [
            (ART_WIDTH // 2 + offset, 0),
            (ART_WIDTH, 0),
            (ART_WIDTH, ART_HEIGHT),
            (ART_WIDTH // 2 - offset, ART_HEIGHT),
        ],
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(90))
    return Image.composite(second, first, mask)


def tint_canvas(image: Image.Image, accent: tuple[int, int, int]) -> Image.Image:
    """Unify generated plates with the orange-purple-black Edition One palette."""
    overlay = Image.new("RGB", image.size, accent)
    image = Image.blend(image, overlay, 0.055)
    vignette = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(vignette)
    draw.ellipse((-150, -100, ART_WIDTH + 150, ART_HEIGHT + 210), fill=210)
    vignette = vignette.filter(ImageFilter.GaussianBlur(90))
    dark = Image.new("RGB", image.size, (8, 6, 12))
    return Image.composite(image, dark, vignette)


def draw_glow_line(
    layer: Image.Image,
    points: list[tuple[int, int]],
    color: tuple[int, int, int],
    width: int,
) -> None:
    """Draw a soft protocol trace and a crisp illuminated core."""
    glow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.line(points, fill=(*color, 185), width=width * 4, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(width * 2))
    layer.alpha_composite(glow)
    draw = ImageDraw.Draw(layer)
    draw.line(points, fill=(*color, 220), width=width, joint="curve")


def draw_protocol_motif(
    canvas: Image.Image,
    card: dict[str, Any],
    seed: int,
) -> None:
    """Add a quiet corner sigil without covering the illustration's focal subject."""
    rng = random.Random(seed ^ 0xE1)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    affinities = card["affinity"]
    accent = ACCENTS.get(affinities[0] if len(affinities) == 1 else "Neutral")
    orange = ACCENTS["Power"]
    purple = ACCENTS["Keys"]
    center = (
        ART_WIDTH - 112 + rng.randint(-10, 10),
        ART_HEIGHT - 118 + rng.randint(-10, 10),
    )
    rules = card["rules_text"].casefold()

    for index in range(2):
        radius = 18 + index * 18 + rng.randint(-3, 3)
        color = accent if index % 2 == 0 else purple
        ring = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ring_draw = ImageDraw.Draw(ring)
        box = (
            center[0] - radius,
            center[1] - radius,
            center[0] + radius,
            center[1] + radius,
        )
        ring_draw.ellipse(box, outline=(*color, 65), width=1 + index % 2)
        ring = ring.filter(ImageFilter.GaussianBlur(0.5))
        layer.alpha_composite(ring)

    point_count = 5
    points: list[tuple[int, int]] = []
    for index in range(point_count):
        angle = (math.tau * index / point_count) + rng.random() * 0.28
        radius = 38 + rng.randint(-7, 8)
        points.append(
            (
                round(center[0] + math.cos(angle) * radius),
                round(center[1] + math.sin(angle) * radius),
            )
        )
    points.append(points[0])
    draw_glow_line(layer, points, accent, 1)

    if "damage" in rules or card["card_type"] == "Zap":
        bolt = [
            (center[0] - 24, center[1] - 42),
            (center[0] + 5, center[1] - 10),
            (center[0] - 8, center[1] + 2),
            (center[0] + 26, center[1] + 44),
        ]
        draw_glow_line(layer, bolt, orange, 2)
    if "draw" in rules or "wallet" in rules:
        draw = ImageDraw.Draw(layer)
        for index in range(2):
            inset = index * 5
            box = (
                center[0] - 28 + inset,
                center[1] - 36 - inset,
                center[0] + 28 + inset,
                center[1] + 36 - inset,
            )
            draw.rounded_rectangle(box, radius=5, outline=(*accent, 85), width=1)
    if "shielded" in rules or "prevent" in rules or "firewall" in card["subtype"].casefold():
        draw = ImageDraw.Draw(layer)
        shield = [
            (center[0], center[1] - 42),
            (center[0] + 34, center[1] - 22),
            (center[0] + 25, center[1] + 25),
            (center[0], center[1] + 45),
            (center[0] - 25, center[1] + 25),
            (center[0] - 34, center[1] - 22),
        ]
        draw.line(shield + [shield[0]], fill=(*purple, 95), width=2, joint="curve")
    if "additional turn" in rules or "unlock" in rules:
        draw = ImageDraw.Draw(layer)
        draw.arc(
            (
                center[0] - 42,
                center[1] - 42,
                center[0] + 42,
                center[1] + 42,
            ),
            start=30,
            end=325,
            fill=(*orange, 95),
            width=2,
        )

    layer = layer.filter(ImageFilter.GaussianBlur(0.25))
    canvas.alpha_composite(layer)


def remove_flat_background(source: Image.Image) -> Image.Image:
    """Remove flat backgrounds and feather concept-sheet edges without source edits."""
    image = source.convert("RGB")
    corners = (
        image.getpixel((0, 0)),
        image.getpixel((image.width - 1, 0)),
        image.getpixel((0, image.height - 1)),
        image.getpixel((image.width - 1, image.height - 1)),
    )
    background = tuple(sum(pixel[channel] for pixel in corners) // 4 for channel in range(3))
    solid = Image.new("RGB", image.size, background)
    difference = ImageChops.difference(image, solid).convert("L")
    alpha = difference.point(lambda value: max(0, min(255, (value - 12) * 7)))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
    feather = Image.new("L", image.size, 0)
    feather_draw = ImageDraw.Draw(feather)
    horizontal_inset = round(image.width * 0.035)
    feather_draw.ellipse(
        (
            horizontal_inset,
            -round(image.height * 0.06),
            image.width - horizontal_inset,
            image.height + round(image.height * 0.06),
        ),
        fill=255,
    )
    feather = feather.filter(ImageFilter.GaussianBlur(round(image.width * 0.035)))
    alpha = ImageChops.multiply(alpha, feather)
    result = image.convert("RGBA")
    result.putalpha(alpha)
    return result


def load_character(path: Path, cache: dict[Path, Image.Image]) -> Image.Image:
    """Load and cache a clean character cutout from a read-only full-body asset."""
    if path not in cache:
        with Image.open(path) as source:
            cache[path] = remove_flat_background(ImageOps.exif_transpose(source))
    return cache[path].copy()


def place_character(
    canvas: Image.Image,
    cutout: Image.Image,
    index: int,
    count: int,
    seed: int,
) -> None:
    """Place an official character with a grounded purple-orange glow."""
    rng = random.Random(seed ^ (index << 12))
    target_height = 800 if count == 1 else 690
    scale = target_height / cutout.height
    target_width = round(cutout.width * scale)
    cutout = cutout.resize((target_width, target_height), Image.Resampling.LANCZOS)
    if count == 1:
        x = (ART_WIDTH - target_width) // 2 + rng.randint(-24, 24)
    else:
        lane_center = ART_WIDTH * (0.34 if index == 0 else 0.66)
        x = round(lane_center - target_width / 2)
    y = ART_HEIGHT - target_height + 24

    alpha = cutout.getchannel("A")
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_mask = Image.new("L", canvas.size, 0)
    shadow_mask.paste(alpha, (x, y))
    shadow_mask = shadow_mask.filter(ImageFilter.MaxFilter(15))
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(14))
    purple_shadow = Image.new("RGBA", canvas.size, (*ACCENTS["Keys"], 0))
    purple_shadow.putalpha(shadow_mask.point(lambda value: round(value * 0.55)))
    shadow.alpha_composite(purple_shadow)
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(cutout, (x, y))


def render_artwork(
    card: dict[str, Any],
    decision: ArtDecision,
    world_plate_dir: Path,
    character_asset_dir: Path,
    character_cache: dict[Path, Image.Image],
) -> Image.Image:
    """Render one complete standalone artwork layer."""
    plate_paths = [world_plate_dir / name for name in decision.world_plates]
    background = combine_plates(plate_paths, decision.seed)
    affinity_key = card["affinity"][0] if len(card["affinity"]) == 1 else "Neutral"
    accent = ACCENTS.get(affinity_key, ACCENTS["Neutral"])
    background = tint_canvas(background, accent)
    canvas = background.convert("RGBA")
    draw_protocol_motif(canvas, card, decision.seed)
    for index, filename in enumerate(decision.character_assets):
        cutout = load_character(character_asset_dir / filename, character_cache)
        place_character(
            canvas,
            cutout,
            index,
            len(decision.character_assets),
            decision.seed,
        )
    return canvas.convert("RGB")


def file_sha256(path: Path) -> str:
    """Hash a finished raster artifact."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(
    path: Path,
    decisions: list[ArtDecision],
    output_dir: Path,
) -> None:
    """Write the verified standalone-art manifest."""
    files = []
    for decision in decisions:
        output = output_dir / decision.output_file
        with Image.open(output) as image:
            size = list(image.size)
        files.append(
            {
                "id": decision.card_id,
                "name": decision.card_name,
                "file": decision.output_file,
                "world_plates": decision.world_plates,
                "character_assets": decision.character_assets,
                "size": size,
                "sha256": file_sha256(output),
                "status": "art-locked",
            }
        )
    payload = {
        "phase": "standalone-art",
        "card_count": len(files),
        "required_size": [ART_WIDTH, ART_HEIGHT],
        "card_frames_included": False,
        "files": files,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def contact_sheet(
    cards: list[dict[str, Any]],
    output_dir: Path,
    destination: Path,
    font_path: Path,
) -> None:
    """Create labeled QA sheets without changing the standalone art files."""
    destination.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(font_path), 18)
    small_font = ImageFont.truetype(str(font_path), 13)
    columns = 5
    rows = 5
    cell_width = 180
    cell_height = 252
    page_size = columns * rows
    for page_index in range(math.ceil(len(cards) / page_size)):
        page_cards = cards[page_index * page_size : (page_index + 1) * page_size]
        sheet = Image.new(
            "RGB",
            (columns * cell_width, rows * cell_height),
            (13, 11, 17),
        )
        draw = ImageDraw.Draw(sheet)
        for index, card in enumerate(page_cards):
            column = index % columns
            row = index // columns
            x = column * cell_width
            y = row * cell_height
            with Image.open(output_dir / f"{card['id']}.jpg") as source:
                thumb = ImageOps.fit(
                    source.convert("RGB"),
                    (cell_width - 12, 205),
                    method=Image.Resampling.LANCZOS,
                )
            sheet.paste(thumb, (x + 6, y + 6))
            draw.text((x + 7, y + 214), card["id"], font=font, fill=(255, 106, 0))
            label = card["name"]
            if len(label) > 23:
                label = label[:22] + "…"
            draw.text((x + 7, y + 235), label, font=small_font, fill=(255, 247, 236))
        sheet.save(
            destination / f"e1-art-contact-{page_index + 1:02d}.jpg",
            "JPEG",
            quality=88,
            optimize=True,
        )


def validate_inputs(
    decisions: list[ArtDecision],
    world_plate_dir: Path,
    character_asset_dir: Path,
) -> None:
    """Fail before output if any required read-only source is unavailable."""
    missing: list[Path] = []
    for decision in decisions:
        missing.extend(
            path
            for path in (world_plate_dir / name for name in decision.world_plates)
            if not path.is_file()
        )
        missing.extend(
            path
            for path in (character_asset_dir / name for name in decision.character_assets)
            if not path.is_file()
        )
    if missing:
        unique = sorted({str(path) for path in missing})
        raise FileNotFoundError("missing art sources:\n" + "\n".join(unique))


def main() -> None:
    """Record decisions, render 295 artworks, verify them and build QA sheets."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--character-assets", type=Path, required=True)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--world-plates",
        type=Path,
        default=repo_root / "art" / "world-plates",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "generated" / "procedural-preview",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    parser.add_argument(
        "--avatars-only",
        action="store_true",
        help="rerender only Avatar art, then rebuild the full manifest and QA sheets",
    )
    args = parser.parse_args()

    cards = load_card_data(args.cards)
    decisions = build_decisions(cards)
    validate_inputs(decisions, args.world_plates, args.character_assets)
    record_art_decisions(args.audit_db, decisions)

    args.out.mkdir(parents=True, exist_ok=True)
    character_cache: dict[Path, Image.Image] = {}
    selected = [
        (card, decision)
        for card, decision in zip(cards, decisions, strict=True)
        if not args.avatars_only or decision.character_assets
    ]
    for index, (card, decision) in enumerate(selected, start=1):
        artwork = render_artwork(
            card,
            decision,
            args.world_plates,
            args.character_assets,
            character_cache,
        )
        artwork.save(
            args.out / decision.output_file,
            "JPEG",
            quality=91,
            optimize=True,
            progressive=True,
        )
        if index % 25 == 0 or index == len(selected):
            log.info("rendered %d/%d selected standalone artworks", index, len(selected))

    write_manifest(args.out / "manifest.json", decisions, args.out)
    contact_sheet(
        cards,
        args.out,
        repo_root / "art" / "qa",
        repo_root / "art" / "fonts" / "Anton-Regular.ttf",
    )
    log.info("art lock passed: %d standalone images, no card frames", len(decisions))


if __name__ == "__main__":
    main()
