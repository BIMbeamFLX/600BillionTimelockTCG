"""Apply the reviewed Edition One artwork QA fixes to derived images."""

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

from normalize_generated_art import ART_HEIGHT, ART_WIDTH, normalize_one
from normalize_sacred_number_art import (
    CANONICAL_VALUE,
    Overlay,
    paste_centered,
    render_circle_badge,
    render_grid_badge,
)
from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("apply_final_art_qa_fixes")

SOURCE_SIZE = (1122, 1402)
GENERATIVE_FIXES = frozenset({"E1-093", "E1-094", "E1-174"})


@dataclass(frozen=True)
class BrandOverlay:
    """One reviewed deterministic overlay in 1122x1402 source coordinates."""

    kind: str
    center: tuple[int, int]
    size: tuple[int, int]
    angle: float = 0.0
    backing_size: tuple[int, int] | None = None


BRAND_OVERLAYS: dict[str, tuple[BrandOverlay, ...]] = {
    "E1-034": (BrandOverlay("600b", (704, 500), (44, 30)),),
    "E1-035": (BrandOverlay("circle", (620, 571), (100, 100)),),
    "E1-037": (BrandOverlay("grid", (548, 406), (48, 66)),),
    "E1-043": (BrandOverlay("grid", (649, 480), (48, 66)),),
    "E1-046": (BrandOverlay("circle", (555, 600), (82, 82)),),
    "E1-047": (
        BrandOverlay("grid", (570, 245), (78, 92)),
        BrandOverlay("600b", (742, 452), (44, 30)),
    ),
    "E1-056": (BrandOverlay("circle", (505, 662), (98, 98)),),
    "E1-069": (BrandOverlay("circle", (595, 350), (124, 124)),),
    "E1-072": (BrandOverlay("grid", (756, 402), (80, 140), angle=30.0),),
    "E1-075": (BrandOverlay("grid", (596, 588), (64, 110)),),
    "E1-078": (BrandOverlay("circle", (584, 548), (138, 138)),),
    "E1-093": (BrandOverlay("grid", (780, 443), (74, 128), angle=20.0),),
    "E1-268": (
        BrandOverlay(
            "circle",
            (560, 440),
            (112, 112),
            backing_size=(142, 142),
        ),
    ),
}

CLEANUP_CARDS = frozenset({"E1-120", "E1-125", "E1-128", "E1-184"})
FIX_CARD_IDS = frozenset(BRAND_OVERLAYS) | CLEANUP_CARDS | GENERATIVE_FIXES


