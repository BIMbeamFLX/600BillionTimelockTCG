"""Build the standalone image-and-text gallery for all 295 Edition One cards."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sqlite3
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

NO_COST = "—"
NO_COST_KEY = "none"
VARIABLE_COST = "X"

# Display order only. Every value in a facet is derived from the card files;
# anything the data adds beyond these lists is appended alphabetically.
AFFINITY_ORDER = ["Power", "Bitcoin", "Keys", "Signal", "Timelock", "Neutral"]
# Rarest first is the wrong order for a filter row; this is the order a player
# reads a ladder in, and it must list every tier the card data can hold or the
# facet silently drops cards from the count.
RARITY_ORDER = ["basic", "common", "uncommon", "rare", "vault", "genesis", "promo"]
AFFINITY_ICONS = {
    "Power": "power",
    "Bitcoin": "bitcoin",
    "Keys": "keys",
    "Signal": "signal",
    "Timelock": "timelock",
}
AFFINITY_TOKENS = {
    "Power": "--power",
    "Bitcoin": "--bitcoin",
    "Keys": "--keys",
    "Signal": "--signal",
    "Timelock": "--timelock",
    "Neutral": "--neutral",
}


def cost_value(cost: str) -> int:
    """Total pips of a printed cost: generic digits plus one per affinity symbol.

    Cards that print no cost sort first as -1. ``X`` is a variable generic, so
    it adds nothing here — the cost filter buckets those separately.
    """
    if not cost or cost == NO_COST:
        return -1
    generic = sum(int(chunk) for chunk in re.findall(r"\d+", cost))
    pips = sum(1 for char in cost if char.isalpha() and char.upper() != VARIABLE_COST)
    return generic + pips


def cost_key(cost: str) -> str:
    """Bucket a printed cost for the cost filter: ``none``, ``X`` or a total."""
    if not cost or cost == NO_COST:
        return NO_COST_KEY
    if VARIABLE_COST in cost.upper():
        return VARIABLE_COST
    return str(cost_value(cost))


def gallery_records(
    cards: list[dict[str, Any]],
    face_manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    """Join card text with its Node Runner face.

    The release manifest also contains the shared back and one promo, so only
    Edition One ids participate in this exact-set check.
    """
    faces = {item["id"]: item for item in face_manifest["files"] if item.get("id")}
    if set(faces) != {card["id"] for card in cards}:
        raise ValueError("card text and the face lock disagree on card count")
    return [
        {
            "id": card["id"],
            "name": card["name"],
            "type": card["card_type"],
            "typeLine": card["type_line"],
            "affinity": card["affinity"] or ["Neutral"],
            "cost": card["cost"] or NO_COST,
            "costKey": cost_key(card["cost"]),
            "costValue": cost_value(card["cost"]),
            "stats": card["action_resilience"],
            "rarity": card["rarity"],
            "faceFile": faces[card["id"]]["file"],
            "rules": card["rules_text"],
            "flavor": card["flavor_text"],
            "help": card["help_text"],
            "note": card["protocol_note"],
            "source": card["protocol_source"],
            "searchTags": (
                "fips.network submarine node balloons" if card["id"] == "E1-202" else ""
            ),
            "promo": False,
        }
        for card in cards
    ]


def promo_gallery_records(
    cards: list[dict[str, Any]],
    promo_manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    """Convert separately locked promo cards into gallery records."""
    if len(promo_manifest["files"]) != len(cards):
        raise ValueError("promo text and the promo face lock disagree on card count")
    return [
        {
            "id": card["id"],
            "name": card["name"],
            "type": card["card_type"],
            "typeLine": card["type_line"],
            "affinity": card["affinity"] or ["Neutral"],
            "cost": card["cost"] or NO_COST,
            "costKey": cost_key(card["cost"]),
            "costValue": cost_value(card["cost"]),
            "stats": card["action_resilience"],
            "rarity": card["rarity"],
            "faceFile": f"{card['name']}.webp",
            "rules": card["rules_text"],
            "flavor": card["flavor_text"],
            "help": card["help_text"],
            "note": card["protocol_note"],
            "source": card["protocol_source"],
            "searchTags": "fips.network global balloon mesh submarine node balloons",
            "promo": True,
        }
        for card in cards
    ]


def _facet(
    counts: Counter[str],
    order: list[str],
    label: Callable[[str], str],
) -> list[dict[str, Any]]:
    """Turn a value tally into an ordered facet, keeping every value the data has."""
    known = [value for value in order if value in counts]
    extra = sorted(value for value in counts if value not in order)
    return [
        {"value": value, "label": label(value), "count": counts[value]} for value in known + extra
    ]


def _cost_order(counts: Counter[str]) -> list[str]:
    """Numbers ascending, then the variable bucket, then the costless cards."""
    numeric = sorted((value for value in counts if value.isdigit()), key=int)
    return [*numeric, VARIABLE_COST, NO_COST_KEY]


def _cost_label(value: str) -> str:
    if value == NO_COST_KEY:
        return "No cost"
    return f"Cost {value}"


def gallery_facets(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive every filter list from the built records — never from a guess."""
    affinities = Counter(name for record in records for name in record["affinity"])
    types = Counter(record["type"] for record in records)
    rarities = Counter(record["rarity"] for record in records)
    costs = Counter(record["costKey"] for record in records)
    printings = Counter("promo" if record["promo"] else "e1" for record in records)
    return {
        "affinities": _facet(affinities, AFFINITY_ORDER, str),
        "types": _facet(types, sorted(types), str),
        "rarities": _facet(rarities, RARITY_ORDER, str.title),
        "costs": _facet(costs, _cost_order(costs), _cost_label),
        "printings": _facet(
            printings,
            ["e1", "promo"],
            lambda value: "Promo" if value == "promo" else "Edition One",
        ),
        "affinityIcons": AFFINITY_ICONS,
        "affinityTokens": AFFINITY_TOKENS,
    }


def _options(facet: list[dict[str, Any]], all_label: str) -> str:
    """Emit the select options server-side so the controls exist without JS."""
    rows = [f'<option value="">{html.escape(all_label)}</option>']
    rows += [
        '<option value="{value}">{label}</option>'.format(
            value=html.escape(item["value"]),
            label=html.escape(f"{item['label']} · {item['count']}"),
        )
        for item in facet
    ]
    return "\n          ".join(rows)


def _chips(facet: list[dict[str, Any]]) -> str:
    """Emit one affinity chip per value the card files actually use."""
    rows = []
    for item in facet:
        value = item["value"]
        token = AFFINITY_TOKENS.get(value, "--neutral")
        icon = AFFINITY_ICONS.get(value)
        disc = ""
        if icon:
            disc = f'<span class="aff"><img src="../art/resources/{icon}.svg" alt=""></span>'
        # Below ~360px an icon chip drops its label, so the label can no longer
        # be the accessible name — aria-label carries it at every width.
        rows.append(
            f'<button class="chip{" chip--icon" if icon else ""}" type="button"'
            f' data-aff="{html.escape(value)}" aria-pressed="false"'
            f' aria-label="{html.escape(value)}" style="--aff: var({token})">{disc}'
            f'<span class="lbl">{html.escape(value)}</span></button>'
        )
    return "\n        ".join(rows)


