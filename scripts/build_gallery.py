"""Build the standalone image-and-text gallery for all 295 Edition One cards."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


def gallery_records(
    cards: list[dict[str, Any]],
    face_manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    """Join card text with its Node Runner face.

    Faces are keyed by card name rather than by the manifest's filenames: the
    manifest is still required as proof the art lock is complete, but the
    rendered set is one flat directory of `<name>.webp`.
    """
    if len(face_manifest["files"]) != len(cards):
        raise ValueError("card text and the face lock disagree on card count")
    return [
        {
            "id": card["id"],
            "name": card["name"],
            "type": card["card_type"],
            "typeLine": card["type_line"],
            "affinity": card["affinity"] or ["Neutral"],
            "cost": card["cost"] or "—",
            "stats": card["action_resilience"],
            "rarity": card["rarity"],
            "faceFile": f"{card['name']}.webp",
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
            "cost": card["cost"] or "—",
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


def render_html(records: list[dict[str, Any]]) -> str:
    """Render a dependency-free, filterable image-and-text card catalog."""
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09080b">
  <meta name="description"
    content="Every 600B Timelock TCG Edition One and promo card, with artwork and text.">
  <title>600B Timelock TCG — All Cards</title>
  <style>
    @font-face {{
      font-family: Anton600;
      src: url("../art/fonts/Anton-Regular.ttf") format("truetype");
      font-display: swap;
    }}
    :root {{
      --orange: #f7931a;
      --ember: #ff6a00;
      --purple: #b991e4;
      --purple-deep: #7447b8;
      --black: #09080b;
      --soot: #111014;
      --panel: #19151f;
      --cream: #fff7ec;
      --muted: #c7bbcc;
      --line: rgba(185, 145, 228, .28);
    }}
    * {{ box-sizing: border-box; }}
    html {{ color-scheme: dark; background: var(--black); }}
    body {{
      margin: 0;
      color: var(--cream);
      background:
        radial-gradient(circle at 16% 0, rgba(247, 147, 26, .16), transparent 30rem),
        radial-gradient(circle at 88% 8%, rgba(116, 71, 184, .2), transparent 34rem),
        var(--black);
      font: 16px/1.5 Arial, sans-serif;
    }}
    a {{ color: var(--orange); }}
    button, input, select {{ font: inherit; }}
    .masthead {{
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 76px;
      padding: 12px clamp(18px, 4vw, 58px);
      background: rgba(9, 8, 11, .9);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(18px);
    }}
    .masthead img {{ width: 50px; height: 50px; }}
    .brand {{ margin-right: auto; }}
    .brand strong {{
      display: block;
      font: 17px/1 Anton600, Impact, sans-serif;
      letter-spacing: .03em;
    }}
    .brand span {{
      color: var(--purple);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .17em;
      text-transform: uppercase;
    }}
    .nav-link {{
      padding: 9px 12px;
      color: var(--cream);
      border: 1px solid var(--purple-deep);
      text-decoration: none;
      text-transform: uppercase;
      font: 13px/1 Anton600, Impact, sans-serif;
      letter-spacing: .06em;
    }}
    .hero {{
      max-width: 1560px;
      margin: 0 auto;
      padding: clamp(56px, 8vw, 108px) clamp(18px, 4vw, 58px) 34px;
    }}
    .eyebrow {{
      color: var(--purple);
      font-weight: 900;
      letter-spacing: .2em;
      text-transform: uppercase;
    }}
    h1 {{
      max-width: 1050px;
      margin: 10px 0 20px;
      font: clamp(56px, 8vw, 118px)/.9 Anton600, Impact, sans-serif;
      letter-spacing: -.025em;
      text-transform: uppercase;
    }}
    h1 span {{ color: var(--orange); }}
    .intro {{ max-width: 780px; color: var(--muted); font-size: 19px; }}
    .counter {{
      display: inline-block;
      margin-top: 18px;
      padding: 7px 11px;
      color: var(--black);
      background: var(--orange);
      font-weight: 900;
    }}
    .controls {{
      position: sticky;
      top: 76px;
      z-index: 18;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(150px, 220px));
      gap: 12px;
      max-width: 1560px;
      margin: 0 auto 28px;
      padding: 14px clamp(18px, 4vw, 58px);
      background: linear-gradient(180deg, rgba(9, 8, 11, .98), rgba(9, 8, 11, .9));
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(16px);
    }}
    .search, select {{
      min-height: 44px;
      padding: 10px 13px;
      color: var(--cream);
      background: var(--panel);
      border: 1px solid var(--line);
      outline: none;
    }}
    .search:focus, select:focus {{ border-color: var(--orange); }}
    .chips {{
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }}
    .chip {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      color: var(--muted);
      background: transparent;
      border: 1px solid var(--line);
      cursor: pointer;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
    /* The icon keeps its own dark disc so the white Keys plate never sits on
       the light active/hover chip surface. Each disc carries a dark tint of
       its own affinity hue, so resources differ by field colour too. */
    .chip .aff {{
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--aff, var(--black)) 22%, var(--black));
    }}
    .chip .aff img {{ width: 14px; height: 14px; }}
    .chip:hover, .chip.active {{
      color: var(--black);
      background: var(--purple);
      border-color: var(--purple);
    }}
    .gallery {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
      gap: clamp(16px, 2vw, 28px);
      max-width: 1560px;
      margin: 0 auto;
      padding: 0 clamp(18px, 4vw, 58px) 110px;
    }}
    .catalog-card {{
      display: flex;
      min-width: 0;
      overflow: hidden;
      flex-direction: column;
      background: linear-gradient(160deg, rgba(25, 21, 31, .98), rgba(13, 12, 16, .98));
      border: 1px solid var(--line);
      border-radius: 15px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, .34);
      transition: transform .16s ease, border-color .16s ease;
    }}
    .catalog-card:hover {{
      border-color: rgba(247, 147, 26, .75);
      transform: translateY(-4px);
    }}
    .art-button {{
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      overflow: hidden;
      color: inherit;
      background: #000;
      border: 0;
      border-bottom: 1px solid var(--line);
      cursor: zoom-in;
    }}
    .art-button::after {{
      position: absolute;
      right: 10px;
      bottom: 10px;
      content: "DETAILS";
      padding: 5px 7px;
      color: var(--black);
      background: var(--orange);
      font: 11px/1 Anton600, Impact, sans-serif;
      letter-spacing: .08em;
    }}
    .art-button:focus-visible {{ outline: 3px solid var(--orange); outline-offset: -3px; }}
    .art-button img {{
      display: block;
      width: 100%;
      aspect-ratio: 5 / 7;
      object-fit: contain;
    }}
    .card-copy {{
      display: flex;
      flex: 1;
      flex-direction: column;
      padding: 18px 18px 20px;
    }}
    .card-kicker {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--purple);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .11em;
      text-transform: uppercase;
    }}
    .card-copy h2 {{
      margin: 8px 0 5px;
      font: 29px/1.02 Anton600, Impact, sans-serif;
      letter-spacing: .005em;
    }}
    .meta {{ color: var(--muted); font-size: 13px; }}
    .rules {{
      margin: 17px 0 0;
      padding: 14px 0 0;
      color: var(--cream);
      border-top: 1px solid var(--line);
      font-weight: 700;
    }}
    .flavor {{
      margin: auto 0 0;
      padding-top: 16px;
      color: var(--purple);
      font: italic 15px/1.45 Georgia, serif;
    }}
    .empty {{
      grid-column: 1 / -1;
      padding: 70px 20px;
      color: var(--muted);
      border: 1px dashed var(--line);
      text-align: center;
    }}
    dialog {{
      width: min(1180px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      padding: 0;
      overflow: auto;
      color: var(--cream);
      background: var(--soot);
      border: 1px solid var(--purple-deep);
      border-top: 7px solid var(--orange);
      box-shadow: 0 30px 120px #000;
    }}
    dialog::backdrop {{ background: rgba(0, 0, 0, .84); backdrop-filter: blur(8px); }}
    .modal-grid {{ display: grid; grid-template-columns: minmax(320px, 540px) 1fr; }}
    .modal-grid > img {{
      width: 100%;
      min-height: 100%;
      object-fit: contain;
      background: #000;
    }}
    .details {{ position: relative; padding: clamp(26px, 5vw, 54px); }}
    .close {{
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
    }}
    .modal-id {{ color: var(--orange); font-weight: 900; letter-spacing: .12em; }}
    .details h2 {{
      margin: 8px 44px 5px 0;
      font: clamp(36px, 5vw, 64px)/.96 Anton600, Impact, sans-serif;
    }}
    .detail-block {{ margin-top: 27px; padding-top: 20px; border-top: 1px solid var(--line); }}
    .detail-block strong {{
      display: block;
      margin-bottom: 8px;
      color: var(--orange);
      font: 18px/1 Anton600, Impact, sans-serif;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
    .detail-block p {{ margin: 0; color: var(--muted); }}
    .detail-block .modal-rules {{ color: var(--cream); font-weight: 700; }}
    .face-link {{
      display: inline-block;
      margin-top: 24px;
      padding: 10px 12px;
      color: var(--black);
      background: var(--purple);
      text-decoration: none;
      font: 14px/1 Anton600, Impact, sans-serif;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
    @media (max-width: 760px) {{
      .masthead {{ position: static; }}
      .masthead .brand span {{ display: none; }}
      .controls {{ top: 0; grid-template-columns: 1fr; }}
      .controls select {{ width: 100%; }}
      .modal-grid {{ grid-template-columns: 1fr; }}
      .modal-grid > img {{ max-height: 72vh; object-fit: contain; }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      * {{ scroll-behavior: auto !important; transition: none !important; }}
    }}
  </style>
</head>
<body>
  <header class="masthead">
    <img src="../art/brand/600B-logo-primary.png" alt="600 000 000 000">
    <div class="brand">
      <strong>TIMELOCK TCG</strong>
      <span>Edition One · Artwork + Text</span>
    </div>
    <a class="nav-link" href="leaderboard.html">Leaderboard</a>
    <a class="nav-link" href="rules.html">Rulebook</a>
  </header>
  <main>
    <section class="hero">
      <div class="eyebrow">600 Billion · 295 E1 + 1 Promo · Complete Catalog</div>
      <h1>All Cards. <span>Artwork + Text.</span></h1>
      <p class="intro">Search Edition One by name, ID, card type, affinity or rules text.
      Every entry shows its final artwork, gameplay text and flavor in the catalog.
      Open a card for its guide, protocol note and rendered card face.</p>
      <span class="counter" id="counter">{len(records)} / {len(records)}</span>
    </section>
    <section class="controls" aria-label="Card filters">
      <input class="search" id="search" type="search"
        placeholder="Search name, ID, rules text or affinity …" autocomplete="off">
      <select id="typeFilter" aria-label="Filter by card type">
        <option value="">All card types</option>
      </select>
      <select id="sortOrder" aria-label="Sort order">
        <option value="id">Sort: set number</option>
        <option value="name">Sort: name</option>
        <option value="type">Sort: card type</option>
      </select>
      <div class="chips" id="chips" aria-label="Filter by affinity"></div>
    </section>
    <section class="gallery" id="gallery" aria-live="polite"></section>
  </main>
  <dialog id="cardDialog">
    <div class="modal-grid">
      <img id="modalImage" alt="">
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
        <a class="face-link" id="modalFace" target="_blank">Open rendered card</a>
      </div>
    </div>
  </dialog>
  <script>
    const cards = {data};
    const gallery = document.getElementById("gallery");
    const search = document.getElementById("search");
    const typeFilter = document.getElementById("typeFilter");
    const sortOrder = document.getElementById("sortOrder");
    const chips = document.getElementById("chips");
    const counter = document.getElementById("counter");
    const dialog = document.getElementById("cardDialog");
    let affinity = "All";

    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock", "Neutral"];
    const labels = {{
      All: "All",
      Power: "Power",
      Bitcoin: "Bitcoin",
      Keys: "Keys",
      Signal: "Signal",
      Timelock: "Timelock",
      Neutral: "Neutral",
    }};
    const affinityIcons = {{
      Power: "power",
      Bitcoin: "bitcoin",
      Keys: "keys",
      Signal: "signal",
      Timelock: "timelock",
    }};
    /* Locked E1 "Plate" accents, remapped by resource. */
    const affinityAccents = {{
      Power: "#F3C244",
      Bitcoin: "#F7931A",
      Keys: "#FFF7EC",
      Signal: "#7447B8",
      Timelock: "#17BEBB",
    }};
    for (const item of affinities) {{
      const button = document.createElement("button");
      button.className = "chip" + (item === "All" ? " active" : "");
      if (affinityIcons[item]) {{
        const disc = document.createElement("span");
        disc.className = "aff";
        disc.style.setProperty("--aff", affinityAccents[item]);
        const icon = document.createElement("img");
        icon.src = "../art/resources/" + affinityIcons[item] + ".svg";
        icon.alt = "";
        disc.append(icon);
        button.append(disc);
      }}
      button.append(labels[item]);
      button.addEventListener("click", () => {{
        affinity = item;
        [...chips.children].forEach((chip) => chip.classList.toggle("active", chip === button));
        render();
      }});
      chips.append(button);
    }}

    [...new Set(cards.map((card) => card.type))].sort().forEach((type) => {{
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      typeFilter.append(option);
    }});

    function faceUrl(card) {{
      return "../art/cards/node-runner-web/" + encodeURIComponent(card.faceFile);
    }}

    function metaText(card) {{
      return card.typeLine + " · " + card.affinity.join(" / ") + " · Cost " + card.cost +
        (card.stats ? " · " + card.stats : "");
    }}

    function openCard(card) {{
      document.getElementById("modalImage").src = faceUrl(card);
      document.getElementById("modalImage").alt = card.name + " card";
      document.getElementById("modalId").textContent = card.id + " · " + card.rarity;
      document.getElementById("modalName").textContent = card.name;
      document.getElementById("modalMeta").textContent = metaText(card);
      document.getElementById("modalRules").textContent = card.rules;
      document.getElementById("modalFlavor").textContent = card.flavor;
      document.getElementById("modalHelp").textContent = card.help;
      document.getElementById("modalNote").textContent = card.note;
      document.getElementById("modalSource").href = card.source;
      document.getElementById("modalFace").href = faceUrl(card);
      dialog.showModal();
    }}

    function cardElement(card) {{
      const article = document.createElement("article");
      article.className = "catalog-card";

      const button = document.createElement("button");
      button.className = "art-button";
      button.type = "button";
      button.setAttribute("aria-label", "Open details for " + card.name);
      const face = document.createElement("img");
      face.src = faceUrl(card);
      face.alt = card.name + " card";
      face.loading = "lazy";
      face.decoding = "async";
      button.append(face);
      button.addEventListener("click", () => openCard(card));

      const copy = document.createElement("div");
      copy.className = "card-copy";
      const kicker = document.createElement("div");
      kicker.className = "card-kicker";
      const id = document.createElement("span");
      id.textContent = card.id;
      const rarity = document.createElement("span");
      rarity.textContent = card.rarity;
      kicker.append(id, rarity);
      const title = document.createElement("h2");
      title.textContent = card.name;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = metaText(card);
      const rules = document.createElement("p");
      rules.className = "rules";
      rules.textContent = card.rules;
      const flavor = document.createElement("p");
      flavor.className = "flavor";
      flavor.textContent = "“" + card.flavor + "”";
      copy.append(kicker, title, meta, rules, flavor);
      article.append(button, copy);
      return article;
    }}

    function render() {{
      const query = search.value.trim().toLowerCase();
      const type = typeFilter.value;
      const filtered = cards.filter((card) => {{
        const searchable = [
          card.id,
          card.name,
          card.typeLine,
          card.rules,
          card.flavor,
          card.searchTags,
          ...card.affinity,
        ].join(" ").toLowerCase();
        const affinityMatch = affinity === "All" || card.affinity.includes(affinity);
        return (
          (!query || searchable.includes(query)) &&
          (!type || card.type === type) &&
          affinityMatch
        );
      }});
      filtered.sort((left, right) => {{
        const key = sortOrder.value;
        return left[key].localeCompare(right[key], undefined, {{ numeric: true }});
      }});
      counter.textContent = filtered.length + " / " + cards.length;
      gallery.replaceChildren();
      if (!filtered.length) {{
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No cards match these filters.";
        gallery.append(empty);
        return;
      }}
      const fragment = document.createDocumentFragment();
      for (const card of filtered) fragment.append(cardElement(card));
      gallery.append(fragment);
    }}

    search.addEventListener("input", render);
    typeFilter.addEventListener("change", render);
    sortOrder.addEventListener("change", render);
    document.getElementById("closeDialog").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {{
      if (event.target === dialog) dialog.close();
    }});
    render();
  </script>
</body>
</html>
"""


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
        default=repo_root / "art" / "cards" / "final" / "manifest.json",
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
    if len(cards) != 295 or face_manifest["card_count"] != 295:
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
