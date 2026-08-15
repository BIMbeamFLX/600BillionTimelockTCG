"""Check that every card face the site asks for is actually published.

`site/faces.js` resolves a card face by SHA-256 against the Blossom mirrors, so a
face whose bytes change gets a new address and the old one stops being the card.
Nothing in the build notices: the site simply asks for a hash no server has, all
three mirrors 404, and the player sees a card back. That failure is silent, it
only appears on a deployed origin, and it is invisible locally because
`faces.js` falls back to the repo file -- which a static publish does not ship
by default.

So this asks the two questions no other check does:

  1. Does the manifest still describe the files on disk? A re-rendered face with
     a stale manifest points the whole site at bytes that no longer exist here.
  2. Is every hash in the manifest actually retrievable from a mirror?

Exit code is non-zero when either answer is no, so it can gate a deploy.

    uv run python scripts/check_blobs.py            # disk + all mirrors
    uv run python scripts/check_blobs.py --offline  # disk only, no network
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "cards" / "e1-blob-manifest.json"
FACES = ROOT / "art" / "cards" / "node-runner-web"

# The same three, in the same order, as site/faces.js MIRRORS.
MIRRORS = (
    "https://blossom.primal.net",
    "https://blossom.bimcvp.com",
    "https://nostr.download",
)

log = logging.getLogger("check_blobs")


@dataclass
class Report:
    """What the check found, in the order a human wants to read it."""

    missing_file: list[str] = field(default_factory=list)
    hash_drift: list[tuple[str, str, str]] = field(default_factory=list)
    unpublished: list[tuple[str, str]] = field(default_factory=list)
    checked: int = 0

    @property
    def ok(self) -> bool:
        """True when nothing would break a deploy."""
        return not (self.missing_file or self.hash_drift or self.unpublished)


def sha256_of(path: Path) -> str:
    """Hex SHA-256 of a file, read in chunks so a large set stays cheap."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def published(sha: str, timeout: float) -> str | None:
    """The first mirror serving this hash, or None if none of them do."""
    for server in MIRRORS:
        url = f"{server}/{sha}.webp"
        request = urllib.request.Request(url, method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if 200 <= response.status < 300:
                    return server
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
            continue
    return None


def check(offline: bool, timeout: float, workers: int) -> Report:
    """Compare the manifest against the files on disk and against the mirrors."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = manifest.get("files", [])
    report = Report(checked=len(entries))

    for entry in entries:
        path = FACES / entry["file"]
        if not path.is_file():
            report.missing_file.append(entry["file"])
            continue
        actual = sha256_of(path)
        if actual != entry["sha256"]:
            report.hash_drift.append((entry["file"], entry["sha256"], actual))

    if offline:
        return report

    live = [e for e in entries if e["file"] not in set(report.missing_file)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        found = list(pool.map(lambda e: published(e["sha256"], timeout), live))
    for entry, server in zip(live, found, strict=True):
        if server is None:
            report.unpublished.append((entry["file"], entry["sha256"]))
    return report


def main() -> int:
    """Print the report and return a shell exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="skip the mirrors")
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    report = check(args.offline, args.timeout, args.workers)

    print(f"checked {report.checked} card faces from {MANIFEST.relative_to(ROOT)}")
    for name in report.missing_file:
        print(f"  MISSING ON DISK   {name}")
    for name, expected, actual in report.hash_drift:
        print(f"  MANIFEST STALE    {name}\n    manifest {expected}\n    on disk  {actual}")
    for name, sha in report.unpublished:
        print(f"  NOT PUBLISHED     {name}  {sha}")

    if report.ok:
        where = "on disk" if args.offline else "on disk and on a mirror"
        print(f"every face resolves {where}.")
        return 0
    print(
        "\nA face that is not published renders as a card back on a deployed origin. "
        "It looks fine locally only because faces.js falls back to the repo file, "
        "which a static publish does not ship by default."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
