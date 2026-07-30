"""Repository layout contracts for generated website entry points."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_static_site_pages_live_together() -> None:
    """Website entry points belong in site/, not at repository root."""
    assert {path.name for path in (REPO_ROOT / "site").glob("*.html")} == {
        "arena.html",
        "cards.html",
        "index.html",
        "layout-proposals.html",
        "leaderboard.html",
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
    assert 'href="leaderboard.html"' in landing
    assert "../art/generated/prompts-v2-final-1920x2400/" in landing
    assert "../art/illustrations/" not in landing


def test_sats_leaderboard_is_data_driven_and_contains_no_fake_results() -> None:
    """The leaderboard computes verified sats locally without seeded player scores."""
    page = (REPO_ROOT / "site" / "leaderboard.html").read_text(encoding="utf-8")

    assert "Most sats won" in page
    assert "Most sats lost" in page
    assert "Best net sats" in page
    assert 'const CACHE_KEY = "600b:match-results"' in page
    assert "record.verified === true" in page
    assert "No verified matches yet." in page
    assert "settledSats" in page
    assert "demo" not in page.lower()


def test_layout_proposals_compare_three_non_destructive_frame_directions() -> None:
    """The design review page must expose three named alternatives over one artwork."""
    page = (REPO_ROOT / "site" / "layout-proposals.html").read_text(encoding="utf-8")

    assert "A · Protocol Rail" in page
    assert "B · Signal Blade" in page
    assert "C · Orbit Frame" in page
    assert page.count("assets/layouts/e1-256-art.jpg") == 3
    assert (REPO_ROOT / "site" / "assets" / "layouts" / "e1-256-art.jpg").is_file()
    assert "../art/generated/" not in page