def file_sha256(path: Path) -> str:
    """Return the SHA-256 digest for one file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def render_600b_badge(size: tuple[int, int], font_path: Path) -> Image.Image:
    """Render a compact exact 600B shoulder badge."""
    width, height = size
    badge = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)
    radius = max(3, min(size) // 5)
    border = max(1, min(size) // 18)
    draw.rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=radius,
        fill=(18, 17, 18, 244),
        outline=(245, 139, 25, 250),
        width=border,
    )
    for font_size in range(height, 7, -1):
        font = ImageFont.truetype(str(font_path), font_size)
        box = draw.textbbox((0, 0), "600B", font=font)
        if box[2] - box[0] <= width - 6 and box[3] - box[1] <= height - 5:
            break
    x = (width - (box[2] - box[0])) / 2 - box[0]
    y = (height - (box[3] - box[1])) / 2 - box[1]
    draw.text((round(x), round(y)), "600B", font=font, fill=(255, 151, 31, 255))
    return badge


def draw_backing_circle(image: Image.Image, overlay: BrandOverlay) -> None:
    """Cover a contaminated medallion interior before adding the official logo."""
    if overlay.backing_size is None:
        return
    width, height = overlay.backing_size
    left = round(overlay.center[0] - width / 2)
    top = round(overlay.center[1] - height / 2)
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(
        (left, top, left + width - 1, top + height - 1),
        fill=(15, 12, 12, 248),
        outline=(112, 63, 22, 245),
        width=max(2, min(width, height) // 28),
    )
    image.alpha_composite(layer)


def apply_brand_overlays(
    card_id: str,
    image: Image.Image,
    logo: Image.Image,
    font_path: Path,
) -> list[dict[str, Any]]:
    """Apply every reviewed brand overlay for one card."""
    operations = []
    for item in BRAND_OVERLAYS.get(card_id, ()):
        draw_backing_circle(image, item)
        if item.kind == "circle":
            badge = render_circle_badge(item.size, logo)
        elif item.kind == "grid":
            badge = render_grid_badge(item.size, font_path, filled=True)
        elif item.kind == "600b":
            badge = render_600b_badge(item.size, font_path)
        else:
            raise ValueError(f"unknown brand overlay kind: {item.kind}")
        paste_centered(
            image,
            badge,
            Overlay(
                kind=item.kind,
                center=item.center,
                size=item.size,
                angle=item.angle,
                filled=True,
            ),
        )
        operations.append(asdict(item))
    return operations


def rounded_patch(
    size: tuple[int, int],
    *,
    angle: float,
    motif: str,
) -> Image.Image:
    """Render one small non-text hardware motif for a cleanup."""
    width, height = size
    patch = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(patch)
    border = max(1, min(size) // 30)
    draw.rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=max(3, min(size) // 10),
        fill=(26, 25, 27, 246),
        outline=(120, 73, 38, 245),
        width=border,
    )
    orange = (224, 119, 24, 235)
    violet = (116, 71, 184, 225)
    if motif == "disc":
        center = (width // 2, height // 2)
        radius = round(min(width, height) * 0.31)
        draw.ellipse(
            (
                center[0] - radius,
                center[1] - radius,
                center[0] + radius,
                center[1] + radius,
            ),
            outline=orange,
            width=max(2, border * 2),
        )
        inner = max(3, radius // 3)
        draw.ellipse(
            (
                center[0] - inner,
                center[1] - inner,
                center[0] + inner,
                center[1] + inner,
            ),
            fill=violet,
        )
        for direction in (-1, 1):
            draw.line(
                (
                    center[0] + direction * inner,
                    center[1],
                    center[0] + direction * radius,
                    center[1],
                ),
                fill=violet,
                width=max(2, border),
            )
    elif motif == "circuit":
        step = max(7, width // 5)
        for x in range(step, width - step + 1, step):
            draw.line((x, 8, x, height - 9), fill=orange, width=max(1, border))
        for y in range(step, height - step + 1, step):
            draw.line((8, y, width - 9, y), fill=violet, width=max(1, border))
        for x, y in ((step, step), (width - step, height - step), (step, height - step)):
            radius = max(2, border + 1)
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=orange)
    elif motif == "sun":
        center = (width // 2, height // 2)
        radius = max(3, min(width, height) // 5)
        draw.ellipse(
            (
                center[0] - radius,
                center[1] - radius,
                center[0] + radius,
                center[1] + radius,
            ),
            fill=orange,
        )
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
            draw.line(
                (
                    center[0] + dx * (radius + 2),
                    center[1] + dy * (radius + 2),
                    center[0] + dx * (radius + 7),
                    center[1] + dy * (radius + 7),
                ),
                fill=orange,
                width=max(1, border),
            )
    else:
        raise ValueError(f"unknown cleanup motif: {motif}")
    if angle:
        return patch.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    return patch


def paste_patch(
    image: Image.Image,
    center: tuple[int, int],
    size: tuple[int, int],
    *,
    angle: float,
    motif: str,
) -> None:
    """Paste one small non-text cleanup patch."""
    patch = rounded_patch(size, angle=angle, motif=motif)
    left = round(center[0] - patch.width / 2)
    top = round(center[1] - patch.height / 2)
    image.alpha_composite(patch, (left, top))


def clone_region(
    image: Image.Image,
    source_box: tuple[int, int, int, int],
    target: tuple[int, int],
) -> None:
    """Clone a nearby metal texture with feathered edges."""
    patch = image.crop(source_box)
    mask = Image.new("L", patch.size, 255)
    draw = ImageDraw.Draw(mask)
    feather = max(3, min(patch.size) // 7)
    for inset in range(feather):
        alpha = round(255 * (inset + 1) / feather)
        draw.rounded_rectangle(
            (inset, inset, patch.width - inset - 1, patch.height - inset - 1),
            radius=max(1, feather - inset),
            outline=alpha,
            width=1,
        )
    patch.putalpha(mask)
    image.alpha_composite(patch, target)


def apply_cleanup(card_id: str, image: Image.Image) -> list[dict[str, Any]]:
    """Remove reviewed pseudo-text without adding new readable glyphs."""
    if card_id == "E1-120":
        clone_region(image, (95, 820, 150, 855), (150, 820))
        return [{"kind": "clone", "source_box": [95, 820, 150, 855], "target": [150, 820]}]
    if card_id == "E1-125":
        paste_patch(image, (542, 782), (124, 94), angle=-7.0, motif="disc")
        return [{"kind": "disc", "center": [542, 782], "size": [124, 94], "angle": -7.0}]
    if card_id == "E1-128":
        paste_patch(image, (632, 465), (54, 84), angle=1.0, motif="circuit")
        return [{"kind": "circuit", "center": [632, 465], "size": [54, 84], "angle": 1.0}]
    if card_id == "E1-184":
        paste_patch(image, (320, 1153), (54, 30), angle=5.0, motif="sun")
        return [{"kind": "sun", "center": [320, 1153], "size": [54, 30], "angle": 5.0}]
    return []


def prompt_cards(path: Path) -> dict[str, dict[str, Any]]:
    """Read the prompts-v2 card catalog keyed by card id."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    cards = payload.get("prompts")
    if not isinstance(cards, list):
        raise ValueError(f"{path} does not contain a prompts list")
    return {card["id"]: card for card in cards}