def record_site_decision(
    db_path: Path,
    records: list[dict[str, Any]],
    output_path: Path,
) -> None:
    """Record the gallery build before writing HTML."""
    payload = json.dumps(records, sort_keys=True, ensure_ascii=False).encode()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS site_builds (
                artifact TEXT PRIMARY KEY,
                input_fingerprint TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO site_builds (
                artifact, input_fingerprint, record_count, status, updated_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                str(output_path),
                hashlib.sha256(payload).hexdigest(),
                len(records),
                "planned",
                "auto:codex:e1-image-text-gallery",
            ),
        )
        connection.commit()


def complete_site_decision(db_path: Path, output_path: Path) -> None:
    """Mark the HTML artifact generated after a successful write."""
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE site_builds SET status='generated' WHERE artifact=?",
            (str(output_path),),
        )
        connection.commit()


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09080b">
  <meta name="description"
    content="Every 600B Timelock TCG Edition One and promo card, with artwork and text.">
  <title>600B Timelock TCG — All Cards</title>
  <link rel="icon" href="../art/brand/600B-logo-primary.png">
  <link rel="preload" href="../art/fonts/Anton-Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="600b.css">
  <!-- The napplet adapter, loaded before anything paints. It maps a shell's
       palette onto the very custom properties 600b.css already uses (and never
       onto the five affinity Plate colours, which are brand-fixed), and it is
       where this page asks for storage rather than reaching at localStorage.
       On the plain website every optional domain is simply absent, which is
       the fallback path — not a special mode. -->
  <script src="napplet.js"></script>
