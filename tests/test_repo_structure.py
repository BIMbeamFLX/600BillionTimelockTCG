"""Repository layout contracts for generated website entry points."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_static_site_pages_live_together() -> None:
    """Website entry points belong in site/, not at repository root."""
    assert {path.name for path in (REPO_ROOT / "site").glob("*.html")} == {
        "arena.html",
        "cards.html",
        "index.html",
        "rules.html",
    }
    assert not any(REPO_ROOT.glob("*.html"))


def test_rulebook_numeric_anchors_use_direct_id_lookup() -> None:
    """Numeric chapter IDs must not be passed to querySelector as CSS selectors."""
    rulebook = (REPO_ROOT / "site" / "rules.html").read_text(encoding="utf-8")

    assert "getElementById(link.getAttribute" in rulebook
    assert 'querySelector(link.getAttribute("href"))' not in rulebook


def test_landing_page_links_to_rules_and_watermarked_artwork() -> None:
    """The site entry point must use the dedicated rulebook and final artwork."""
    landing = (REPO_ROOT / "site" / "index.html").read_text(encoding="utf-8")

    assert 'href="rules.html"' in landing
    assert "../art/generated/prompts-v2-final-1920x2400/" in landing
    assert "../art/illustrations/" not in landing
