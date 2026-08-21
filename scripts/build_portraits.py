"""Derive deployable character portraits from two rosters into one web-sized set.

``art/references/`` never leaves this machine: the deploy (deploy-tcg.ps1) copies only a
named set of ``art/`` subdirectories and calls the references tree "multi-GB local raw
material". ``art/site/`` is in that copied set. So a portrait that should reach a visitor
has to be re-derived out of the reference mirror and into ``art/site/portraits/``, which is
the entire job of this script.

Two rosters land in the same directory and the same index, tagged by ``source``:

``join``
    The local, gitignored ``art/references/join-homepage`` mirror. The source is the
    *homepage* variant, deliberately, not *Detailed ·front*. Those are two different
    pictures of the same person: Detailed ·front is the study the card artwork was drawn
    from, and a card face is not what a player wears as an avatar. The homepage image is
    the face the character already wears on the site, and it is natively square -- which is
    what the destination wants, since the table portrait is a square chip and not a circle.

``sec1``
    The Street of SEC roster, read live from ``members.json``. Only ``name``, ``charId``
    and ``img`` are read. The npub and pubkey fields are ignored on purpose: this build
    wants faces and names, and copying somebody's keys into a card-game repo buys nothing
    and creates something to leak.

The join mirror is read through its ``manifest.json``, never by globbing, for two reasons.
The file extension is not derivable from the character name (29 are .jpg, kerni and mtoshi
are .png), and the manifest carries the sha256 each mirrored file was verified against, so
every run re-derives from bytes that are checked rather than merely present.

The output index is called ``portraits.json`` rather than ``manifest.json`` because
scripts/publish_site.py excludes every file named ``manifest.json`` from the publish set,
wherever it appears -- a portrait index under that name would be dropped from the published
site and 404 in production while looking correct locally.

    uv run python scripts/build_portraits.py
    uv run python scripts/build_portraits.py --offline      # skip the network half
    uv run python scripts/build_portraits.py --refresh      # re-fetch every remote source
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

log = logging.getLogger("build_portraits")

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = REPO_ROOT / "art" / "references" / "join-homepage"
OUTPUT_DIR = REPO_ROOT / "art" / "site" / "portraits"
SOURCE_MANIFEST_NAME = "manifest.json"
OUTPUT_INDEX_NAME = "portraits.json"

SEC1_ROSTER_URL = "https://sec1.citadel-resources.com/members.json"
"""Who is on the roster. Names and charIds come from here."""

SEC1_ASSETS_URL = "https://sec1.citadel-resources.com/assets.json"
"""WHERE THE PICTURES ACTUALLY ARE, which is not where members.json says.

Ten of the twelve members carry a relative ``assets/<charId>/homepage.png``, and every
one of those paths is a 404 -- that host serves no ``assets/`` tree at all. The site's
own lore page does not use them either: it reads this file, which maps each character to
absolute blossom.bimcvp.com URLs including a ``homepage`` variant, and all twelve have
one. Reading the roster alone got two of twelve and looked like an upstream outage.

A blossom URL is the content's sha256, so a portrait sourced here is content-addressed
for free: the recorded source hash and the name it was fetched under have to agree."""

JOIN_SOURCE = "join"
SEC1_SOURCE = "sec1"

# The portrait renders at 64px on the table and 26px in an action burst. 512 is the retina
# headroom above the largest of those, and every source is already square, so this is a
# clean downscale with no crop and no aspect decision to get wrong.
DEFAULT_EDGE = 512

# 60_000 rather than 60 * 1024, so "under 60 KB" holds whether KB means 1000 or 1024 bytes.
# Well under the 80 KB ceiling the chip was budgeted at, because all of them ship to every
# visitor on every phone.
DEFAULT_BUDGET_BYTES = 60_000

# Best quality first; the first rung inside the byte budget wins. Spending quality per file
# rather than flattening everyone to the worst case keeps the simple portraits crisp and
# only steps down the few dense ones. 62 is the floor: below it the flat brand colours these
# portraits are built from start to band visibly.
QUALITY_LADDER: tuple[int, ...] = (90, 86, 82, 78, 74, 70, 66, 62)

# WebP effort level. These are built once and served forever, so the slowest search is free.
WEBP_METHOD = 6

NETWORK_TIMEOUT = 30

# Some hosts refuse a bare urllib request. Naming the caller is politer than pretending to
# be a browser and makes this build identifiable in somebody else's access log.
USER_AGENT = "tcg600nap-build-portraits/1.0"


def slugify(value: str) -> str:
    """Create a stable lowercase file stem."""
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def file_sha256(path: Path) -> str:
    """Hash a file on disk."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class Portrait:
    """One built portrait, and what it cost."""

    slug: str
    source: str
    name: str
    card_aliases: list[str]
    file: str
    width: int
    height: int
    quality: int
    sha256: str
    source_sha256: str
    source_bytes: int
    output_bytes: int
    action: str
    within_budget: bool
    source_url: str = ""


