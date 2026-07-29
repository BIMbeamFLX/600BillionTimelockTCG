"""Build the standalone image-and-text gallery for all 295 Edition One cards."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

THUMBNAIL_SIZE = (384, 480)


def gallery_records(
    cards: list[dict[str, Any]],
    art_manifest: dict[str, Any],
    face_manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    """Join card text with standalone art and rendered card-face filenames."""
    art_files = {item["id"]: item["file"] for item in art_manifest["files"]}
    face_files = {item["id"]: item["file"] for item in face_manifest["files"]}
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
            "artFile": art_files[card["id"]],
            "thumbFile": f"{card['id']}.webp",
            "faceFile": face_files[card["id"]],
            "rules": card["rules_text"],
            "flavor": card["flavor_text"],
            "help": card["help_text"],
            "note": card["protocol_note"],
            "source": card["protocol_source"],
            "searchTags": (
                "fips.network submarine node balloons" if card["id"] == "E1-202" else ""
            ),
        }
        for card in cards
    ]


def record_site_decision(
    db_path: Path,
    records: list[dict[str, Any]],
    output_path: Path,
    thumbnail_dir: Path,
) -> None:
    """Record the gallery build before writing HTML or thumbnails."""
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS site_thumbnail_builds (
                artifact TEXT PRIMARY KEY,
                output_directory TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                output_size TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO site_thumbnail_builds (
                artifact, output_directory, record_count, output_size,
                status, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(output_path),
                str(thumbnail_dir),
                len(records),
                json.dumps(THUMBNAIL_SIZE),
                "planned",
                "auto:codex:e1-image-text-gallery",
            ),
        )
        connection.commit()


def complete_site_decision(db_path: Path, output_path: Path) -> None:
    """Mark the HTML and thumbnail artifacts generated after successful writes."""
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE site_builds SET status='generated' WHERE artifact=?",
            (str(output_path),),
        )
        connection.execute(
            "UPDATE site_thumbnail_builds SET status='generated' WHERE artifact=?",
            (str(output_path),),
        )
        connection.commit()


def build_thumbnails(
    records: list[dict[str, Any]],
    art_dir: Path,
    output_dir: Path,
) -> None:
    """Create lightweight WebP previews while preserving full-resolution art."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for record in records:
        source = art_dir / record["artFile"]
        output = output_dir / record["thumbFile"]
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image = ImageOps.fit(image, THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            image.save(output, "WEBP", quality=84, method=6)


def render_html(records: list[dict[str, Any]]) -> str:
    """Render a dependency-free, filterable image-and-text card catalog."""
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09080b">
  <meta name="description"
    content="Alle 295 Karten des 600B Timelock TCG mit Artwork und Kartentext.">
  <title>600B Timelock TCG — Alle Karten</title>
  <style>
    @font-face {{
      font-family: Anton600;
      src: url("art/fonts/Anton-Regular.ttf") format("truetype");
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
      font: 24px/1 Anton600, Impact, sans-serif;
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
      padding: 7px 10px;
      color: var(--muted);
      background: transparent;
      border: 1px solid var(--line);
      cursor: pointer;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
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
      aspect-ratio: 4 / 5;
      object-fit: cover;
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
      object-fit: cover;
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
    <img src="art/brand/600B-logo-primary.png" alt="600 000 000 000">
    <div class="brand">
      <strong>TIMELOCK TCG</strong>
      <span>Edition One · Bild + Text</span>
    </div>
    <a class="nav-link" href="index.html">Regelbuch</a>
  </header>
  <main>
    <section class="hero">
      <div class="eyebrow">600 Billion · 295 Karten · vollständiger Katalog</div>
      <h1>Alle Karten. <span>Bild + Text.</span></h1>
      <p class="intro">Durchsuche Edition One nach Name, ID, Kartentyp, Affinität oder
      Regeltext. Jede Karte zeigt das finale Artwork, ihren Spieltext und Flavor direkt
      in der Übersicht. Ein Klick öffnet Guide, Protocol Note und den Kartenrender.</p>
      <span class="counter" id="counter">295 / 295</span>
    </section>
    <section class="controls" aria-label="Kartenfilter">
      <input class="search" id="search" type="search"
        placeholder="Name, ID, Regeltext oder Affinität suchen …" autocomplete="off">
      <select id="typeFilter" aria-label="Nach Kartentyp filtern">
        <option value="">Alle Kartentypen</option>
      </select>
      <select id="sortOrder" aria-label="Sortierung">
        <option value="id">Sortierung: Setnummer</option>
        <option value="name">Sortierung: Name</option>
        <option value="type">Sortierung: Kartentyp</option>
      </select>
      <div class="chips" id="chips" aria-label="Nach Affinität filtern"></div>
    </section>
    <section class="gallery" id="gallery" aria-live="polite"></section>
  </main>
  <dialog id="cardDialog">
    <div class="modal-grid">
      <img id="modalImage" alt="">
      <div class="details">
        <button class="close" id="closeDialog" aria-label="Details schließen">×</button>
        <div class="modal-id" id="modalId"></div>
        <h2 id="modalName"></h2>
        <div class="meta" id="modalMeta"></div>
        <div class="detail-block">
          <strong>Regeltext</strong>
          <p class="modal-rules" id="modalRules"></p>
        </div>
        <div class="detail-block">
          <strong>Flavor</strong>
          <p id="modalFlavor"></p>
        </div>
        <div class="detail-block">
          <strong>Simple Guide · kein Regeleffekt</strong>
          <p id="modalHelp"></p>
        </div>
        <div class="detail-block">
          <strong>Protocol Note · kein Regeleffekt</strong>
          <p id="modalNote"></p>
          <p><a id="modalSource" target="_blank" rel="noreferrer">
            Primärquelle öffnen →</a></p>
        </div>
        <a class="face-link" id="modalFace" target="_blank">Gerenderte Karte öffnen</a>
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
      All: "Alle",
      Power: "Power",
      Bitcoin: "Bitcoin",
      Keys: "Keys",
      Signal: "Signal",
      Timelock: "Timelock",
      Neutral: "Neutral",
    }};
    for (const item of affinities) {{
      const button = document.createElement("button");
      button.className = "chip" + (item === "All" ? " active" : "");
      button.textContent = labels[item];
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

    function artUrl(file) {{
      return "art/generated/prompts-v2-final-1920x2400/" + encodeURIComponent(file);
    }}

    function thumbUrl(file) {{
      return "art/generated/gallery-thumbs/" + encodeURIComponent(file);
    }}

    function faceUrl(file) {{
      return "art/cards/final/" + encodeURIComponent(file);
    }}

    function metaText(card) {{
      return card.typeLine + " · " + card.affinity.join(" / ") + " · Cost " + card.cost +
        (card.stats ? " · " + card.stats : "");
    }}

    function openCard(card) {{
      document.getElementById("modalImage").src = artUrl(card.artFile);
      document.getElementById("modalImage").alt = card.name + " Artwork";
      document.getElementById("modalId").textContent = card.id + " · " + card.rarity;
      document.getElementById("modalName").textContent = card.name;
      document.getElementById("modalMeta").textContent = metaText(card);
      document.getElementById("modalRules").textContent = card.rules;
      document.getElementById("modalFlavor").textContent = card.flavor;
      document.getElementById("modalHelp").textContent = card.help;
      document.getElementById("modalNote").textContent = card.note;
      document.getElementById("modalSource").href = card.source;
      document.getElementById("modalFace").href = faceUrl(card.faceFile);
      dialog.showModal();
    }}

    function cardElement(card) {{
      const article = document.createElement("article");
      article.className = "catalog-card";

      const button = document.createElement("button");
      button.className = "art-button";
      button.type = "button";
      button.setAttribute("aria-label", "Details zu " + card.name + " öffnen");
      const image = document.createElement("img");
      image.src = thumbUrl(card.thumbFile);
      image.alt = card.name;
      image.loading = "lazy";
      image.decoding = "async";
      button.append(image);
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
        empty.textContent = "Keine Karte passt zu diesen Filtern.";
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
    """Build cards.html and its thumbnail set from locked card and art data."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--art-manifest",
        type=Path,
        default=(repo_root / "art" / "generated" / "prompts-v2-final-1920x2400" / "manifest.json"),
    )
    parser.add_argument(
        "--face-manifest",
        type=Path,
        default=repo_root / "art" / "cards" / "final" / "manifest.json",
    )
    parser.add_argument(
        "--art-dir",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-final-1920x2400",
    )
    parser.add_argument(
        "--thumbs",
        type=Path,
        default=repo_root / "art" / "generated" / "gallery-thumbs",
    )
    parser.add_argument("--out", type=Path, default=repo_root / "cards.html")
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    art_manifest = json.loads(args.art_manifest.read_text(encoding="utf-8"))
    face_manifest = json.loads(args.face_manifest.read_text(encoding="utf-8"))
    if len(cards) != 295 or art_manifest["card_count"] != 295 or face_manifest["card_count"] != 295:
        raise ValueError("complete text, art, and card-face locks are required")
    records = gallery_records(cards, art_manifest, face_manifest)
    record_site_decision(args.audit_db, records, args.out, args.thumbs)
    build_thumbnails(records, args.art_dir, args.thumbs)
    args.out.write_text(render_html(records), encoding="utf-8")
    complete_site_decision(args.audit_db, args.out)
    print(f"wrote {args.out} with {len(records)} image-and-text cards")


if __name__ == "__main__":
    main()
