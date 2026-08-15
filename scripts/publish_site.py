#!/usr/bin/env python3
"""Assemble the static publish set into dist/ from git-tracked files only.

The pages live in site/ but reference art with `../art/...`, and the referee
serves site/ at `/` with art/, cards/ and rules/ mounted at the repo root. A
browser clamps a leading `..` at the origin root, so `../art/brand/x.png` from
`/index.html` resolves to `/art/brand/x.png` either way. This script reproduces
that layout: site/* lands at the dist root and art/* keeps its `art/` prefix.

Only git-tracked files are copied. That is the mechanism keeping the ~2.8 GB
working-tree art/ out of a publish set that should be tens of megabytes: the
tracked art/ is 62 MB and the referenced subset is smaller still.

Run `python scripts/publish_site.py` from anywhere; paths are repo-relative.
"""

from __future__ import annotations

import argparse
import logging
import re
import shutil
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

log = logging.getLogger("publish_site")

REPO = Path(__file__).resolve().parent.parent

# Pages live here; every file in this tree ships.
SITE_DIR = "site"

# Roots the referee mounts at the origin root. A `../<root>/...` reference from
# a page in site/ is only legal if <root> is one of these.
STATIC_ROOTS = ("art", "cards", "rules")

# Text files worth scanning for asset references.
SCANNED_SUFFIXES = (".html", ".js", ".mjs", ".css")

# A literal reference: `../art/brand/600B-logo-primary.png`. Stops at the quote,
# paren or angle bracket that closes it. Two forms resolve to a directory prefix
# built at runtime instead of a file, and both must be declared in
# DYNAMIC_ASSETS below: a trailing `/` (string concatenation) and an embedded
# `${` (template literal).
REFERENCE = re.compile(r"\.\./(?:" + "|".join(STATIC_ROOTS) + r")/[^\"'`)\s>]*")

# Never publish, wherever it appears. The print manifest inside the card
# directory carries 297 SHA-256 hashes that the nsyte secrets scanner reads as
# potential private keys, and a root .nsyte-ignore did not suppress it. Leaving
# it out of dist/ by construction is the workaround that actually holds.
EXCLUDED_NAMES = frozenset({"manifest.json"})


@dataclass(frozen=True)
class DynamicAsset:
    """A directory prefix a page builds by concatenation, with its glob and reason."""

    prefix: str
    pattern: str
    why: str
    optional: bool = False


# Regex cannot see `"../art/resources/" + icon + ".svg"`, so each concatenation
# site is declared here with the glob it can produce. An undeclared directory
# prefix is a hard error, so a new concatenation site cannot slip through.
DYNAMIC_ASSETS: tuple[DynamicAsset, ...] = (
    DynamicAsset(
        prefix="../art/resources/",
        pattern="art/resources/*.svg",
        why="affinity pips: site/cards.html and site/deck.html build the name from AFF_ICON",
    ),
    DynamicAsset(
        prefix="../art/cards/node-runner-web/",
        pattern="art/cards/node-runner-web/*.webp",
        why="card faces: site/faces.js LOCAL fallback and site/play.js faceUrl()",
        optional=True,
    ),
)


@dataclass
class Problem:
    """One reason the publish set is not safe to build."""

    reference: str
    detail: str
    sources: list[str] = field(default_factory=list)


def run_git(*args: str) -> list[str]:
    """Run a read-only git command and return its NUL-separated output as UTF-8 paths."""
    # text=True would decode with the Windows locale codepage and mangle the
    # en-dash and em-dash card filenames, so decode UTF-8 explicitly.
    result = subprocess.run(
        ["git", "-C", str(REPO), *args],
        capture_output=True,
        check=True,
    )
    return [line for line in result.stdout.decode("utf-8").split("\0") if line]


def tracked_files() -> set[str]:
    """Return every git-tracked path in the repo, as forward-slash repo-relative strings."""
    return set(run_git("ls-files", "-z"))


