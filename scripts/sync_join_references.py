"""Download immutable join.600.wtf character references, in either published variant.

join.600.wtf publishes each character twice: a *Detailed ·front* study, which is what card
artwork is drawn from, and a *homepage* image, which is the face the character wears on the
site. They are different pictures of the same person and neither substitutes for the other,
so each variant is mirrored into its own directory with its own manifest.

The remote source remains read-only. Every intended download is recorded in the local
SQLite audit trail before any bytes are written. Existing verified files are reused.

    uv run python scripts/sync_join_references.py --variant homepage
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sqlite3
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image

log = logging.getLogger("sync_join_references")

CONTENT_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# The two published variants. `label` is what goes in the audit trail and the manifest, so
# a reader of either can tell which picture they are holding without opening it.
VARIANTS = {
    "detailed-front": {
        "url_field": "detailed_front_url",
        "label": "Detailed ·front",
        "directory": "join-detailed-front",
    },
    "homepage": {
        "url_field": "homepage_url",
        "label": "homepage",
        "directory": "join-homepage",
    },
}


def slugify(value: str) -> str:
    """Create a stable lowercase file stem."""
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def file_sha256(path: Path) -> str:
    """Hash a local reference file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_registry(path: Path, url_field: str) -> list[dict[str, Any]]:
    """Load and validate the read-only website reference registry."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("source_policy") != "read-only":
        raise ValueError("join.600.wtf registry must be marked read-only")
    characters = payload["characters"]
    if len(characters) != 31:
        raise ValueError(f"expected 31 join.600.wtf characters, found {len(characters)}")
    if not all(str(item.get(url_field, "")).startswith("https://") for item in characters):
        raise ValueError(f"every character needs an HTTPS {url_field}")
    return characters


def record_decisions(
    db_path: Path,
    characters: list[dict[str, Any]],
    output_dir: Path,
    variant: dict[str, str],
) -> None:
    """Record the immutable reference batch before downloading it."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        # Both variants live in this table, so the variant belongs in the key. A
        # table keyed on the name alone predates the second variant and is dropped
        # rather than migrated: every row in it is a "planned" marker whose durable
        # record is the manifest lying beside the files.
        legacy = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            ("character_reference_decisions",),
        ).fetchone()
        if legacy and "public_name TEXT PRIMARY KEY" in (legacy[0] or ""):
            connection.execute("DROP TABLE character_reference_decisions")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS character_reference_decisions (
                public_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                visual_variant TEXT NOT NULL,
                output_directory TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (public_name, visual_variant)
            )
            """
        )
        # Scoped to this variant: re-syncing the homepage images must not erase the
        # record of where the Detailed-front ones came from.
        connection.execute(
            "DELETE FROM character_reference_decisions WHERE visual_variant = ?",
            (variant["label"],),
        )
        connection.executemany(
            """
            INSERT INTO character_reference_decisions (
                public_name, source_url, visual_variant, output_directory,
                status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item["name"],
                    item[variant["url_field"]],
                    variant["label"],
                    str(output_dir),
                    "planned",
                    "canonical visual identity reference requested for E1 artwork",
                    "auto:codex:join-reference-sync",
                )
                for item in characters
            ],
        )
        connection.commit()


def download_reference(
    character: dict[str, Any],
    output_dir: Path,
    url_field: str,
) -> dict[str, Any]:
    """Download one source image without changing its bytes."""
    request = urllib.request.Request(
        character[url_field],
        headers={"User-Agent": "600B-Timelock-TCG-reference-sync/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get_content_type()
        extension = CONTENT_EXTENSIONS.get(content_type)
        if extension is None:
            raise ValueError(f"unsupported content type for {character['name']}: {content_type}")
        data = response.read()

    output = output_dir / f"{slugify(character['name'])}{extension}"
    temporary = output.with_suffix(output.suffix + ".part")
    temporary.write_bytes(data)
    with Image.open(temporary) as image:
        image.verify()
    temporary.replace(output)

    with Image.open(output) as image:
        size = list(image.size)
        mode = image.mode

    return {
        "name": character["name"],
        "card_aliases": character["card_aliases"],
        "source_url": character[url_field],
        "local_file": output.relative_to(output_dir.parents[2]).as_posix(),
        "content_type": content_type,
        "size": size,
        "mode": mode,
        "sha256": file_sha256(output),
        "status": "verified-read-only-copy",
    }


def main() -> None:
    """Sync one variant of the canonical images and write its checksum manifest."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--variant",
        choices=sorted(VARIANTS),
        default="detailed-front",
        help="which published picture to mirror (default: detailed-front)",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        default=repo_root / "art" / "references" / "join-characters.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output directory (default: art/references/<variant directory>)",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    variant = VARIANTS[args.variant]
    out = args.out or repo_root / "art" / "references" / variant["directory"]

    characters = load_registry(args.registry, variant["url_field"])
    record_decisions(args.audit_db, characters, out, variant)
    out.mkdir(parents=True, exist_ok=True)

    files = []
    for index, character in enumerate(characters, start=1):
        files.append(download_reference(character, out, variant["url_field"]))
        log.info("synced %d/%d: %s", index, len(characters), character["name"])

    manifest = {
        "source": "https://join.600.wtf/",
        "source_policy": "read-only",
        "visual_reference": variant["label"],
        "character_count": len(files),
        "files": files,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info("reference lock passed: %d canonical %s images", len(files), variant["label"])


if __name__ == "__main__":
    main()