<script src="bugreport.js" defer></script>
  <script>if (globalThis.E1Napplet) E1Napplet.theme.start();</script>
  <style>
    /* Page-local only: the catalog grid, the filter console and the detail
       dialog. Tokens, type, nav, footer and the card DNA (framed + pads,
       steel banner, chip square, terminal line) all come from 600b.css. */
    body {
      background:
        radial-gradient(circle at 16% 0, rgba(247, 147, 26, .16), transparent 30rem),
        radial-gradient(circle at 88% 8%, rgba(116, 71, 184, .2), transparent 34rem),
        var(--black);
    }
    .hero { max-width: 1560px; margin: 0 auto; padding: clamp(40px, 6vw, 84px) var(--pad) 22px; }
    .hero h1 { margin: 10px 0 16px; }
    .hero .lead { margin-bottom: 0; font-size: 18px; }

    /* ------------------------------------------------- the filter console */
    /* Clears the shared .nav: 10px pad + 38px mark + 10px pad + 1px rule. */
    .console {
      position: sticky;
      top: 59px;
      z-index: 18;
      max-width: 1560px;
      margin: 0 auto 26px;
      padding: 8px var(--pad) 16px;
      background: linear-gradient(180deg, rgba(9, 8, 11, .97) 82%, rgba(9, 8, 11, 0));
      backdrop-filter: blur(14px);
    }
    .console .framed { padding: 14px; background: rgba(17, 16, 20, .94); }
    /* auto-fit, so the console reflows at ANY width instead of assuming one:
       empty tracks collapse, the five selects share whatever room there is, and
       the floor is min(100%, …) so a single column can never be wider than its
       container. There is no width at which this row overflows sideways. */
    .control-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 132px), 1fr));
    }
    .field--search { grid-column: 1 / -1; }
    .field { display: grid; gap: 6px; min-width: 0; }
    .field > .banner { justify-self: start; }
    .field input, .field select {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      color: var(--cream);
      background: var(--panel);
      border: 1px solid var(--line);
      outline: none;
    }
    .field input:focus, .field select:focus { border-color: var(--ember); }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .chips .chip { min-height: 40px; padding: 6px 11px; background: transparent; cursor: pointer; }
    .chips .chip:hover { color: var(--cream); border-color: var(--line-strong); }
    .chip[aria-pressed="true"] {
      color: var(--aff, var(--cream));
      background: color-mix(in srgb, var(--aff, var(--purple)) 16%, transparent);
      border-color: var(--aff, var(--purple));
    }
    /* The icon keeps its own dark disc so the white Keys plate never sits on
       a light chip surface; the disc is tinted with its own affinity hue. */
    .aff {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--aff, var(--neutral)) 24%, var(--black));
      border: 1px solid color-mix(in srgb, var(--aff, var(--neutral)) 55%, transparent);
    }
    .aff img { width: 13px; height: 13px; }
    .status { margin-top: 13px; opacity: 1; }
    .status .side { display: flex; align-items: center; gap: 12px; min-width: 0; }
    /* LEFT CLICK = ACT. One press swaps every face between artwork and the
       text cards, which is also the presentation a shell without the resource
       domain gets by itself. */
    .status .chip { min-height: 38px; cursor: pointer; }
    .status .chip:not(.chip--on) { background: transparent; }
    .status .chip:hover:not(:disabled):not(.chip--on) {
      color: var(--cream);
      border-color: var(--line-strong);
    }
    .status .chip:disabled { cursor: not-allowed; opacity: .72; }
    #counter { color: var(--cream); }
    .flash { color: var(--ember); }
    .hint { color: var(--ink-dim); letter-spacing: .12em; }
    .clear {
      padding: 9px 12px;
      color: var(--black);
      background: var(--ember);
      border: 0;
      cursor: pointer;
      font: 11px/1 var(--display);
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    /* ------------------------------------------------------- the catalog */
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
      gap: clamp(16px, 2vw, 28px);
      max-width: 1560px;
      margin: 0 auto;
      padding: 0 var(--pad) 110px;
    }
    .catalog-card {
      display: flex;
      min-width: 0;
      overflow: hidden;
      flex-direction: column;
      background: linear-gradient(160deg, rgba(25, 21, 31, .98), rgba(13, 12, 16, .98));
      border: 1px solid var(--line);
      box-shadow: 0 18px 48px rgba(0, 0, 0, .34);
      transition: transform .16s ease, border-color .16s ease;
    }
    /* Beats .catalog-card's display, so filtering can hide with one attribute. */
    .catalog-card[hidden] { display: none; }
    .catalog-card:hover { border-color: var(--ember); transform: translateY(-4px); }
    /* The box is reserved by the button, not by whatever ends up inside it, so
       a face that arrives late — or never, and is drawn as text instead — moves
       nothing on the page. */
    .art-button {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: 5 / 7;
      padding: 0;
      overflow: hidden;
      color: inherit;
      background: #000;
      border: 0;
      border-bottom: 1px solid var(--line);
      cursor: zoom-in;
    }
    .art-button--text { background: var(--soot); cursor: pointer; }
    /* This chip used to be painted on every tile permanently: 296 ember labels
       stamped across the bottom-right corner of 296 finished card faces, on the
       one page whose whole job is to show the artwork. It is an affordance, so
       it appears when the card is actually being pointed at — and on
       focus-visible too, so it is never hidden from the keyboard. */
    .art-button::after {
      position: absolute;
      right: 10px;
      bottom: 10px;
      content: "DETAILS";
      padding: 5px 7px;
      color: var(--black);
      background: var(--ember);
      font: 11px/1 var(--display);
      letter-spacing: .08em;
      opacity: 0;
      transition: opacity .14s ease;
    }
    .art-button:hover::after,
    .art-button:focus-visible::after { opacity: 1; }
    @media (hover: none) { .art-button::after { opacity: 1; } }
    .art-button img {
      display: block; width: 100%; height: 100%; object-fit: contain;
      /* The same weight a card carries everywhere else on the site. */
      filter: drop-shadow(0 3px 0 rgba(9,8,11,.85)) drop-shadow(0 16px 30px rgba(0,0,0,.55));
    }

    /* ----------------------------------------------- the text-card fallback */
    /* Card faces are NOT bundled (napplet spec, "cards"): they come from the
       published asset location. When that cannot be reached — a shell with no
       resource domain, a sandbox that blocks outbound fetch, or one file that
       simply 404s — the spec's fallback is a text-rendered card. So the tile
       draws the card itself, out of data it already has, wearing the printed
       frame: corner pads, steel type banner, chip squares, terminal footer. */
    .text-face {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 9px;
      width: 100%;
      height: 100%;
      aspect-ratio: 5 / 7;
      padding: 16px 15px 42px;
      overflow: hidden;
      text-align: left;
      background:
        repeating-linear-gradient(122deg, rgba(185, 145, 228, .07) 0 1px, transparent 1px 14px),
        linear-gradient(178deg, var(--panel-2), var(--soot));
      border: 1px solid var(--line-strong);
      outline: 1px solid rgba(255, 106, 0, .2);
      outline-offset: -7px;
    }
    .text-face > .pad {
      position: absolute;
      width: 8px;
      height: 8px;
      background: var(--ember);
      border: 1px solid var(--purple);
    }
    .text-face > .pad.tl { top: 3px; left: 3px; }
    .text-face > .pad.tr { top: 3px; right: 3px; }
    .text-face > .pad.bl { bottom: 3px; left: 3px; }
    .text-face > .pad.br { bottom: 3px; right: 3px; }
    .tf-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .tf-name {
      min-width: 0;
      color: var(--cream);
      font: clamp(19px, 2.3vw, 26px)/1.02 var(--display);
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
    .tf-line { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .tf-rules {
      margin: 0;
      overflow: hidden;
      color: var(--cream);
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.5;
    }
    /* Pinned left so the DETAILS chip in the corner never lands on top of it. */
    .tf-foot {
      position: absolute;
      right: 96px;
      bottom: 12px;
      left: 15px;
      justify-content: flex-start;
      gap: 14px;
    }
    .card-copy { display: flex; flex: 1; flex-direction: column; padding: 16px 18px 20px; }
    .card-kicker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--purple);
      font: 900 11px/1 var(--body);
      letter-spacing: .11em;
      text-transform: uppercase;
    }
    .card-kicker .rarity { margin-left: auto; }
    .card-kicker .promo-tag { color: var(--ember); }
    /* TOUCH HAS NO RIGHT CLICK. Same menu, reachable with one tap or one tab. */
    .card-kicker .more {
      flex: none;
      min-width: 34px;
      min-height: 34px;
      margin: -8px -7px -8px 0;
      padding: 0;
      color: var(--purple);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      font: 17px/1 var(--body);
      letter-spacing: 0;
    }
    .card-kicker .more:hover { color: var(--ember); border-color: var(--line); }
    .card-copy h2 { margin: 9px 0 0; font-size: clamp(24px, 2.4vw, 29px); letter-spacing: .005em; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 11px;
      color: var(--muted);
      font-size: 13px;
    }
    .meta .chip-num { min-width: 42px; padding: 3px 7px 5px; }
    .meta .chip-num b { font-size: 16px; }
    .rules {
      margin: 15px 0 0;
      padding: 13px 0 0;
      color: var(--cream);
      border-top: 1px solid var(--line);
      font-weight: 700;
    }
    .flavor {
      margin: auto 0 0;
      padding-top: 15px;
      color: var(--purple);
      font: italic 15px/1.45 Georgia, serif;
    }
    /* Sits above the grid, in the ember the site uses for "act", because it is
       the answer to "where did all the pictures go". */
    .face-notice {
      margin: 0 0 10px; padding: 9px 12px;
      color: var(--cream); background: rgba(255,106,0,.08);
      border-left: 3px solid var(--ember);
      font-size: 13px; line-height: 1.5;
    }
    .face-notice__back {
      margin-left: 6px; padding: 3px 9px; cursor: pointer;
      background: var(--ember); color: var(--black); border: 0;
      font: 11px/1 var(--display); letter-spacing: .07em; text-transform: uppercase;
    }
    .face-notice__back:hover { filter: brightness(1.12); }
    .empty {
      grid-column: 1 / -1;
      padding: 70px 20px;
      color: var(--muted);
      border: 1px dashed var(--line);
      text-align: center;
    }

    /* --------------------------------------------------- right-click menu */
    .menu {
      position: fixed;
      z-index: 60;
      min-width: min(214px, calc(100% - 24px));
      max-width: min(260px, calc(100% - 24px));
      padding: 5px;
      background: var(--soot);
      border: 1px solid var(--purple-deep);
      box-shadow: 0 22px 60px #000;
    }
    .menu strong {
      display: block;
      padding: 8px 9px 9px;
      overflow: hidden;
      color: var(--power);
      border-bottom: 1px solid var(--line);
      font: 11px/1.2 var(--display);
      letter-spacing: .14em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .menu button {
      display: block;
      width: 100%;
      padding: 10px 9px;
      color: var(--cream);
      background: transparent;
      border: 0;
      cursor: pointer;
      font-size: 13px;
      text-align: left;
    }
    .menu button:hover { color: var(--ember); background: var(--panel-2); }

    /* -------------------------------------------------------- the dialog */
    /* Percentages, not vw/vh: a top-layer dialog resolves them against the
       viewport WITHOUT the scrollbar, so the page never gains a sideways
       scroll just because the dialog is open. dvh keeps a phone's collapsing
       address bar from cropping the bottom. */
    dialog {
      width: min(1180px, calc(100% - 24px));
      max-height: calc(100% - 24px);
      max-height: calc(100dvh - 24px);
      padding: 0;
      overflow: auto;
      color: var(--cream);
      background: var(--soot);
      border: 1px solid var(--purple-deep);
      border-top: 7px solid var(--ember);
      box-shadow: 0 30px 120px #000;
    }
    dialog::backdrop { background: rgba(0, 0, 0, .84); backdrop-filter: blur(8px); }
    .modal-grid { display: grid; grid-template-columns: minmax(320px, 540px) minmax(0, 1fr); }
    .modal-art { display: grid; min-width: 0; background: #000; }
    .modal-art > img { width: 100%; min-height: 100%; object-fit: contain; }
    .modal-art > .text-face { height: auto; align-self: start; }
    .details { position: relative; min-width: 0; padding: clamp(24px, 5vw, 50px); }
    .close {
      position: absolute;
      top: 15px;
      right: 15px;
      width: 40px;
      height: 40px;
      color: var(--cream);
      background: var(--black);
      border: 1px solid var(--line);
      cursor: pointer;
      font-size: 23px;
    }
    .modal-id { color: var(--ember); font-weight: 900; letter-spacing: .12em; }
    .details h2 { margin: 8px 44px 5px 0; font-size: clamp(34px, 5vw, 60px); }
    .detail-block { margin-top: 25px; padding-top: 19px; border-top: 1px solid var(--line); }
    .detail-block strong {
      display: block;
      margin-bottom: 8px;
      color: var(--ember);
      font: 18px/1 var(--display);
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .detail-block p { margin: 0; color: var(--muted); }
    .detail-block .modal-rules { color: var(--cream); font-weight: 700; }
    .modal-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }

    @media (max-width: 760px) {
      /* The shared nav wraps to a variable height here, so no fixed offset is
         right — let the console scroll with the gallery instead. */
      .console { position: static; }
      .hint { display: none; }
      .modal-grid { grid-template-columns: minmax(0, 1fr); }
      .modal-art > img { max-height: 72vh; max-height: 72dvh; object-fit: contain; }
    }
    /* The napplet's TINY shape (spec: below ~360px). Nothing is cut off and
       nothing scrolls sideways — the console stacks, the affinity chips
       collapse to their icons, and each tile keeps name, cost, type and rules. */
    @media (max-width: 360px) {
      .hero { padding-top: 26px; }
      .hero .lead { font-size: 15px; }
      .console .framed { padding: 10px; }
      .chips .chip { padding: 6px 8px; }
      .chips .chip--icon .lbl { display: none; }
      .card-copy { padding: 12px 13px 15px; }
      .card-copy h2 { font-size: 23px; }
      .flavor { display: none; }
      .text-face { padding: 12px 12px 38px; }
      .tf-foot { right: 90px; left: 12px; }
      .details { padding: 20px 15px 26px; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<nav class="nav">
  <img class="nav__mark" src="../art/brand/600B-logo-primary.png" alt="">
  <a class="nav__brand" href="index.html" style="text-decoration:none;color:inherit">
    600B TIMELOCK TCG<small>WE STACK · WE BUILD · WE MEME</small>
  </a>
  <div class="nav__links">
    <a class="link" href="play.html">Play</a>
    <a class="link" href="matchmaking.html">Play online</a>
    <a class="link" href="shop.html">Shop</a>
    <a class="link" href="cards.html" aria-current="page">Cards</a>
    <a class="link" href="deck.html">Stacks</a>
    <a class="link" href="rules.html">Rules</a>
    <a class="link" href="lore.html">Lore</a>
    <a class="link" href="leaderboard.html">Leaderboard</a>
  </div>
</nav>

  <main id="main">
    <section class="hero">
      <div class="eyebrow">600 Billion · 295 E1 + 1 Promo · Complete Catalog</div>
      <h1>All Cards. <span class="accent">Artwork + Text.</span></h1>
      <p class="lead">Search name, rules, flavour, type line and tags, then filter by
      affinity, card type, cost, rarity and printing. Press <b>/</b> to search,
      <b>Esc</b> to clear. Left-click a card for details; right-click — or press
      <b>⋯</b>, which is the same menu without a mouse — for its menu.
      Every filtered view has its own link, so a search can be shared as it stands,
      and every card has one of its own — <span class="mono">cards.html?card=E1-001</span>,
      which is what <b>Copy link</b> hands you. Set numbers never move, so that link
      is what other pages cite.</p>
    </section>
    <section class="console" aria-label="Card search and filters">
      <div class="framed">
        <span class="pad tl"></span><span class="pad tr"></span>
        <span class="pad bl"></span><span class="pad br"></span>
        <div class="control-grid">
          <label class="field field--search">
            <span class="banner">Search</span>
            <input id="search" type="search" autocomplete="off" spellcheck="false"
              placeholder="Name, ID, rules, flavour, tag …">
          </label>
          <label class="field">
            <span class="banner">Type</span>
            <select id="typeFilter">
          __TYPE_OPTIONS__
            </select>
          </label>
          <label class="field">
            <span class="banner">Cost</span>
            <select id="costFilter">
          __COST_OPTIONS__
            </select>
          </label>
          <label class="field">
            <span class="banner">Rarity</span>
            <select id="rarityFilter">
          __RARITY_OPTIONS__
            </select>
          </label>
          <label class="field">
            <span class="banner">Printing</span>
            <select id="printFilter">
          __PRINT_OPTIONS__
            </select>
          </label>
          <label class="field">
            <span class="banner">Sort</span>
            <select id="sortOrder">
              <option value="id">Set number</option>
              <option value="name">Name</option>
              <option value="cost">Cost</option>
              <option value="rarity">Rarity</option>
            </select>
          </label>
        </div>
        <div class="chips" id="affinityChips" role="group" aria-label="Filter by affinity">
        __AFFINITY_CHIPS__
        </div>
        <div class="terminal-line status">
          <div class="side">
            <span id="counter" aria-live="polite">__TOTAL__ CARDS</span>
            <span class="flash" id="flash"></span>
          </div>
          <div class="side">
            <span class="hint">RIGHT-CLICK OR PRESS ⋯ FOR A CARD'S MENU</span>
            <button class="chip" id="faceToggle" type="button"
              aria-pressed="false">Text cards</button>
            <button class="clear" id="clearFilters" type="button" hidden>Clear ✕</button>
          </div>
        </div>
      </div>
    </section>
    <!-- When every card is drawn as text the page looks broken rather than
         configured, so it says which it is. A chip reading "Text cards" is not
         enough signal for 296 pictures going missing. -->
    <p class="face-notice" id="faceNotice" role="status" hidden></p>
    <section class="gallery" id="gallery">
      <div class="empty" id="emptyState" hidden>No cards match these filters.</div>
    </section>
  </main>
  <dialog id="cardDialog">
    <div class="modal-grid">
      <div class="modal-art" id="modalArt"><img id="modalImage" alt=""></div>
      <div class="details">
        <button class="close" id="closeDialog" aria-label="Close details">×</button>
        <div class="modal-id" id="modalId"></div>
        <h2 id="modalName"></h2>
        <div class="meta" id="modalMeta"></div>
        <div class="detail-block">
          <strong>Rules Text</strong>
          <p class="modal-rules" id="modalRules"></p>
        </div>
        <div class="detail-block">
          <strong>Flavor</strong>
          <p id="modalFlavor"></p>
        </div>
        <div class="detail-block">
          <strong>Simple Guide · no rules effect</strong>
          <p id="modalHelp"></p>
        </div>
        <div class="detail-block">
          <strong>Protocol Note · no rules effect</strong>
          <p id="modalNote"></p>
          <p><a id="modalSource" target="_blank" rel="noreferrer">
            Open primary source →</a></p>
        </div>
        <div class="modal-actions">
          <a class="btn btn--small" id="modalFace" target="_blank">Open rendered card</a>
          <button class="btn btn--small btn--ghost" id="modalCopy" type="button">Copy link</button>
        </div>
      </div>
    </div>
  </dialog>
  <div class="menu" id="cardMenu" role="menu" hidden></div>

<footer class="site-footer">
  <span>600 000 000 000 · Edition One · E1.0-draft</span>
  <a href="https://join.600.wtf" rel="noopener">join.600.wtf</a>
  <span class="tag">WE STACK. WE BUILD. WE MEME.</span>
</footer>

  <script src="blob-map.js"></script>
  <script src="faces.js"></script>
  <script>
    "use strict";
    const CARDS = __CARD_DATA__;
    const FACETS = __FACETS__;
    const FACES = "../art/cards/node-runner-web/";
    const SORTS = ["id", "name", "cost", "rarity"];
    const FACE_KEY = "600b:gallery-faces";
    const byId = (id) => document.getElementById(id);

    /* THE ONE SEAM. Storage, identity and the palette are asked of the adapter,
       never of the platform: inside a shell those are NAPs, on the website they
       are localStorage and the stylesheet's own tokens. This page keeps no
       identity of its own — a catalog has nobody to be — so the only domain it
       spends is storage, for one remembered preference. */
    const nap = globalThis.E1Napplet || null;

    const gallery = byId("gallery");
    const emptyState = byId("emptyState");
    const search = byId("search");
    const chips = byId("affinityChips");
    const counter = byId("counter");
    const flash = byId("flash");
    const clearButton = byId("clearFilters");
    const faceToggle = byId("faceToggle");
    const dialog = byId("cardDialog");
    const menu = byId("cardMenu");
    const selects = {
      type: byId("typeFilter"),
      cost: byId("costFilter"),
      rarity: byId("rarityFilter"),
      print: byId("printFilter"),
      sort: byId("sortOrder"),
    };

    const values = {
      aff: FACETS.affinities.map((item) => item.value),
      type: FACETS.types.map((item) => item.value),
      cost: FACETS.costs.map((item) => item.value),
      rarity: FACETS.rarities.map((item) => item.value),
      print: FACETS.printings.map((item) => item.value),
    };
    const rarityRank = new Map(FACETS.rarities.map((item, index) => [item.value, index]));
    const state = { q: "", aff: [], type: "", cost: "", rarity: "", print: "", sort: "id" };

    /* One lowercase haystack per card, built once: the search then costs a
       substring scan per term instead of rebuilding 296 strings per keystroke. */
    const haystacks = CARDS.map((card) => [
      card.id, card.name, card.type, card.typeLine, card.rarity, card.cost, card.stats,
      card.rules, card.flavor, card.help, card.note, card.searchTags,
      card.affinity.join(" "), card.promo ? "promo" : "",
    ].join(" ").toLowerCase());

    function faceUrl(card) {
      return FACES + encodeURIComponent(card.faceFile);
    }

    /* ------------------------------------------------------------- faces */

    /* Card faces are not bundled: the spec fetches them from the published
       asset location and falls back to a TEXT-RENDERED CARD when it cannot.
       Three ways that happens, and this answers all three the same way:
         - a shell that was handed no resource domain (assets unreachable),
         - a sandbox that blocks outbound fetch (canReachInternet is false),
         - one file that simply is not there (the img errors; that tile alone
           becomes text, so a dead mirror is never a grid of broken images).
       On the plain website there is no shell and ordinary URLs work, which is
       why the absence of an adapter means artwork rather than text. */
    function facesReachable() {
      if (!nap) return true;
      if (!nap.canReachInternet()) return false;
      if (nap.present && !nap.has("resource")) return false;
      return true;
    }

    const artHosts = new Array(CARDS.length);
    let faceMode = facesReachable() ? "art" : "text";

    /* Faces resolve only when a tile nears the viewport. E1Faces.setFace()
       fetches from Blossom the moment it is called, so calling it for all 296
       cards up front would be 296 requests before the first scroll. The host
       button is what is observed, so a text card is built just as lazily. */
    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            paintFace(Number(entry.target.dataset.index));
          }
        }, { rootMargin: "700px 0px" })
      : null;

    function paintFace(index) {
      const host = artHosts[index];
      if (!host || host.dataset.mode) return;
      const card = CARDS[index];
      if (faceMode === "text") return drawTextFace(host, card);
      host.dataset.mode = "art";
      const image = document.createElement("img");
      image.alt = card.name + " card";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        host.dataset.mode = "text";
        drawTextFace(host, card);
      }, { once: true });
      host.append(image);
      if (globalThis.E1Faces) E1Faces.setFace(image, card.faceFile);
      else image.src = faceUrl(card);
    }

    function drawTextFace(host, card) {
      host.dataset.mode = "text";
      host.classList.add("art-button--text");
      host.replaceChildren(textFace(card));
    }

    /* Empty every host and hand them back to the observer, so a mode change
       costs one repaint of what is on screen rather than 296 of everything. */
    function repaintFaces() {
      for (let index = 0; index < artHosts.length; index += 1) {
        const host = artHosts[index];
        host.dataset.mode = "";
        host.classList.remove("art-button--text");
        host.replaceChildren();
        if (observer) observer.observe(host);
        else paintFace(index);
      }
    }

    /* Says which of the two reasons is in play, because they need different
       answers: a choice can be undone here, an unreachable mirror cannot. */
    function syncFaceNotice() {
      const notice = byId("faceNotice");
      if (!notice) return;
      if (faceMode !== "text") { notice.hidden = true; notice.replaceChildren(); return; }
      notice.hidden = false;
      notice.replaceChildren();
      if (!facesReachable()) {
        notice.append(document.createTextNode(
          "Card art cannot be fetched from here, so every card is drawn as text. "
          + "The rules and costs below are the real ones."));
        return;
      }
      notice.append(document.createTextNode("Text cards are on, so the artwork is hidden. "));
      const back = document.createElement("button");
      back.type = "button";
      back.className = "face-notice__back";
      back.textContent = "Show the art";
      back.addEventListener("click", () => setFaceMode("art", true));
      notice.append(back);
    }

    function syncFaceToggle() {
      const isText = faceMode === "text";
      faceToggle.setAttribute("aria-pressed", String(isText));
      faceToggle.classList.toggle("chip--on", isText);
      syncFaceNotice();
    }

    function setFaceMode(mode, remember) {
      const next = mode === "text" ? "text" : "art";
      if (next === faceMode) return;
      faceMode = next;
      syncFaceToggle();
      repaintFaces();
      if (dialog.open && openCard.current) paintModalFace(openCard.current);
      if (remember && nap) nap.storage.set(FACE_KEY, faceMode).catch(() => {});
    }

    function affinityDisc(name) {
      const disc = document.createElement("span");
      disc.className = "aff";
      disc.title = name;
      disc.style.setProperty("--aff", "var(" + (FACETS.affinityTokens[name] || "--neutral") + ")");
      const icon = FACETS.affinityIcons[name];
      if (icon) {
        const image = document.createElement("img");
        image.src = "../art/resources/" + icon + ".svg";
        image.alt = "";
        disc.append(image);
      }
      return disc;
    }

    function chipNum(value, label) {
      const chip = document.createElement("span");
      chip.className = "chip-num";
      const number = document.createElement("b");
      number.textContent = value;
      const caption = document.createElement("span");
      caption.textContent = label;
      chip.append(number, caption);
      return chip;
    }

    function metaText(card) {
      return card.typeLine + " · " + card.affinity.join(" / ") + " · Cost " + card.cost +
        (card.stats ? " · " + card.stats : "");
    }

    function metaRow(card) {
      const meta = document.createElement("div");
      meta.className = "meta";
      const banner = document.createElement("span");
      banner.className = "banner";
      banner.textContent = card.typeLine;
      meta.append(banner);
      for (const name of card.affinity) meta.append(affinityDisc(name));
      meta.append(chipNum(card.cost, "COST"));
      if (card.stats) meta.append(chipNum(card.stats, "ACT/RES"));
      return meta;
    }

    /* The card, drawn from the data the page already carries: name, cost, type
       line, affinities, rules text, set number. Same frame the printed face
       wears, so a catalog with no artwork still reads as a catalog of cards.
       role="img" because the copy block below repeats all of it in prose — a
       screen reader should hear this card once, not twice. */
    function textFace(card) {
      const face = document.createElement("div");
      face.className = "text-face";
      face.setAttribute("role", "img");
      face.setAttribute("aria-label", card.name + " card, drawn as text");
      for (const corner of ["tl", "tr", "bl", "br"]) {
        const pad = document.createElement("span");
        pad.className = "pad " + corner;
        face.append(pad);
      }
      const head = document.createElement("div");
      head.className = "tf-head";
      const name = document.createElement("span");
      name.className = "tf-name";
      name.textContent = card.name;
      head.append(name, chipNum(card.cost, "COST"));

      const line = document.createElement("div");
      line.className = "tf-line";
      const banner = document.createElement("span");
      banner.className = "banner";
      banner.textContent = card.typeLine;
      line.append(banner);
      for (const affinity of card.affinity) line.append(affinityDisc(affinity));

      const rules = document.createElement("p");
      rules.className = "tf-rules";
      rules.textContent = card.rules;

      const foot = document.createElement("div");
      foot.className = "terminal-line tf-foot";
      const set = document.createElement("span");
      set.textContent = card.id;
      const stats = document.createElement("span");
      stats.textContent = card.stats || card.rarity.toUpperCase();
      foot.append(set, stats);

      face.append(head, line, rules, foot);
      return face;
    }

    function buildTile(card, index) {
      const article = document.createElement("article");
      article.className = "catalog-card";
      article.dataset.id = card.id;

      const button = document.createElement("button");
      button.className = "art-button";
      button.type = "button";
      button.dataset.index = String(index);
      button.dataset.mode = "";
      button.setAttribute("aria-label", "Open details for " + card.name);
      button.addEventListener("click", () => openCard(card));
      artHosts[index] = button;
      if (observer) observer.observe(button);
      else paintFace(index);

      const copy = document.createElement("div");
      copy.className = "card-copy";
      const kicker = document.createElement("div");
      kicker.className = "card-kicker";
      const id = document.createElement("span");
      id.className = "mono";
      id.textContent = card.id;
      const rarity = document.createElement("span");
      rarity.className = card.promo ? "rarity promo-tag" : "rarity";
      rarity.textContent = card.rarity;
      /* Right-click is a mouse. This is the same menu for the other half. */
      const more = document.createElement("button");
      more.className = "more";
      more.type = "button";
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-label", "Menu for " + card.name);
      more.textContent = "⋯";
      more.addEventListener("click", (event) => openMenu(event, card, more));
      kicker.append(id, rarity, more);
      const title = document.createElement("h2");
      title.textContent = card.name;
      const rules = document.createElement("p");
      rules.className = "rules";
      rules.textContent = card.rules;
      const flavor = document.createElement("p");
      flavor.className = "flavor";
      flavor.textContent = "“" + card.flavor + "”";
      copy.append(kicker, title, metaRow(card), rules, flavor);

      article.append(button, copy);
      article.addEventListener("contextmenu", (event) => openMenu(event, card, article));
      return article;
    }

    const tiles = CARDS.map(buildTile);
    const shownOrder = new Array(tiles.length).fill(-1);
    const hiddenNow = new Array(tiles.length).fill(false);
    gallery.prepend(...tiles);

    /* ------------------------------------------------------------ filter */

    function matches(index, terms) {
      const card = CARDS[index];
      if (state.type && card.type !== state.type) return false;
      if (state.cost && card.costKey !== state.cost) return false;
      if (state.rarity && card.rarity !== state.rarity) return false;
      if (state.print === "promo" && !card.promo) return false;
      if (state.print === "e1" && card.promo) return false;
      if (state.aff.length && !state.aff.some((name) => card.affinity.includes(name))) return false;
      if (terms.length) {
        const hay = haystacks[index];
        for (const term of terms) if (!hay.includes(term)) return false;
      }
      return true;
    }

    function compare(left, right) {
      const a = CARDS[left];
      const b = CARDS[right];
      if (state.sort === "name") {
        return a.name.localeCompare(b.name, undefined, { numeric: true }) ||
          a.id.localeCompare(b.id, undefined, { numeric: true });
      }
      if (state.sort === "cost") {
        return a.costValue - b.costValue || a.id.localeCompare(b.id, undefined, { numeric: true });
      }
      if (state.sort === "rarity") {
        return (rarityRank.get(a.rarity) ?? 99) - (rarityRank.get(b.rarity) ?? 99) ||
          a.id.localeCompare(b.id, undefined, { numeric: true });
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    }

    function isFiltered() {
      return Boolean(state.q.trim() || state.aff.length || state.type || state.cost ||
        state.rarity || state.print);
    }

    /* Writes only what changed and never reads layout, so a keystroke costs no
       reflow: hidden tiles drop out, the rest are re-ordered by CSS order. */
    function render() {
      const terms = state.q.trim().toLowerCase().split(/\\s+/).filter(Boolean);
      const order = [];
      for (let index = 0; index < CARDS.length; index += 1) {
        if (matches(index, terms)) order.push(index);
      }
      order.sort(compare);
      const visible = new Set(order);
      order.forEach((index, position) => {
        if (shownOrder[index] === position) return;
        shownOrder[index] = position;
        tiles[index].style.order = String(position);
      });
      for (let index = 0; index < tiles.length; index += 1) {
        const hide = !visible.has(index);
        if (hiddenNow[index] === hide) continue;
        hiddenNow[index] = hide;
        tiles[index].hidden = hide;
      }
      counter.textContent = order.length === CARDS.length
        ? CARDS.length + " CARDS"
        : order.length + " OF " + CARDS.length + " CARDS";
      emptyState.hidden = order.length > 0;
      clearButton.hidden = !isFiltered();
    }

    function syncControls() {
      search.value = state.q;
      selects.type.value = state.type;
      selects.cost.value = state.cost;
      selects.rarity.value = state.rarity;
      selects.print.value = state.print;
      selects.sort.value = state.sort;
      for (const chip of chips.children) {
        chip.setAttribute("aria-pressed", String(state.aff.includes(chip.dataset.aff)));
      }
    }

    /* -------------------------------------------------------- shareable URL */

    function params() {
      try {
        return new URLSearchParams(location.search);
      } catch (error) {
        return new URLSearchParams("");
      }
    }

    function readState() {
      const query = params();
      state.q = (query.get("q") || "").slice(0, 120);
      state.aff = (query.get("aff") || "").split(",").filter((name) => values.aff.includes(name));
      for (const key of ["type", "cost", "rarity", "print"]) {
        const value = query.get(key) || "";
        state[key] = values[key].includes(value) ? value : "";
      }
      const sort = query.get("sort") || "";
      state.sort = SORTS.includes(sort) ? sort : "id";
      /* Set numbers print uppercase, but a link is written by hand in somebody
         else's prose and comes back lowercased, or wrapped by a mail client and
         pasted with a stray space. Normalise here so all of those resolve. */
      return (query.get("card") || "").trim().toUpperCase();
    }

    function writeState(card) {
      const query = params();
      const set = (key, value) => {
        if (value) query.set(key, value);
        else query.delete(key);
      };
      set("q", state.q.trim());
      set("aff", state.aff.join(","));
      set("type", state.type);
      set("cost", state.cost);
      set("rarity", state.rarity);
      set("print", state.print);
      set("sort", state.sort === "id" ? "" : state.sort);
      set("card", card === undefined ? query.get("card") || "" : card);
      const text = query.toString();
      try {
        history.replaceState(null, "", text ? "?" + text : location.pathname);
      } catch (error) {
        /* file:// forbids URL rewrites — the filters still work, links do not */
      }
    }

    /* replaceState is rate-limited by browsers, so the URL trails the grid. */
    let urlTimer = 0;
    function queueUrl() {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => writeState(), 220);
    }

    function update() {
      render();
      queueUrl();
    }

    function clearAll() {
      state.q = "";
      state.aff = [];
      state.type = "";
      state.cost = "";
      state.rarity = "";
      state.print = "";
      syncControls();
      update();
    }

    /* ------------------------------------------------------------ dialog */

    /* The dialog gets the same treatment as a tile: artwork when it can be
       had, the text card when it cannot. #modalImage stays in the DOM either
       way — it is hidden, not replaced. */
    function paintModalFace(card) {
      const box = byId("modalArt");
      const image = byId("modalImage");
      const previous = box.querySelector(".text-face");
      if (previous) previous.remove();
      image.alt = card.name + " card";
      /* No point offering a rendered face nobody here can fetch. */
      byId("modalFace").hidden = faceMode === "text";
      if (faceMode === "text") {
        image.hidden = true;
        image.removeAttribute("src");
        box.append(textFace(card));
        return;
      }
      image.hidden = false;
      image.onerror = () => {
        image.hidden = true;
        if (!box.querySelector(".text-face")) box.append(textFace(card));
      };
      if (globalThis.E1Faces) E1Faces.setFace(image, card.faceFile);
      else image.src = faceUrl(card);
    }

    function openCard(card) {
      openCard.current = card;
      paintModalFace(card);
      byId("modalId").textContent = card.id + " · " + card.rarity;
      byId("modalName").textContent = card.name;
      byId("modalMeta").textContent = metaText(card);
      byId("modalRules").textContent = card.rules;
      byId("modalFlavor").textContent = card.flavor;
      byId("modalHelp").textContent = card.help;
      byId("modalNote").textContent = card.note;
      byId("modalSource").href = card.source;
      byId("modalFace").href = faceUrl(card);
      byId("modalCopy").onclick = () => copyLink(card);
      if (!dialog.open) dialog.showModal();
      writeState(card.id);
    }

    /* THE ANCHOR. A set number is the one name for a card that never moves, so
       cards.html?card=E1-042 is what every other page cites. Resolving it in one
       place is what lets the first paint, a back button and a pasted link all
       mean the same thing. */
    function showCard(id) {
      const wanted = String(id || "").trim().toUpperCase();
      if (!wanted) return false;
      const index = CARDS.findIndex((entry) => entry.id.toUpperCase() === wanted);
      /* A citation that misses says so. Silence here reads as a broken page. */
      if (index < 0) {
        say("NO CARD " + wanted);
        return false;
      }
      /* Land the reader ON the tile, so closing the dialog leaves them looking
         at the card rather than at the top of two hundred and ninety-six of
         them. A tile the current filters hide is left alone — a link that
         carries filters asked for them. */
      const tile = tiles[index];
      if (tile && !tile.hidden && tile.scrollIntoView) tile.scrollIntoView({ block: "center" });
      openCard(CARDS[index]);
      return true;
    }

    let flashTimer = 0;
    function say(message) {
      flash.textContent = message;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash.textContent = ""; }, 2200);
    }

    /* The citation, built from where this page actually sits so it is right on
       the live site, on a mirror and on file:// alike — and deliberately WITHOUT
       my filters riding along, because a link to a card is not a link to my
       search. The address bar still carries the whole view for anyone who wants
       to share that instead. */
    function cardLink(card) {
      return location.href.split("#")[0].split("?")[0] + "?card=" + encodeURIComponent(card.id);
    }

    function copyLink(card) {
      writeState(card.id);
      const link = cardLink(card);
      const fallback = () => {
        const field = document.createElement("textarea");
        field.value = link;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (error) {
          ok = false;
        }
        field.remove();
        say(ok ? "LINK COPIED" : "COPY BLOCKED");
      };
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(link).then(() => say("LINK COPIED"), fallback);
    }

    /* ------------------------------------------- right-click card menu */

    function closeMenu() {
      if (menu.hidden) return;
      menu.hidden = true;
      menu.replaceChildren();
    }

    function openMenu(event, card, anchor) {
      event.preventDefault();
      event.stopPropagation();
      menu.replaceChildren();
      const head = document.createElement("strong");
      head.textContent = card.id + " · " + card.name;
      menu.append(head);
      const item = (label, run) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = label;
        button.addEventListener("click", () => {
          closeMenu();
          run();
        });
        menu.append(button);
      };
      item("Copy link to this card", () => copyLink(card));
      for (const name of card.affinity) {
        item("Only " + name, () => {
          state.aff = [name];
          syncControls();
          update();
        });
      }
      item("Only " + card.type, () => {
        state.type = card.type;
        syncControls();
        update();
      });
      item("Only " + card.rarity, () => {
        state.rarity = card.rarity;
        syncControls();
        update();
      });
      if (faceMode !== "text") {
        item("Open rendered card", () => window.open(faceUrl(card), "_blank", "noopener"));
      }
      menu.style.left = "0px";
      menu.style.top = "0px";
      menu.hidden = false;
      /* A keyboard press reports 0,0 — anchor to the button that was pressed
         so the menu opens where the player is looking, not in the corner. */
      let px = event.clientX;
      let py = event.clientY;
      if (anchor && !px && !py) {
        const box = anchor.getBoundingClientRect();
        px = box.left;
        py = box.bottom;
      }
      const x = Math.min(px, window.innerWidth - menu.offsetWidth - 8);
      const y = Math.min(py, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = Math.max(8, x) + "px";
      menu.style.top = Math.max(8, y) + "px";
    }

    /* ------------------------------------------------------------ events */

    search.addEventListener("input", () => {
      state.q = search.value;
      update();
    });
    for (const [key, element] of Object.entries(selects)) {
      element.addEventListener("change", () => {
        state[key] = element.value;
        update();
      });
    }
    chips.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-aff]");
      if (!chip) return;
      const name = chip.dataset.aff;
      state.aff = state.aff.includes(name)
        ? state.aff.filter((entry) => entry !== name)
        : [...state.aff, name];
      syncControls();
      update();
    });
    clearButton.addEventListener("click", clearAll);
    faceToggle.addEventListener("click", () => {
      setFaceMode(faceMode === "text" ? "art" : "text", true);
      say(faceMode === "text" ? "TEXT CARDS" : "CARD ART");
    });
    byId("closeDialog").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => writeState(""));
    document.addEventListener("click", (event) => {
      if (menu.hidden || menu.contains(event.target)) return;
      closeMenu();
    }, true);
    window.addEventListener("scroll", closeMenu, { passive: true });
    window.addEventListener("resize", closeMenu);
    window.addEventListener("popstate", () => {
      const wanted = readState();
      syncControls();
      render();
      /* A restored page has to agree with its own address bar: the card the URL
         names is the card that is open, and no card named means none open. */
      const shown = dialog.open && openCard.current ? openCard.current.id.toUpperCase() : "";
      if (wanted === shown) return;
      if (dialog.open) dialog.close();
      if (wanted) showCard(wanted);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!menu.hidden) {
          closeMenu();
          return;
        }
        if (dialog.open) return;
        if (isFiltered()) clearAll();
        return;
      }
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (dialog.open) return;
      const tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      search.focus();
      search.select();
    });

    const deepLink = readState();
    syncControls();
    render();

    /* The automatic answer first, so nothing waits on storage to draw. Then the
       saved preference, if there is one and if it is still possible: a shell
       that cannot fetch anything is not talked into trying by an old choice. */
    syncFaceToggle();
    if (!facesReachable()) {
      faceToggle.disabled = true;
      faceToggle.title = "Card art cannot be fetched from here, so every card is drawn as text.";
      syncFaceNotice();
      say("NO CARD ART HERE — TEXT CARDS");
    } else if (nap) {
      nap.storage.get(FACE_KEY).then((saved) => {
        if (saved === "text" || saved === "art") setFaceMode(saved, false);
      }).catch(() => {});
    }

    if (deepLink) showCard(deepLink);
  </script>