def scan_references(tracked: set[str]) -> dict[str, list[str]]:
    """Map each literal `../<root>/...` reference to the `file:line` sites that use it."""
    found: dict[str, list[str]] = {}
    pages = sorted(
        path
        for path in tracked
        if path.startswith(f"{SITE_DIR}/") and path.endswith(SCANNED_SUFFIXES)
    )
    for page in pages:
        text = (REPO / page).read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), start=1):
            for match in REFERENCE.findall(line):
                reference = match.split("#")[0].split("?")[0]
                if not reference:
                    continue
                found.setdefault(reference, []).append(f"{page}:{number}")
    log.info("scanned %d pages, found %d distinct references", len(pages), len(found))
    return found


def _declared_for(reference: str) -> DynamicAsset | None:
    """Return the DYNAMIC_ASSETS entry declaring this directory prefix, if any."""
    return next((entry for entry in DYNAMIC_ASSETS if entry.prefix == reference), None)


def directory_prefix(reference: str) -> str | None:
    """Return the runtime-built directory prefix of a reference, or None if it names a file."""
    if "${" in reference:
        # `../art/resources/${SYMBOL_ICON[key]}.svg` -> `../art/resources/`
        cut = reference.index("${")
        return reference[: reference.rindex("/", 0, cut) + 1]
    return reference if reference.endswith("/") else None


def resolve_references(
    references: dict[str, list[str]], tracked: set[str]
) -> tuple[set[str], list[Problem]]:
    """Turn scanned references into repo-relative paths, collecting every failure."""
    wanted: set[str] = set()
    problems: list[Problem] = []
    for reference, sources in sorted(references.items()):
        prefix = directory_prefix(reference)
        if prefix is not None:
            if _declared_for(prefix) is None:
                problems.append(
                    Problem(
                        reference,
                        f"directory prefix {prefix} is built at runtime and is not declared "
                        "in DYNAMIC_ASSETS; add an entry naming the glob it can produce",
                        sources,
                    )
                )
            continue
        # Pages percent-encode spaces and commas in card face names, but the
        # files on disk carry the literal characters.
        repo_path = unquote(reference)[len("../") :]
        if repo_path not in tracked:
            problems.append(Problem(reference, f"{repo_path} is not git-tracked", sources))
            continue
        if not (REPO / repo_path).is_file():
            problems.append(Problem(reference, f"{repo_path} is missing on disk", sources))
            continue
        wanted.add(repo_path)
    return wanted, problems


def resolve_dynamic(tracked: set[str], with_card_faces: bool) -> tuple[set[str], list[Problem]]:
    """Expand the declared concatenation globs against the tracked file list."""
    wanted: set[str] = set()
    problems: list[Problem] = []
    for entry in DYNAMIC_ASSETS:
        if entry.optional and not with_card_faces:
            log.info("skipping optional %s (%s)", entry.pattern, entry.why)
            continue
        matches = {
            path
            for path in tracked
            if Path(path).match(entry.pattern) and Path(path).name not in EXCLUDED_NAMES
        }
        if not matches:
            problems.append(
                Problem(entry.prefix, f"no git-tracked file matches {entry.pattern}", [entry.why])
            )
            continue
        missing = sorted(path for path in matches if not (REPO / path).is_file())
        if missing:
            problems.append(
                Problem(entry.prefix, f"{len(missing)} matched files missing on disk", missing[:5])
            )
            continue
        log.info("%s -> %d files (%s)", entry.pattern, len(matches), entry.why)
        wanted |= matches
    return wanted, problems


def publish_paths(tracked: set[str], with_card_faces: bool) -> tuple[set[str], list[Problem]]:
    """Return the complete set of repo-relative files to publish, plus any blocking problems."""
    site = {path for path in tracked if path.startswith(f"{SITE_DIR}/")}
    if not site:
        return set(), [Problem(SITE_DIR, "no git-tracked files under site/", [])]
    references = scan_references(tracked)
    referenced, problems = resolve_references(references, tracked)
    dynamic, dynamic_problems = resolve_dynamic(tracked, with_card_faces)
    wanted = site | referenced | dynamic
    return {path for path in wanted if Path(path).name not in EXCLUDED_NAMES}, (
        problems + dynamic_problems
    )


