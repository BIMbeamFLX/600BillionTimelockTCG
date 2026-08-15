"""Recompress the world plates in place so the play table stops shipping ~3 MB backgrounds.

The plates are full-viewport CSS backgrounds in site/play.html, drawn under
``filter: brightness(.55)`` and a radial overlay that runs from 40% to 98% opacity. Almost
none of their detail survives to the screen, which is what makes aggressive downscaling and
palette quantisation safe here.

Filenames are never changed: site/play.html and the other pages reference these files by
exact name. ``art/world-plates/original/`` holds the pristine masters and is the only source
this script ever reads, so re-running it re-derives each plate from the master instead of
recompressing its own output. That makes repeat runs idempotent and free of generational loss.
"""

from __future__ import annotations

import argparse
import io
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

LOGGER = logging.getLogger("optimize_art")

REPO_ROOT = Path(__file__).resolve().parents[1]
PLATE_DIR = REPO_ROOT / "art" / "world-plates"
ORIGINAL_DIR_NAME = "original"
# 250_000 rather than 250 * 1024, so "under 250 KB" holds whether KB means 1000 or 1024 bytes.
DEFAULT_BUDGET_BYTES = 250_000

# Rungs ordered best-quality first; the first rung that fits the byte budget wins.
# Resolution is spent before colour depth because the vignette hides softness far better
# than it hides posterised banding. 64 colours is the floor: 32 visibly flattens the
# copper mid-tones, which is the one thing that reads through the overlay.
QUALITY_LADDER: tuple[tuple[int, int], ...] = (
    (1024, 256),
    (960, 256),
    (900, 256),
    (900, 128),
    (860, 128),
    (800, 128),
    (768, 128),
    (720, 128),
    (768, 64),
    (720, 64),
    (672, 64),
    (640, 64),
)


@dataclass(frozen=True)
class PlateResult:
    """Before/after outcome for a single plate."""

    name: str
    before_bytes: int
    after_bytes: int
    width: int
    height: int
    colors: int
    within_budget: bool


def find_plates(plate_dir: Path) -> list[Path]:
    """Return the top-level plate PNGs, excluding the original/ master directory."""
    return sorted(plate_dir.glob("*.png"))


def ensure_original(plate: Path, original_dir: Path) -> Path:
    """Return the pristine master for a plate, seeding it from the plate on first run."""
    original = original_dir / plate.name
    if not original.exists():
        original_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(plate, original)
        LOGGER.warning(
            "no master for %s; seeding original/ from the current file (assumed pristine)",
            plate.name,
        )
    return original


def encode_plate(source: Image.Image, long_edge: int, colors: int) -> tuple[bytes, tuple[int, int]]:
    """Resize to long_edge, quantise to colors, and return optimised PNG bytes plus size."""
    width, height = source.size
    scale = long_edge / max(width, height)
    if scale < 1.0:
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        resized = source.resize(size, Image.Resampling.LANCZOS)
    else:
        resized = source.copy()
    quantised = resized.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    buffer = io.BytesIO()
    quantised.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue(), quantised.size


def choose_encoding(original: Path, budget: int) -> tuple[bytes, tuple[int, int], int, bool]:
    """Pick the highest ladder rung that fits the budget; fall back to the smallest rung."""
    with Image.open(original) as handle:
        source = handle.convert("RGB")
    best: tuple[bytes, tuple[int, int], int] | None = None
    for long_edge, colors in QUALITY_LADDER:
        data, size = encode_plate(source, long_edge, colors)
        best = (data, size, colors)
        if len(data) <= budget:
            return data, size, colors, True
    if best is None:  # pragma: no cover - the ladder is never empty
        raise RuntimeError("quality ladder is empty")
    data, size, colors = best
    LOGGER.warning(
        "%s could not reach %d bytes in PNG; shipping %d bytes at %dx%d/%d colours",
        original.name,
        budget,
        len(data),
        size[0],
        size[1],
        colors,
    )
    return data, size, colors, False


def optimise_plate(plate: Path, original_dir: Path, budget: int, dry_run: bool) -> PlateResult:
    """Re-encode one plate from its master and overwrite it in place."""
    before = plate.stat().st_size
    original = ensure_original(plate, original_dir)
    data, size, colors, within = choose_encoding(original, budget)
    if not dry_run:
        plate.write_bytes(data)
    LOGGER.info(
        "%-14s %8d -> %8d bytes  %dx%d  %d colours",
        plate.name,
        before,
        len(data),
        size[0],
        size[1],
        colors,
    )
    return PlateResult(plate.name, before, len(data), size[0], size[1], colors, within)


def restore_plates(plate_dir: Path, original_dir: Path) -> int:
    """Copy every master back over its plate and return how many were restored."""
    restored = 0
    for original in sorted(original_dir.glob("*.png")):
        shutil.copy2(original, plate_dir / original.name)
        LOGGER.info("restored %s", original.name)
        restored += 1
    return restored


def build_parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--plate-dir", type=Path, default=PLATE_DIR)
    parser.add_argument(
        "--budget",
        type=int,
        default=DEFAULT_BUDGET_BYTES,
        help="per-file byte budget (default: 250000)",
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="copy the masters back over the plates and exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be written without touching any plate",
    )
    return parser


def main() -> None:
    """Recompress every world plate in place, keeping filenames and masters intact."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args()
    plate_dir: Path = args.plate_dir
    original_dir = plate_dir / ORIGINAL_DIR_NAME

    if args.restore:
        count = restore_plates(plate_dir, original_dir)
        LOGGER.info("restored %d plate(s) from %s", count, original_dir)
        return

    plates = find_plates(plate_dir)
    if not plates:
        raise SystemExit(f"no plates found in {plate_dir}")

    results = [optimise_plate(plate, original_dir, args.budget, args.dry_run) for plate in plates]
    before_total = sum(item.before_bytes for item in results)
    after_total = sum(item.after_bytes for item in results)
    LOGGER.info(
        "total %d -> %d bytes (saved %d, %.1f%%)",
        before_total,
        after_total,
        before_total - after_total,
        100.0 * (before_total - after_total) / before_total,
    )
    over = [item.name for item in results if not item.within_budget]
    if over:
        LOGGER.warning("over budget: %s", ", ".join(over))


if __name__ == "__main__":
    main()