@dataclass
class Roster:
    """One character to build, with the bytes already in hand or still to fetch."""

    slug: str
    source: str
    name: str
    card_aliases: list[str] = field(default_factory=list)
    local_file: Path | None = None
    expected_sha256: str = ""
    source_url: str = ""


# --------------------------------------------------------------------------- the join set


def load_source_manifest(source_dir: Path) -> list[dict[str, Any]]:
    """Load and validate the read-only homepage mirror manifest."""
    manifest_path = source_dir / SOURCE_MANIFEST_NAME
    if not manifest_path.is_file():
        raise SystemExit(
            f"no {SOURCE_MANIFEST_NAME} in {source_dir}. This mirror is gitignored local raw "
            "material; run scripts/sync_join_references.py --variant homepage to populate it."
        )
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("source_policy") != "read-only":
        raise ValueError("the homepage mirror manifest must be marked read-only")
    files = payload["files"]
    declared = payload.get("character_count")
    if declared is not None and len(files) != declared:
        raise ValueError(f"manifest declares {declared} characters but lists {len(files)}")
    return files


def join_roster(source_dir: Path, repo_root: Path) -> list[Roster]:
    """Read the mirrored join.600.wtf homepage characters."""
    entries = []
    for entry in load_source_manifest(source_dir):
        name = entry["name"]
        slug = slugify(name)
        local = repo_root / entry["local_file"]
        if Path(entry["local_file"]).stem != slug:
            raise ValueError(f"{name}: mirror file {local.name} does not match slug {slug!r}")
        entries.append(
            Roster(
                slug=slug,
                source=JOIN_SOURCE,
                name=name,
                card_aliases=list(entry.get("card_aliases", [name])),
                local_file=local,
                expected_sha256=entry["sha256"],
            )
        )
    return entries


# --------------------------------------------------------------------------- the sec1 set