def record_planned(
    db_path: Path,
    cards: dict[str, dict[str, Any]],
    base_dir: Path,
    derived_dir: Path,
    final_dir: Path,
) -> None:
    """Record every reviewed fix before derived or final images are written."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS final_art_qa_fixes (
                card_id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                source_path TEXT NOT NULL,
                derived_path TEXT NOT NULL,
                final_path TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        for card_id in sorted(FIX_CARD_IDS):
            action_parts = []
            if card_id in GENERATIVE_FIXES:
                action_parts.append("imagegen-edit")
            if card_id in BRAND_OVERLAYS:
                action_parts.append("deterministic-brand-overlay")
            if card_id in CLEANUP_CARDS:
                action_parts.append("deterministic-cleanup")
            connection.execute(
                """
                INSERT OR REPLACE INTO final_art_qa_fixes (
                    card_id, action, source_path, derived_path, final_path,
                    status, reason, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card_id,
                    "+".join(action_parts),
                    str(base_dir / f"{card_id}.png"),
                    str(derived_dir / f"{card_id}.png"),
                    str(final_dir / f"{card_id}.jpg"),
                    "planned",
                    f"repair reviewed final-art QA finding for {cards[card_id]['name']}",
                    "user:felix+codex:final-art-qa",
                    now,
                ),
            )
        connection.commit()


def mark_status(db_path: Path, card_ids: list[str], status: str) -> None:
    """Update the SQLite audit state for a completed fix phase."""
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.executemany(
            """
            UPDATE final_art_qa_fixes
            SET status=?, updated_at=?
            WHERE card_id=?
            """,
            [(status, now, card_id) for card_id in card_ids],
        )
        connection.commit()


def select_source(card_id: str, base_dir: Path, imagegen_dir: Path) -> Path:
    """Use an approved ImageGen derivative only for the three anatomy fixes."""
    if card_id in GENERATIVE_FIXES:
        source = imagegen_dir / f"{card_id}.png"
        if not source.exists():
            raise FileNotFoundError(f"missing approved ImageGen edit: {source}")
        return source
    source = base_dir / f"{card_id}.png"
    if not source.exists():
        raise FileNotFoundError(f"missing base artwork: {source}")
    return source


