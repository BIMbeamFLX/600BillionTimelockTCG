"""Stage and install the reviewed scene-integrated Edition One artwork fixes."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from normalize_generated_art import ART_HEIGHT, ART_WIDTH, normalize_one
from normalize_sacred_number_art import CANONICAL_VALUE
from PIL import Image, ImageOps

log = logging.getLogger("apply_final_art_qa_fixes")

GENERATIVE_FIXES = frozenset(
    {
        "E1-034",
        "E1-035",
        "E1-037",
        "E1-043",
        "E1-046",
        "E1-047",
        "E1-056",
        "E1-069",
        "E1-072",
        "E1-075",
        "E1-078",
        "E1-093",
        "E1-094",
        "E1-120",
        "E1-125",
        "E1-128",
        "E1-174",
        "E1-184",
        "E1-202",
        "E1-268",
    }
)
FIX_CARD_IDS = GENERATIVE_FIXES


def file_sha256(path: Path) -> str:
    """Return the SHA-256 digest for one file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    imagegen_dir: Path,
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
            connection.execute(
                """
                INSERT OR REPLACE INTO final_art_qa_fixes (
                    card_id, action, source_path, derived_path, final_path,
                    status, reason, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card_id,
                    "imagegen-integrated-edit",
                    str(imagegen_dir / f"{card_id}.png"),
                    str(derived_dir / f"{card_id}.png"),
                    str(final_dir / f"{card_id}.jpg"),
                    "planned",
                    f"replace pasted repair with reviewed scene-integrated edit for "
                    f"{cards[card_id]['name']}",
                    "user:felix+codex:imagegen",
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


def select_source(card_id: str, imagegen_dir: Path) -> Path:
    """Select one approved scene-integrated ImageGen derivative."""
    source = imagegen_dir / f"{card_id}.png"
    if not source.exists():
        raise FileNotFoundError(f"missing approved ImageGen edit: {source}")
    return source


def write_fix(
    card_id: str,
    source: Path,
    derived: Path,
    final: Path,
) -> dict[str, Any]:
    """Write one lossless derived PNG and one normalized final JPEG."""
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    source_size = image.size
    derived.parent.mkdir(parents=True, exist_ok=True)
    image.save(derived, "PNG", optimize=True)
    normalized = normalize_one(derived, final)
    return {
        "id": card_id,
        "source": source.as_posix(),
        "source_size": list(source_size),
        "source_sha256": file_sha256(source),
        "derived": derived.as_posix(),
        "derived_sha256": file_sha256(derived),
        "file": final.name,
        "sha256": normalized["sha256"],
        "size": normalized["size"],
        "operations": [{"kind": "imagegen-integrated-edit"}],
        "imagegen_edit": True,
        "canonical_value": CANONICAL_VALUE,
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
        record["source_size"] = item["source_size"]
        record["source_sha256"] = item["derived_sha256"]
        record["crop_box"] = [0, 0, item["source_size"][0], item["source_size"][1]]
        record["sha256"] = item["sha256"]
        record["status"] = "art-locked-qa-fixed"
    final_manifest_path.write_text(
        json.dumps(final_manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    """Build or install the complete reviewed scene-integrated QA fix set."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prompts",
        type=Path,
        default=repo_root / "cards" / "e1-art-prompts.json",
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
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    parser.add_argument(
        "--install",
        action="store_true",
        help="install the previously staged and reviewed fixes into the final art set",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="refresh the existing reproducible QA staging files in place",
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

    if not args.refresh and args.derived.exists() and any(args.derived.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty directory: {args.derived}")
    if not args.refresh and args.staged_final.exists() and any(args.staged_final.iterdir()):
        raise FileExistsError(f"refusing to overwrite non-empty directory: {args.staged_final}")

    cards = prompt_cards(args.prompts)
    record_planned(args.audit_db, cards, args.imagegen, args.derived, args.final)
    files = []
    for card_id in sorted(FIX_CARD_IDS):
        source = select_source(card_id, args.imagegen)
        item = write_fix(
            card_id,
            source,
            args.derived / f"{card_id}.png",
            args.staged_final / f"{card_id}.jpg",
        )
        item["name"] = cards[card_id]["name"]
        files.append(item)
        log.info("staged %s", card_id)

    manifest = {
        "phase": "final-art-visual-qa-fixes",
        "card_count": len(files),
        "required_size": [ART_WIDTH, ART_HEIGHT],
        "source_size": "per-file",
        "source_data_modified": False,
        "canonical_value": CANONICAL_VALUE,
        "repair_mode": "scene-integrated-imagegen-only",
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