def fetch(url: str) -> bytes:
    """Fetch one URL, or raise with the reason."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT) as response:
        return response.read()


def sec1_assets(assets_url: str) -> dict[str, str]:
    """charId -> homepage image URL, or an empty map if the file cannot be read.

    Empty rather than None on failure: the roster's own ``img`` is still tried per
    member, so a missing assets file degrades to the old behaviour instead of
    dropping the whole set.
    """
    try:
        payload = json.loads(fetch(assets_url).decode("utf-8"))
    except (OSError, urllib.error.URLError, ValueError) as error:
        log.warning(
            "%s is unreachable (%s); falling back to the roster's own img", assets_url, error
        )
        return {}
    out = {}
    for key, value in payload.items():
        if isinstance(value, dict) and isinstance(value.get("homepage"), str):
            out[slugify(key)] = value["homepage"].strip()
    return out


def sec1_roster(roster_url: str, assets_url: str = SEC1_ASSETS_URL) -> list[Roster] | None:
    """Read the Street of SEC roster, or None if it could not be read at all.

    None is not the same answer as an empty roster: a roster that came back and listed
    nobody says those characters are gone, while a roster that never came back says
    nothing at all, and main() must not turn a network blip into a deletion.
    """
    try:
        payload = json.loads(fetch(roster_url).decode("utf-8"))
    except (OSError, urllib.error.URLError, ValueError) as error:
        log.warning("%s is unreachable (%s); keeping the previous sec1 build", roster_url, error)
        return None

    assets = sec1_assets(assets_url)
    entries = []
    for member in payload.get("members", []):
        name = str(member.get("name", "")).strip()
        slug = slugify(str(member.get("charId") or name))
        # assets.json first: the roster's own img is a path this host does not serve.
        image = assets.get(slug) or str(member.get("img", "")).strip()
        if not name or not image:
            log.warning("skipping a roster member with no name and no image anywhere")
            continue
        url = urllib.parse.urljoin(roster_url, image)
        # This roster is somebody else's file, so treat its strings as untrusted input: only
        # https is fetched, and the output filename is built from the slug rather than from
        # anything in `img`, so a path in the roster can never steer a write.
        if urllib.parse.urlparse(url).scheme != "https":
            log.warning("%s: img %r is not https; skipping", name, image)
            continue
        entries.append(
            Roster(
                slug=slug,
                source=SEC1_SOURCE,
                name=name,
                source_url=url,
            )
        )
    return entries


# ------------------------------------------------------------------------------- encoding


def square(image: Image.Image, source_name: str) -> Image.Image:
    """Return the largest centred square of an image, warning when that actually cuts."""
    if image.width == image.height:
        return image
    # Cropping is the lesser evil against squashing a face, but it is still a silent
    # editorial decision on somebody's portrait, so it never happens quietly.
    log.warning("%s is %dx%d; cropping to a centred square", source_name, image.width, image.height)
    edge = min(image.width, image.height)
    left = (image.width - edge) // 2
    top = (image.height - edge) // 2
    return image.crop((left, top, left + edge, top + edge))


def encode_portrait(data: bytes, source_name: str, edge: int, quality: int) -> bytes:
    """Square and downscale source bytes, and return WebP bytes."""
    with Image.open(io.BytesIO(data)) as handle:
        # RGB because a chip on a solid tile has nothing to be transparent against, and an
        # alpha channel would only add bytes every visitor pays for.
        resized = square(handle.convert("RGB"), source_name).resize(
            (edge, edge), Image.Resampling.LANCZOS
        )
    buffer = io.BytesIO()
    resized.save(buffer, format="WEBP", quality=quality, method=WEBP_METHOD)
    return buffer.getvalue()


def choose_encoding(
    data: bytes, source_name: str, edge: int, budget: int
) -> tuple[bytes, int, bool]:
    """Pick the highest ladder rung that fits the budget; fall back to the lowest rung."""
    encoded = b""
    quality = QUALITY_LADDER[-1]
    for quality in QUALITY_LADDER:
        encoded = encode_portrait(data, source_name, edge, quality)
        if len(encoded) <= budget:
            return encoded, quality, True
    log.warning(
        "%s could not reach %d bytes; shipping %d bytes at quality %d",
        source_name,
        budget,
        len(encoded),
        quality,
    )
    return encoded, quality, False


# ---------------------------------------------------------------------------- idempotence


def previous_index(output_dir: Path) -> dict[str, dict[str, Any]]:
    """Load the last build's entries by slug, so an unchanged portrait can be left alone."""
    index_path = output_dir / OUTPUT_INDEX_NAME
    if not index_path.is_file():
        return {}
    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("%s is not readable JSON; rebuilding every portrait", index_path.name)
        return {}
    return {entry["slug"]: entry for entry in payload.get("portraits", [])}


def built_file_matches(entry: dict[str, Any], output_dir: Path) -> bool:
    """Report whether the .webp this entry describes is still on disk with the same bytes."""
    built = output_dir / entry.get("file", "")
    return built.is_file() and file_sha256(built) == entry.get("sha256")


def is_fresh(
    entry: dict[str, Any] | None, item: Roster, output_dir: Path, edge: int, budget: int
) -> bool:
    """Report whether a previous build still stands for this character under these settings."""
    if not entry:
        return False
    # Recorded settings, not just the source hash: changing the edge or the budget has to
    # rebuild files whose sources never moved. An entry with no `source` predates the sec1
    # half of this index and is rebuilt once so every row ends up the same shape.
    if entry.get("source") != item.source:
        return False
    if entry.get("width") != edge or entry.get("budget_bytes") != budget:
        return False
    return built_file_matches(entry, output_dir)


def reuse(entry: dict[str, Any], item: Roster, output_dir: Path, action: str) -> Portrait:
    """Carry a previous build forward without re-encoding it."""
    return Portrait(
        slug=item.slug,
        source=item.source,
        name=entry.get("name", item.name),
        card_aliases=list(entry.get("card_aliases", item.card_aliases)),
        file=entry["file"],
        width=entry["width"],
        height=entry["height"],
        quality=entry["quality"],
        sha256=entry["sha256"],
        source_sha256=entry.get("source_sha256", ""),
        source_bytes=entry.get("source_bytes", 0),
        output_bytes=(output_dir / entry["file"]).stat().st_size,
        action=action,
        within_budget=entry.get("within_budget", True),
        source_url=entry.get("source_url", item.source_url),
    )


