"""Repository layout contracts for generated website entry points."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_static_site_pages_live_together() -> None:
    """Website entry points belong in site/, not at repository root."""
    assert {path.name for path in (REPO_ROOT / "site").glob("*.html")} == {
        "arena.html",  # retired mockup, kept as a redirect to the live table
        "cards.html",
        "deck.html",
        "e1-card-set.html",
        "fx-demo.html",
        "index.html",
        "intro.html",  # the cinematic gate; Play/Skip, then it opens index
        "leaderboard.html",
        "lore.html",
        "matchmaking.html",  # the online lobby; hands off to play.html once a seat is dealt
        "play.html",
        "quickstart.html",
        "rules.html",
        "shop.html",
        "wallet.html",
    }
    assert not any(REPO_ROOT.glob("*.html"))


def test_rulebook_numeric_anchors_use_direct_id_lookup() -> None:
    """Numeric chapter IDs must not be passed to querySelector as CSS selectors."""
    rulebook = (REPO_ROOT / "site" / "rules.html").read_text(encoding="utf-8")

    assert "getElementById(link.getAttribute" in rulebook
    assert 'querySelector(link.getAttribute("href"))' not in rulebook


def test_rulebook_chapter_search_includes_the_chapter_copy() -> None:
    """A reader searching a rules concept should find the chapter that explains it."""
    rulebook = (REPO_ROOT / "site" / "rules.html").read_text(encoding="utf-8")

    assert "link.dataset.terms.includes(needle)" in rulebook


def test_rulebook_article_does_not_repeat_the_hero_title() -> None:
    """The generated article starts at the rule copy; the hero already owns the page heading."""
    rulebook = (REPO_ROOT / "site" / "rules.html").read_text(encoding="utf-8")

    assert "<article><h1>600B Timelock TCG</h1>" not in rulebook
    assert rulebook.count("<h1>") == 1


def test_pack_skip_control_sits_above_the_full_screen_reveal_stage() -> None:
    """The stage overlay must not intercept the button that skips its animation."""
    shop = (REPO_ROOT / "site" / "shop.html").read_text(encoding="utf-8")

    assert ":has(.bay--stage) #revealAll:not([hidden])" in shop


def test_stack_builder_persists_nutft_markers_through_the_storage_adapter() -> None:
    """Shell and website storage must keep a Stack and its ownership marker together."""
    builder = (REPO_ROOT / "site" / "deck.html").read_text(encoding="utf-8")

    assert "await store.setJson(MARKED" in builder
    assert 'localStorage.setItem("600b:nutft-decks"' not in builder


def test_stack_builder_restores_the_requested_og_mode_after_wallet_verification() -> None:
    """The loading fallback must not overwrite the mode that was persisted or just selected.

    This asserted three identifiers containing `requestedMode`. Two branches fixed
    the same defect independently and the surviving one calls it `wish`, kept
    deliberately apart from `mode`: the wish is what the player asked for, the
    mode is what is legal right now, and the whole bug was the second overwriting
    the first. Pinning a name made this test fail on a rename rather than on a
    regression, so it checks the property instead.
    """
    builder = (REPO_ROOT / "site" / "deck.html").read_text(encoding="utf-8")

    # The stored preference is read into its own variable, never straight into `mode`.
    assert 'localStorage.getItem(MODE_KEY) === "og") wish = "og"' in builder
    assert 'localStorage.getItem(MODE_KEY) === "og") mode = "og"' not in builder

    # And every path that re-applies a mode after the wallet answers replays the
    # WISH. If a coerced fallback were replayed here the player's choice would be
    # silently discarded -- which is the defect this test exists for.
    assert builder.count("applyMode(wish, { save: false })") >= 2


def test_stack_builder_rejects_imported_stake_module_cards_before_save() -> None:
    """A handoff can bypass the card picker, so Save must enforce the base ruleset too."""
    builder = (REPO_ROOT / "site" / "deck.html").read_text(encoding="utf-8")

    assert 'if (isStake(byId[id])) return `${byId[id].name}: Stake module is not enabled`' in builder


def test_shop_uses_the_lnurl_success_action_claim() -> None:
    """Returning from a paid wallet must claim that invoice instead of quoting another pack."""
    shop = (REPO_ROOT / "site" / "shop.js").read_text(encoding="utf-8")

    assert 'let claim = params.get("claim")' in shop
    assert "root.NutFTWallet.claimBooster(MINT_URL, claim" in shop


def test_landing_page_links_to_rules_and_final_cards() -> None:
    """The site entry point must use the dedicated rulebook and final card faces."""
    landing = (REPO_ROOT / "site" / "index.html").read_text(encoding="utf-8")

    assert 'href="rules.html"' in landing
    assert 'href="leaderboard.html"' in landing
    assert "../art/cards/node-runner-web/" in landing
    assert "../art/generated/" not in landing
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


def test_inline_page_scripts_assign_nothing_they_never_declare() -> None:
    """An identifier that is assigned and appears exactly once is a merge orphan.

    This is not a general linter and does not pretend to be. It catches one
    specific, expensive shape: a merge keeps one branch's variable, deletes the
    other's declaration, and leaves behind a lone assignment somewhere the
    conflict markers never reached.

    That is exactly what happened to the Stack Builder. Two branches fixed the
    same defect; the surviving one calls the variable `wish`, and the click
    handler that opens OG mode still said `requestedMode = name`. Nothing
    declared it, so the handler threw a ReferenceError BEFORE applyMode ever
    ran -- and a listener error does not propagate to the caller, so from the
    outside the OG button simply did nothing. No mode change, no message, no
    clue. It shipped, and it was found by clicking the button in a browser.

    An honest note on the rule: a first attempt at this test treated `{ x = ` as
    a destructuring default and whitelisted it, which silently swallowed
    `{ requestedMode = name; ... }` -- the arrow-function body -- and reported
    the buggy file as clean. Counting total appearances instead is cruder and
    actually works: a declared variable is mentioned at least twice.
    """
    import re

    for page in ("deck.html", "wallet.html", "shop.html", "index.html"):
        path = REPO_ROOT / "site" / page
        if not path.exists():
            continue
        html = path.read_text(encoding="utf-8")
        source = "\n".join(re.findall(r"<script>(.*?)</script>", html, re.S))
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        source = re.sub(r"(?m)//.*$", "", source)

        assigned = set(re.findall(r"(?<![.\w$?])([A-Za-z_$][\w$]*)\s*=(?![=>])", source))
        orphans = [
            name
            for name in sorted(assigned)
            if len(re.findall(r"(?<![\w$.])" + re.escape(name) + r"(?![\w$])", source)) == 1
        ]
        assert not orphans, (
            f"{page} assigns to {orphans}, which appear nowhere else in the file. "
            "That is the signature of a merge that kept one branch's variable and "
            "left the other branch's assignment behind."
        )