def destination_for(path: str) -> str:
    """Map a repo-relative source path to its path inside the publish directory."""
    # site/index.html -> index.html so the pages sit at the origin root, which is
    # what makes a leading `..` clamp onto art/ exactly as the referee serves it.
    return path[len(SITE_DIR) + 1 :] if path.startswith(f"{SITE_DIR}/") else path


def assert_safe_output(out: Path, tracked: set[str]) -> None:
    """Refuse to clear an output directory that is outside the repo or holds tracked files."""
    resolved = out.resolve()
    if REPO not in resolved.parents:
        raise SystemExit(f"refusing to write outside the repo: {resolved}")
    if resolved == REPO:
        raise SystemExit("refusing to use the repo root as the publish directory")
    relative = resolved.relative_to(REPO).as_posix()
    clashes = sorted(p for p in tracked if p == relative or p.startswith(f"{relative}/"))
    if clashes:
        raise SystemExit(
            f"refusing to clear {relative}/: it holds {len(clashes)} git-tracked "
            f"file(s), starting with {clashes[0]}"
        )


def copy_all(paths: Iterable[str], out: Path) -> int:
    """Copy each repo-relative path into the publish directory, returning the byte total."""
    total = 0
    for path in sorted(paths):
        source = REPO / path
        target = out / destination_for(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        total += target.stat().st_size
    return total


def report(paths: set[str], out: Path, total: int) -> None:
    """Print the publish manifest to stdout, grouped by top-level directory."""
    groups: dict[str, list[int]] = {}
    for path in paths:
        head = destination_for(path)
        key = "/".join(head.split("/")[:-1]) or "(root)"
        entry = groups.setdefault(key, [0, 0])
        entry[0] += 1
        entry[1] += (REPO / path).stat().st_size
    print(f"\npublish set -> {out.relative_to(REPO).as_posix()}/")
    print(f"{'files':>7}  {'size':>10}  path")
    for key in sorted(groups):
        count, size = groups[key]
        print(f"{count:>7}  {size / 1048576:>7.2f} MB  {key}/")
    print(f"{'-' * 7}  {'-' * 10}  {'-' * 20}")
    print(f"{len(paths):>7}  {total / 1048576:>7.2f} MB  TOTAL ({total} bytes)")


def explain(problems: list[Problem]) -> None:
    """Print every blocking problem so the run can be fixed in one pass."""
    print(f"\nrefusing to publish: {len(problems)} unresolved asset reference(s)\n")
    for problem in problems:
        print(f"  {problem.reference}")
        print(f"      {problem.detail}")
        for source in problem.sources[:5]:
            print(f"      referenced by {source}")
    print("\nNothing was written. Fix the references or restore the files, then re-run.")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        default="dist",
        help="publish directory, repo-relative (default: dist)",
    )
    parser.add_argument(
        "--with-card-faces",
        action="store_true",
        help="also copy the 297 local card faces (~40 MB). They are served from "
        "Blossom by site/faces.js on any http/https origin, so this is only a "
        "fallback for all three mirrors being unreachable.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="resolve and report the publish set without writing anything",
    )
    parser.add_argument("--verbose", action="store_true", help="log resolution diagnostics")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Build the publish directory; return 0 on success, 1 if any asset is unresolved."""
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(message)s",
    )
    tracked = tracked_files()
    log.info("git reports %d tracked files", len(tracked))
    paths, problems = publish_paths(tracked, args.with_card_faces)
    if problems:
        explain(problems)
        return 1
    out = (REPO / args.out).resolve()
    if args.check:
        total = sum((REPO / path).stat().st_size for path in paths)
        report(paths, out, total)
        print("\n--check: every referenced asset resolved. Nothing written.")
        return 0
    assert_safe_output(out, tracked)
    if out.exists():
        # Idempotent by construction: a full rebuild cannot leave a file behind
        # from a previous run whose reference has since been deleted.
        shutil.rmtree(out)
    out.mkdir(parents=True)
    total = copy_all(paths, out)
    report(paths, out, total)
    print("\nEvery referenced asset resolved. Publish directory is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