# -------------------------------------------------------------------------------- the build


def read_source(
    item: Roster, known: dict[str, Any] | None, fresh: bool, refresh: bool
) -> bytes | None:
    """Return the source bytes for one character, or None when they cannot be had."""
    if item.local_file is not None:
        if not item.local_file.is_file():
            raise SystemExit(
                f"{item.name}: {item.local_file} is listed in the manifest but missing"
            )
        data = item.local_file.read_bytes()
        actual = hashlib.sha256(data).hexdigest()
        if actual != item.expected_sha256:
            raise SystemExit(
                f"{item.name}: {item.local_file.name} hashes {actual[:12]}… but the manifest "
                f"says {item.expected_sha256[:12]}…. The mirror is stale or damaged; re-sync "
                "it rather than publishing bytes nobody verified."
            )
        return data

    if not item.source_url:
        return None
    if fresh and not refresh and known and known.get("source_url") == item.source_url:
        # A remote source has no local copy to hash, so an unchanged run would otherwise
        # re-download megabytes to prove nothing moved. --refresh is how an upstream image
        # swap at the same URL gets picked up.
        return None
    try:
        return fetch(item.source_url)
    except (OSError, urllib.error.URLError) as error:
        log.warning("%s: %s could not be fetched (%s)", item.name, item.source_url, error)
        return None


def build_portrait(
    item: Roster,
    output_dir: Path,
    edge: int,
    budget: int,
    previous: dict[str, dict[str, Any]],
    refresh: bool,
    dry_run: bool,
) -> Portrait | None:
    """Derive one portrait, reusing the previous build when nothing that matters changed."""
    known = previous.get(item.slug)
    fresh = is_fresh(known, item, output_dir, edge, budget)

    data = read_source(item, known, fresh, refresh)
    if data is None:
        # Either the remote source was deliberately not re-fetched, or it could not be
        # reached. Both cases keep whatever was built last time rather than dropping a
        # character out of the picker over one bad response.
        if known and built_file_matches(known, output_dir):
            return reuse(known, item, output_dir, "unchanged")
        log.warning("%s: no source and no previous build; leaving this character out", item.name)
        return None

    source_hash = hashlib.sha256(data).hexdigest()
    if fresh and known and known.get("source_sha256") == source_hash:
        return reuse(known, item, output_dir, "unchanged")

    encoded, quality, within = choose_encoding(data, item.slug, edge, budget)
    filename = f"{item.slug}.webp"
    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / filename).write_bytes(encoded)
    action = "updated" if known else "added"
    log.info(
        "%-16s %-5s %8d -> %6d bytes  q%d  %s",
        filename,
        item.source,
        len(data),
        len(encoded),
        quality,
        action,
    )
    return Portrait(
        slug=item.slug,
        source=item.source,
        name=item.name,
        card_aliases=list(item.card_aliases),
        file=filename,
        width=edge,
        height=edge,
        quality=quality,
        sha256=hashlib.sha256(encoded).hexdigest(),
        source_sha256=source_hash,
        source_bytes=len(data),
        output_bytes=len(encoded),
        action=action,
        within_budget=within,
        source_url=item.source_url,
    )


def dedupe(roster: list[Roster]) -> list[Roster]:
    """Drop any character whose slug a previous one already claimed."""
    seen: dict[str, Roster] = {}
    kept = []
    for item in roster:
        clash = seen.get(item.slug)
        if clash:
            # One slug is one filename. Two characters sharing one would silently overwrite
            # each other and the index would name a file showing the wrong face.
            log.warning(
                "%s (%s) wants the slug %r that %s (%s) already holds; skipping it",
                item.name,
                item.source,
                item.slug,
                clash.name,
                clash.source,
            )
            continue
        seen[item.slug] = item
        kept.append(item)
    return kept