def write_fix(
    card_id: str,
    source: Path,
    derived: Path,
    final: Path,
    logo: Image.Image,
    font_path: Path,
) -> dict[str, Any]:
    """Write one source-size PNG and one normalized final JPEG."""
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    if image.size != SOURCE_SIZE:
        raise ValueError(f"{card_id} has unexpected source size: {image.size}")

    operations: list[dict[str, Any]] = []
    operations.extend(apply_brand_overlays(card_id, image, logo, font_path))
    operations.extend(apply_cleanup(card_id, image))

    derived.parent.mkdir(parents=True, exist_ok=True)
    image.save(derived, "PNG", optimize=True)
    normalized = normalize_one(derived, final)
    return {
        "id": card_id,
        "source": source.as_posix(),
        "source_sha256": file_sha256(source),
        "derived": derived.as_posix(),
        "derived_sha256": file_sha256(derived),
        "file": final.name,
        "sha256": normalized["sha256"],
        "size": normalized["size"],
        "operations": operations,
        "imagegen_edit": card_id in GENERATIVE_FIXES,
        "canonical_value": CANONICAL_VALUE if card_id in BRAND_OVERLAYS else None,
    }


def install_finals(
    fix_manifest: dict[str, Any],
    staged_final_dir: Path,
    final_dir: Path,
    final_manifest_path: Path,
) -> None:
    """Install verified fixes and update the locked final-art manifest."""
    final_manifest = json.loads(final_manifest_path.read_text(encoding="utf-8"))
    manifest_by_id = {item["id"]: item for item in final_manifest["files"]}
    for item in fix_manifest["files"]:
        card_id = item["id"]
        source = staged_final_dir / item["file"]
        target = final_dir / item["file"]
        shutil.copy2(source, target)
        record = manifest_by_id[card_id]
        record["source_file"] = item["derived"]
        record["source_size"] = list(SOURCE_SIZE)
        record["source_sha256"] = item["derived_sha256"]
        record["crop_box"] = [0, 0, SOURCE_SIZE[0], SOURCE_SIZE[1]]
        record["sha256"] = item["sha256"]
        record["status"] = "art-locked-qa-fixed"
    final_manifest_path.write_text(
        json.dumps(final_manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    """Build or install the complete reviewed QA fix set."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prompts",
        type=Path,
        default=repo_root / "cards" / "e1-art-prompts.json",
    )
    parser.add_argument(
        "--base",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-sacred-number-v3",
    )
    parser.add_argument(
        "--imagegen",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-qa-edits",
    )
    parser.add_argument(
        "--derived",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-qa-fixed",
    )
    parser.add_argument(
        "--staged-final",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-final-qa-fixed",
    )
    parser.add_argument(
        "--final",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-final-1920x2400",
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
    parser.add_argument(
        "--install",
        action="store_true",
        help="install the previously staged and reviewed fixes into the final art set",
    )
    args = parser.parse_args()

    fix_manifest_path = args.staged_final / "manifest.json"
    if args.install:
        fix_manifest = json.loads(fix_manifest_path.read_text(encoding="utf-8"))
        install_finals(
            fix_manifest,
            args.staged_final,
            args.final,
            args.final / "manifest.json",
        )
        mark_status(args.audit_db, [item["id"] for item in fix_manifest["files"]], "installed")
        log.info("installed %d reviewed final-art fixes", len(fix_manifest["files"]))
        return

    if args.derived.exists() and any(args.derived.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty directory: {args.derived}")
    if args.staged_final.exists() and any(args.staged_final.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty directory: {args.staged_final}")

    cards = prompt_cards(args.prompts)
    record_planned(args.audit_db, cards, args.base, args.derived, args.final)
    with Image.open(args.logo) as opened_logo:
        logo = opened_logo.convert("RGBA")

    files = []
    for card_id in sorted(FIX_CARD_IDS):
        source = select_source(card_id, args.base, args.imagegen)
        item = write_fix(
            card_id,
            source,
            args.derived / f"{card_id}.png",
            args.staged_final / f"{card_id}.jpg",
            logo,
            args.font,
        )
        item["name"] = cards[card_id]["name"]
        files.append(item)
        log.info("staged %s", card_id)

    manifest = {
        "phase": "final-art-visual-qa-fixes",
        "card_count": len(files),
        "required_size": [ART_WIDTH, ART_HEIGHT],
        "source_size": list(SOURCE_SIZE),
        "source_data_modified": False,
        "canonical_value": CANONICAL_VALUE,
        "files": files,
    }
    args.staged_final.mkdir(parents=True, exist_ok=True)
    fix_manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    mark_status(args.audit_db, [item["id"] for item in files], "staged")
    log.info("staged %d reviewed final-art fixes", len(files))


if __name__ == "__main__":
    main()