</body>
</html>
"""


def render_html(records: list[dict[str, Any]]) -> str:
    """Render a dependency-free, searchable, deep-linkable card catalog."""
    facets = gallery_facets(records)
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    facet_data = json.dumps(facets, ensure_ascii=False).replace("</", "<\\/")
    return (
        TEMPLATE.replace("__TYPE_OPTIONS__", _options(facets["types"], "All card types"))
        .replace("__COST_OPTIONS__", _options(facets["costs"], "Any cost"))
        .replace("__RARITY_OPTIONS__", _options(facets["rarities"], "All rarities"))
        .replace("__PRINT_OPTIONS__", _options(facets["printings"], "All printings"))
        .replace("__AFFINITY_CHIPS__", _chips(facets["affinities"]))
        .replace("__TOTAL__", str(len(records)))
        .replace("__FACETS__", facet_data)
        .replace("__CARD_DATA__", data)
    )


def main() -> None:
    """Build site/cards.html from locked card text and rendered card faces."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--face-manifest",
        type=Path,
        default=repo_root / "art" / "cards" / "node-runner-web" / "manifest.json",
    )
    parser.add_argument(
        "--promos",
        type=Path,
        default=repo_root / "cards" / "promos.json",
    )
    parser.add_argument(
        "--promo-manifest",
        type=Path,
        default=repo_root / "art" / "cards" / "promos" / "manifest.json",
    )
    parser.add_argument("--out", type=Path, default=repo_root / "site" / "cards.html")
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    face_manifest = json.loads(args.face_manifest.read_text(encoding="utf-8"))
    promo_payload = json.loads(args.promos.read_text(encoding="utf-8"))
    promo_manifest = json.loads(args.promo_manifest.read_text(encoding="utf-8"))
    if len(cards) != 295:
        raise ValueError("complete text and card-face locks are required")
    if promo_payload["set"]["card_count"] != promo_manifest["card_count"]:
        raise ValueError("complete promo card lock is required")
    e1_records = gallery_records(cards, face_manifest)
    promo_records = promo_gallery_records(promo_payload["cards"], promo_manifest)
    records = e1_records + promo_records
    record_site_decision(args.audit_db, records, args.out)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_html(records), encoding="utf-8")
    complete_site_decision(args.audit_db, args.out)
    print(f"wrote {args.out} with {len(records)} image-and-text cards")


if __name__ == "__main__":
    main()