def write_index(output_dir: Path, portraits: list[Portrait], budget: int) -> None:
    """Write portraits.json so the site resolves a character to a file instead of guessing."""
    payload = {
        "generated_by": "scripts/build_portraits.py",
        "sources": {
            JOIN_SOURCE: "art/references/join-homepage (join.600.wtf homepage variant)",
            SEC1_SOURCE: SEC1_ROSTER_URL,
        },
        "portrait_count": len(portraits),
        "portraits": [
            {
                "slug": item.slug,
                "source": item.source,
                "name": item.name,
                # The join key from a card to a portrait is the alias, not the display name:
                # every card for character "P" is titled "Proton, …". Empty means this
                # character has no cards to be named on, which is true of the whole sec1 set.
                "card_aliases": item.card_aliases,
                "file": item.file,
                "width": item.width,
                "height": item.height,
                "quality": item.quality,
                "budget_bytes": budget,
                "within_budget": item.within_budget,
                "bytes": item.output_bytes,
                "sha256": item.sha256,
                "source_url": item.source_url,
                "source_sha256": item.source_sha256,
                "source_bytes": item.source_bytes,
            }
            for item in portraits
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / OUTPUT_INDEX_NAME
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def stale_files(output_dir: Path, portraits: list[Portrait]) -> list[str]:
    """Return built .webp files no current character claims."""
    if not output_dir.is_dir():
        return []
    kept = {item.file for item in portraits}
    return sorted(path.name for path in output_dir.glob("*.webp") if path.name not in kept)


def build_parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--sec1-url", default=SEC1_ROSTER_URL)
    parser.add_argument(
        "--edge",
        type=int,
        default=DEFAULT_EDGE,
        help=f"square edge in pixels (default: {DEFAULT_EDGE})",
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=DEFAULT_BUDGET_BYTES,
        help=f"per-file byte budget (default: {DEFAULT_BUDGET_BYTES})",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="build only the local join set and keep any sec1 portraits already built",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="re-download every remote source instead of trusting the previous index",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be written without touching the output directory",
    )
    return parser


def report(portraits: list[Portrait], output_dir: Path) -> None:
    """Log what this run cost and what it left behind."""
    counts = {action: 0 for action in ("added", "updated", "unchanged")}
    for item in portraits:
        counts[item.action] += 1
    for source in (JOIN_SOURCE, SEC1_SOURCE):
        members = [item for item in portraits if item.source == source]
        if members:
            log.info(
                "%-5s %2d portraits, %d bytes",
                source,
                len(members),
                sum(item.output_bytes for item in members),
            )
    before = sum(item.source_bytes for item in portraits)
    after = sum(item.output_bytes for item in portraits)
    log.info(
        "%d portraits: %d added, %d updated, %d unchanged",
        len(portraits),
        counts["added"],
        counts["updated"],
        counts["unchanged"],
    )
    log.info(
        "total %d -> %d bytes (saved %d, %.1f%%), largest %d bytes",
        before,
        after,
        before - after,
        100.0 * (before - after) / before if before else 0.0,
        max(item.output_bytes for item in portraits),
    )
    orphans = stale_files(output_dir, portraits)
    if orphans:
        log.warning("%d built file(s) no character claims: %s", len(orphans), ", ".join(orphans))


def main() -> None:
    """Re-derive every deployable portrait from the join mirror and the Street of SEC roster."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args()
    output_dir: Path = args.output_dir

    roster = join_roster(args.source_dir, REPO_ROOT)
    if args.offline:
        log.info("--offline: not reading %s", args.sec1_url)
        sec1 = None
    else:
        sec1 = sec1_roster(args.sec1_url)
        if sec1 is not None:
            roster += sec1
    roster = dedupe(roster)

    previous = previous_index(output_dir)
    if sec1 is None:
        # Neither --offline nor an unreachable roster looked at the sec1 half, and what
        # was not looked at must not be deleted. Carrying the previous entries into the
        # roster is what lets build_portrait() reuse their files; without this a single
        # DNS failure rewrites the index without those characters and orphans their
        # .webp, and the picker silently loses them.
        roster += [
            Roster(slug=slug, source=entry.get("source", SEC1_SOURCE), name=entry.get("name", slug))
            for slug, entry in previous.items()
            if entry.get("source") == SEC1_SOURCE and slug not in {item.slug for item in roster}
        ]

    built = [
        build_portrait(
            item, output_dir, args.edge, args.budget, previous, args.refresh, args.dry_run
        )
        for item in roster
    ]
    portraits = sorted((item for item in built if item), key=lambda item: (item.source, item.slug))
    if not portraits:
        raise SystemExit("no portrait could be built from either roster")

    missing = len(built) - len(portraits)
    if missing:
        log.warning("%d character(s) have no portrait in this build", missing)

    if not args.dry_run:
        write_index(output_dir, portraits, args.budget)
    report(portraits, output_dir)


if __name__ == "__main__":
    main()
