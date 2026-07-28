"""Build the standalone website gallery for all 295 final card faces."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


def gallery_records(
    cards: list[dict[str, Any]],
    manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    """Join public card data with final image filenames."""
    files = {item["id"]: item["file"] for item in manifest["files"]}
    return [
        {
            "id": card["id"],
            "name": card["name"],
            "type": card["card_type"],
            "typeLine": card["type_line"],
            "affinity": card["affinity"] or ["Neutral"],
            "cost": card["cost"] or "—",
            "stats": card["action_resilience"],
            "file": files[card["id"]],
            "help": card["help_text"],
            "note": card["protocol_note"],
            "source": card["protocol_source"],
        }
        for card in cards
    ]


def record_site_decision(db_path: Path, records: list[dict[str, Any]]) -> None:
    """Record the gallery build before writing the website artifact."""
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
                "cards.html",
                hashlib.sha256(payload).hexdigest(),
                len(records),
                "planned",
                "auto:codex:e1-gallery",
            ),
        )
        connection.commit()


def render_html(records: list[dict[str, Any]]) -> str:
    """Render a dependency-free filterable card gallery."""
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111111">
  <meta name="description" content="Browse all 295 cards in 600B Timelock TCG Edition One.">
  <title>600B Timelock TCG — Edition One Cards</title>
  <style>
    @font-face {{
      font-family: Anton600;
      src: url("art/fonts/Anton-Regular.ttf") format("truetype");
      font-display: swap;
    }}
    :root {{
      --orange: #ff6a00;
      --purple: #b991e4;
      --purple-deep: #7447b8;
      --black: #09080b;
      --soot: #111014;
      --panel: #19151f;
      --cream: #fff7ec;
      --muted: #c7bbcc;
      --line: rgba(185,145,228,.27);
    }}
    * {{ box-sizing: border-box; }}
    html {{ color-scheme: dark; background: var(--black); }}
    body {{
      margin: 0;
      color: var(--cream);
      background:
        radial-gradient(circle at 18% 0, rgba(255,106,0,.15), transparent 28rem),
        radial-gradient(circle at 90% 8%, rgba(116,71,184,.22), transparent 32rem),
        var(--black);
      font: 16px/1.5 Arial, sans-serif;
    }}
    a {{ color: var(--orange); }}
    button, input, select {{ font: inherit; }}
    .masthead {{
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 14px clamp(18px, 4vw, 58px);
      background: rgba(9,8,11,.88);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(18px);
    }}
    .masthead img {{ width: 52px; height: 52px; }}
    .brand {{ margin-right: auto; }}
    .brand strong {{
      display: block;
      font: 25px/1 Anton600, Impact, sans-serif;
      letter-spacing: .025em;
    }}
    .brand span {{
      color: var(--purple);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .18em;
      text-transform: uppercase;
    }}
    .masthead a {{
      padding: 8px 11px;
      color: var(--cream);
      border: 1px solid var(--purple-deep);
      text-decoration: none;
      text-transform: uppercase;
      font: 13px/1 Anton600, Impact, sans-serif;
      letter-spacing: .06em;
    }}
    .hero {{
      max-width: 1480px;
      margin: 0 auto;
      padding: clamp(58px, 9vw, 116px) clamp(18px, 4vw, 58px) 36px;
    }}
    .eyebrow {{
      color: var(--purple);
      font-weight: 900;
      letter-spacing: .2em;
      text-transform: uppercase;
    }}
    h1 {{
      max-width: 930px;
      margin: 10px 0 18px;
      font: clamp(58px, 9vw, 126px)/.88 Anton600, Impact, sans-serif;
      letter-spacing: -.025em;
      text-transform: uppercase;
    }}
    h1 span {{ color: var(--orange); }}
    .intro {{ max-width: 730px; color: var(--muted); font-size: 19px; }}
    .counter {{
      display: inline-block;
      margin-top: 18px;
      padding: 7px 10px;
      color: var(--black);
      background: var(--orange);
      font-weight: 900;
    }}
    .controls {{
      position: sticky;
      top: 81px;
      z-index: 9;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 13px;
      max-width: 1480px;
      margin: 0 auto 28px;
      padding: 14px clamp(18px, 4vw, 58px);
      background: linear-gradient(180deg, rgba(9,8,11,.97), rgba(9,8,11,.89));
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
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
      gap: clamp(14px, 2vw, 28px);
      max-width: 1480px;
      margin: 0 auto;
      padding: 0 clamp(18px, 4vw, 58px) 110px;
    }}
    .card-button {{
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      overflow: hidden;
      color: inherit;
      background: #000;
      border: 1px solid var(--line);
      border-radius: 14px;
      cursor: pointer;
      box-shadow: 0 16px 44px rgba(0,0,0,.36);
      transition: transform .16s ease, border-color .16s ease;
    }}
    .card-button:hover, .card-button:focus-visible {{
      z-index: 2;
      border-color: var(--orange);
      transform: translateY(-5px);
      outline: none;
    }}
    .card-button img {{
      display: block;
      width: 100%;
      aspect-ratio: 5 / 7;
      object-fit: cover;
    }}
    .empty {{
      grid-column: 1 / -1;
      padding: 70px 20px;
      color: var(--muted);
      border: 1px dashed var(--line);
      text-align: center;
    }}
    dialog {{
      width: min(1020px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      padding: 0;
      overflow: auto;
      color: var(--cream);
      background: var(--soot);
      border: 1px solid var(--purple-deep);
      border-top: 7px solid var(--orange);
      box-shadow: 0 30px 120px #000;
    }}
    dialog::backdrop {{ background: rgba(0,0,0,.82); backdrop-filter: blur(8px); }}
    .modal-grid {{ display: grid; grid-template-columns: minmax(270px, 460px) 1fr; }}
    .modal-grid > img {{ width: 100%; min-height: 100%; object-fit: cover; }}
    .details {{ position: relative; padding: clamp(24px, 5vw, 52px); }}
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
      font: clamp(34px, 5vw, 62px)/.97 Anton600, Impact, sans-serif;
    }}
    .meta {{ color: var(--purple); font-weight: 800; }}
    .detail-block {{ margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--line); }}
    .detail-block strong {{
      display: block;
      margin-bottom: 8px;
      color: var(--orange);
      font: 18px/1 Anton600, Impact, sans-serif;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
    .detail-block p {{ margin: 0; color: var(--muted); }}
    @media (max-width: 720px) {{
      .masthead {{ position: static; }}
      .masthead .brand span {{ display: none; }}
      .controls {{ top: 0; grid-template-columns: 1fr; }}
      .controls select {{ width: 100%; }}
      .modal-grid {{ grid-template-columns: 1fr; }}
      .modal-grid > img {{ max-height: 72vh; object-fit: contain; background: #000; }}
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
      <span>Edition One · Complete card set</span>
    </div>
    <a href="index.html">Rulebook</a>
  </header>
  <main>
    <section class="hero">
      <div class="eyebrow">600 Billion · Text → Art → Card</div>
      <h1>All 295 <span>Cards.</span></h1>
      <p class="intro">A positive cypherpunk set about Bitcoin, Nostr and open systems.
      Use the filters to explore the five affinities. Open a card for its beginner guide
      and sourced Protocol Note.</p>
      <span class="counter" id="counter">295 / 295</span>
    </section>
    <section class="controls" aria-label="Card filters">
      <input class="search" id="search" type="search"
        placeholder="Search name, type, affinity or ID…" autocomplete="off">
      <select id="typeFilter" aria-label="Filter by card type">
        <option value="">All card types</option>
      </select>
      <div class="chips" id="chips" aria-label="Filter by affinity"></div>
    </section>
    <section class="gallery" id="gallery" aria-live="polite"></section>
  </main>
  <dialog id="cardDialog">
    <div class="modal-grid">
      <img id="modalImage" alt="">
      <div class="details">
        <button class="close" id="closeDialog" aria-label="Close card details">×</button>
        <div class="modal-id" id="modalId"></div>
        <h2 id="modalName"></h2>
        <div class="meta" id="modalMeta"></div>
        <div class="detail-block">
          <strong>Simple Guide · no rules effect</strong>
          <p id="modalHelp"></p>
        </div>
        <div class="detail-block">
          <strong>Protocol Note · no rules effect</strong>
          <p id="modalNote"></p>
          <p><a id="modalSource" target="_blank" rel="noreferrer">Open primary source ↗</a></p>
        </div>
      </div>
    </div>
  </dialog>
  <script>
    const cards = {data};
    const gallery = document.getElementById("gallery");
    const search = document.getElementById("search");
    const typeFilter = document.getElementById("typeFilter");
    const chips = document.getElementById("chips");
    const counter = document.getElementById("counter");
    const dialog = document.getElementById("cardDialog");
    let affinity = "All";

    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock", "Neutral"];
    for (const item of affinities) {{
      const button = document.createElement("button");
      button.className = "chip" + (item === "All" ? " active" : "");
      button.textContent = item;
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

    function imageUrl(file) {{
      return "art/cards/final/" + encodeURIComponent(file);
    }}

    function openCard(card) {{
      document.getElementById("modalImage").src = imageUrl(card.file);
      document.getElementById("modalImage").alt = card.name + " card face";
      document.getElementById("modalId").textContent = card.id;
      document.getElementById("modalName").textContent = card.name;
      document.getElementById("modalMeta").textContent =
        card.typeLine + " · " + card.affinity.join(" / ") + " · Cost " + card.cost +
        (card.stats ? " · " + card.stats : "");
      document.getElementById("modalHelp").textContent = card.help;
      document.getElementById("modalNote").textContent = card.note;
      document.getElementById("modalSource").href = card.source;
      dialog.showModal();
    }}

    function render() {{
      const query = search.value.trim().toLowerCase();
      const type = typeFilter.value;
      const filtered = cards.filter((card) => {{
        const searchable =
          [card.id, card.name, card.typeLine, ...card.affinity].join(" ").toLowerCase();
        const affinityMatch = affinity === "All" ||
          (affinity === "Neutral"
            ? card.affinity.includes("Neutral")
            : card.affinity.includes(affinity));
        return (
          (!query || searchable.includes(query)) &&
          (!type || card.type === type) &&
          affinityMatch
        );
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
      for (const card of filtered) {{
        const button = document.createElement("button");
        button.className = "card-button";
        button.type = "button";
        button.setAttribute("aria-label", "Open " + card.name);
        const image = document.createElement("img");
        image.src = imageUrl(card.file);
        image.alt = card.name;
        image.loading = "lazy";
        image.decoding = "async";
        button.append(image);
        button.addEventListener("click", () => openCard(card));
        fragment.append(button);
      }}
      gallery.append(fragment);
    }}

    search.addEventListener("input", render);
    typeFilter.addEventListener("change", render);
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
    """Build cards.html from locked card data and card-face manifest."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root / "art" / "cards" / "final" / "manifest.json",
    )
    parser.add_argument("--out", type=Path, default=repo_root / "cards.html")
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if len(cards) != 295 or manifest["card_count"] != 295:
        raise ValueError("complete text and card locks are required for the gallery")
    records = gallery_records(cards, manifest)
    record_site_decision(args.audit_db, records)
    args.out.write_text(render_html(records), encoding="utf-8")
    print(f"wrote {args.out} with {len(records)} cards")


if __name__ == "__main__":
    main()
