const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MD = path.join(ROOT, "rules", "600B-Timelock-TCG-Rulebook-E1.md");
const OUTPUT_HTML = path.join(ROOT, "site", "rules.html");

/* The second palette that used to live here is gone: the page links 600b.css
   and now inherits its tokens, so nothing reads these any more. Left as a note
   rather than a table, because a spare copy of the brand colours in a generator
   is exactly how the two drifted apart in the first place. */

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderWebsite() {
  /* LF before any pattern runs: a Windows checkout hands this file over with CRLF,
     and the title strip below failed on a CRLF blank line, which put a spare
     "Edition One Rules" entry in the contents list of a Windows build. */
  let markdown = fs.readFileSync(SOURCE_MD, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  markdown = markdown.replace(/^# 600B Timelock TCG\r?\n+## Edition One Rules\r?\n+/m, "");
  markdown = markdown
    .replaceAll("600B-rulebook-assets/", "../art/rulebook/")
    .replaceAll(
      "../art/rulebook/banner-02-five-resources.svg",
      "../art/rulebook/banner-02-five-resources.webp",
    )
    .replaceAll("600B-resource-icons/", "../art/resources/")
    .replaceAll("../site/lore.html", "lore.html")
    .replaceAll(
      "600B-E1-iconic-six-contact-sheet.png",
      "../art/cards/600B-E1-iconic-six-contact-sheet.png",
    );

  const headings = [];
  markdown = markdown.replace(/^## (.+)$/gm, (_, title) => {
    const id = slugify(title);
    headings.push({ id, title });
    return `<h2 id="${id}">${escapeXml(title)}</h2>`;
  });
  markdown = markdown.replace(/^### (.+)$/gm, (_, title) => {
    const id = slugify(title);
    return `<h3 id="${id}">${escapeXml(title)}</h3>`;
  });
  markdown = markdown.replace(/^#### (.+)$/gm, (_, title) => {
    const id = slugify(title);
    return `<h4 id="${id}">${escapeXml(title)}</h4>`;
  });

  let article = marked.parse(markdown, {
    gfm: true,
    breaks: false,
  });

  /* Drop the markdown's own leading H1 and the "Edition One Rules" H2 under it.
   *
   * The .md is a standalone document and is right to open with its title. This
   * page is not: its template already carries <h1>Build the Network.</h1>, so
   * pasting the article in whole put TWO h1 elements on one page and repeated a
   * heading the reader had just read. It also gave the contents list a first
   * entry pointing at the page it was already on.
   *
   * Fixed HERE rather than in site/rules.html, which is generated: a fix in the
   * output survives exactly until the next build, and the test guarding this
   * would then fail on a file nobody had touched. */
  article = article.replace(
    /^\s*<h1>[^<]*<\/h1>\s*(<h2 id="edition-one-rules">[^<]*<\/h2>\s*)?/,
    "",
  );

  article = article.replace(
    /<p><img src="([^"]*banner-[^"]+)" alt="([^"]*)"><\/p>/g,
    '<figure class="rule-banner"><img src="$1" alt="$2" loading="lazy"></figure>',
  );
  article = article.replace(
    /<p><img src="\.\.\/art\/cards\/600B-E1-iconic-six-contact-sheet\.png" alt="([^"]*)"><\/p>/g,
    '<figure class="card-system-preview"><img src="../art/cards/600B-E1-iconic-six-contact-sheet.png" alt="$1" loading="lazy"><figcaption>Six Edition One faces in the Node Runner frame — the full illustration on the card, rules printed in full below it.</figcaption></figure>',
  );
  article = article.replace(
    /<p><img src="(\.\.\/art\/resources\/[^"]+)" alt="([^"]*)"><\/p>/g,
    '<p class="resource-icon"><img src="$1" alt="$2" loading="lazy"></p>',
  );

  /* Each chapter's own words, folded onto its link, so the filter can find a
   * section by what is IN it rather than only by what it is called. Trimmed to
   * a few hundred characters per chapter: enough for the vocabulary a player
   * types, small enough not to bloat the page. */
  const sectionTerms = (id) => {
    const start = article.indexOf(`id="${id}"`);
    if (start < 0) return "";
    const nextH2 = article.indexOf('<h2 id="', start + 1);
    const body = article.slice(start, nextH2 < 0 ? article.length : nextH2);
    const words = body
      .replace(/<[^>]+>/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2);
    return Array.from(new Set(words)).join(" ").slice(0, 600);
  };

  const toc = headings
    .map(({ id, title }) =>
      `<a href="#${id}" data-terms="${escapeXml(sectionTerms(id))}">${escapeXml(title)}</a>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f0c08">
  <meta name="description" content="Edition One rules for 600B Timelock TCG, a positive cypherpunk card game about Bitcoin, Nostr and open systems.">
  <title>600B Timelock TCG — Edition One Rules</title>
  <link rel="icon" href="../art/brand/600B-logo-primary.png">
  <link rel="preload" href="../art/fonts/Anton-Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="preload" href="../art/fonts/plex-mono-latin-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="../art/fonts/josefin-sans-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="600b.css">
  <!-- The napplet seam. Loaded before the stylesheet's tokens are used so a
       shell-themed panel never flashes the fallback palette first; absent a
       shell it paints exactly what 600b.css already says. -->
  <script src="napplet.js"></script>
  <script src="rail.js"></script>
<script src="bugreport.js" defer></script>
  <script>if (globalThis.E1Napplet) E1Napplet.theme.start();</script>
  <style>
    /* This page links 600b.css and must not repaint it: every colour and face
       below is a contract token (docs/brand-hypershell.md). The chrome is the
       Hypershell — iron ground, brass voice, Plex Mono body, Josefin headings,
       square corners, nothing glows. What stays 600 Billion is the brand: the
       Anton hero title, the logo and the rulebook's own illustrations. The
       measure is set in ch because the body is monospaced now, and a rulebook
       column wider than about eighty characters is a column nobody finishes. */
    :root { --content: 80ch; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; background: var(--iron); }
    body {
      margin: 0;
      color: var(--body-ink);
      background: var(--iron);
      font: 14px/1.8 var(--mono);
    }
    a { color: var(--brass); text-underline-offset: .2em; transition: color var(--t-fast) var(--ease); }
    a:hover { color: var(--parchment); }
    img { max-width: 100%; }
    .page-shell {
      display: grid;
      grid-template-columns: 268px minmax(0, var(--content));
      gap: 64px;
      justify-content: center;
      align-items: start;
      padding: 0 28px 96px;
    }
    .toc {
      position: sticky;
      top: 22px;
      max-height: calc(100vh - 44px);
      overflow: auto;
      margin-top: 38px;
      padding: 18px 16px 22px;
      background: var(--iron-850);
      border: 1px solid var(--hairline);
      border-top: 2px solid var(--brass);
    }
    .toc strong {
      display: block;
      margin: 0 0 12px;
      color: var(--parchment);
      font: 600 14px/1.2 var(--headline);
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .toc a {
      display: block;
      padding: 6px 8px;
      color: var(--ink-quiet);
      border-left: 2px solid transparent;
      font-size: 12px;
      line-height: 1.45;
      text-decoration: none;
    }
    .toc a:hover, .toc a.active {
      color: var(--parchment);
      border-left-color: var(--brass);
      background: var(--well);
    }
    /* Twenty-odd chapters is a scroll; typing two letters is a jump. The field's
       look is .tcg-field (600b.css); only its size is the contents list's. No
       "outline: none" here: the ring is the cue a keyboard user gets. */
    #tocSearch { width: 100%; margin-bottom: 10px; padding: 8px 10px; }
    #tocEmpty { margin: 6px 8px; color: var(--ink-quiet); font-size: 12px; }
    .toc a[hidden] { display: none; }
    /* The sticky site nav owns the top of the viewport — and so does the side
       bar, when it has been moved to the top edge; anchors clear both. */
    h2, h3, h4 { scroll-margin-top: calc(76px + var(--tcg-rail-top, 0px)); }
    .toc { top: calc(74px + var(--tcg-rail-top, 0px)); max-height: calc(100vh - 96px - var(--tcg-rail-top, 0px) - var(--tcg-rail-bottom, 0px)); }
    .hero {
      position: relative;
      min-height: 510px;
      margin: 0 0 36px;
      overflow: hidden;
      background:
        linear-gradient(90deg,
          color-mix(in srgb, var(--iron) 98%, transparent) 0,
          color-mix(in srgb, var(--iron) 78%, transparent) 46%,
          color-mix(in srgb, var(--iron) 12%, transparent) 78%),
        url("../art/site/hero-rules.webp") center/cover;
      border-bottom: 1px solid var(--hairline);
    }
    .hero-inner {
      width: min(1180px, calc(100% - 56px));
      min-height: 510px;
      margin: 0 auto;
      display: flex;
      align-items: center;
    }
    .hero-copy { max-width: 690px; padding: 56px 0; }
    .brand-row { display: flex; align-items: center; gap: 18px; margin-bottom: 28px; }
    .brand-row img { width: 76px; height: 76px; }
    .brand-row span {
      color: var(--brass-2);
      font: 500 11px/1.4 var(--mono);
      letter-spacing: .22em;
      text-transform: uppercase;
    }
    /* The one Anton on the page: the 600 Billion title. */
    .hero h1 {
      max-width: 670px;
      margin: 0;
      color: var(--parchment);
      font: clamp(58px, 8.5vw, 108px)/.92 var(--display);
      letter-spacing: -.025em;
      text-transform: uppercase;
    }
    .hero h1 em { display: block; color: var(--brass); font-style: normal; }
    .hero p {
      max-width: 610px;
      margin: 26px 0 0;
      color: var(--body-ink);
      font-size: clamp(14px, 1.5vw, 16px);
      line-height: 1.75;
    }
    .pills { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 30px; }
    .pills + .pills { margin-top: 14px; }
    article { min-width: 0; padding-top: 20px; }
    article > p:first-child {
      margin-top: 0;
      color: var(--parchment);
      font: 500 16px/1.7 var(--mono);
    }
    h2 {
      margin: 92px 0 24px;
      color: var(--parchment);
      font: 700 clamp(22px, 3vw, 30px)/1.2 var(--headline);
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    /* The setback rule — the Hypershell's stepped divider — marks each chapter. */
    h2::before {
      content: "";
      display: block;
      width: 82px;
      height: 9px;
      margin-bottom: 18px;
      background:
        linear-gradient(var(--brass-2), var(--brass-2)) 0 100% / 100% 1px no-repeat,
        linear-gradient(var(--brass-2), var(--brass-2)) 0 50% / 60% 1px no-repeat,
        linear-gradient(var(--brass-2), var(--brass-2)) 0 0 / 26% 1px no-repeat;
    }
    h3 {
      margin: 48px 0 11px;
      color: var(--parchment);
      font: 600 18px/1.3 var(--headline);
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h4 {
      margin: 34px 0 8px;
      color: var(--brass-2);
      font: 600 12px/1.4 var(--mono);
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    p, li { color: var(--body-ink); }
    strong { color: var(--parchment); }
    /* A pulled-out rule is an emphasized panel with the brass edge, not a slab. */
    blockquote {
      margin: 34px 0;
      padding: 20px 24px;
      color: var(--parchment);
      background: var(--panel);
      border: 1px solid var(--emphasis);
      border-left: 2px solid var(--brass);
    }
    blockquote p { margin: 0; color: var(--parchment); font-weight: 500; }
    table {
      width: 100%;
      margin: 24px 0 34px;
      border-collapse: collapse;
      background: var(--panel);
      font-size: 13px;
    }
    th, td {
      padding: 12px 14px;
      text-align: left;
      vertical-align: top;
      border: 1px solid var(--hairline);
    }
    th {
      color: var(--brass-2);
      background: var(--well);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    tr:nth-child(even) td { background: var(--panel); }
    ol, ul { padding-left: 1.4em; }
    li + li { margin-top: .35em; }
    code {
      padding: .14em .34em;
      color: var(--brass);
      background: var(--well);
      font: .92em var(--mono);
    }
    /* The setback rule again, centred, between sections. */
    hr {
      width: min(22rem, 62%);
      height: 9px;
      margin: 76px auto;
      border: 0;
      background:
        linear-gradient(var(--hairline), var(--hairline)) 50% 100% / 100% 1px no-repeat,
        linear-gradient(var(--hairline), var(--hairline)) 50% 50% / 60% 1px no-repeat,
        linear-gradient(var(--hairline), var(--hairline)) 50% 0 / 26% 1px no-repeat;
    }
    .rule-banner {
      width: calc(100% + 80px);
      margin: 68px 0 62px -40px;
    }
    .rule-banner img {
      display: block;
      width: 100%;
      aspect-ratio: 10 / 3;
      object-fit: cover;
      border: 1px solid var(--hairline);
    }
    .card-system-preview {
      margin: 36px 0 54px;
      padding: 12px;
      background: var(--iron-850);
      border: 1px solid var(--hairline);
    }
    .card-system-preview img { display: block; width: 100%; }
    figcaption { padding: 11px 4px 2px; color: var(--brass-2); font-size: 11px; letter-spacing: .04em; }
    .resource-icon {
      float: left;
      width: 68px;
      margin: 0 17px 8px 0;
    }
    .resource-icon img { display: block; width: 64px; height: 64px; }
    .resource-icon + p { min-height: 72px; }
    article h3[id="power"],
    article h3[id="bitcoin"],
    article h3[id="keys"],
    article h3[id="signal"],
    article h3[id="timelock"] {
      clear: both;
      padding-top: 8px;
    }
    .footer {
      margin-top: 72px;
      padding: 32px 0 60px;
      border-top: 1px solid var(--divider);
      color: var(--brass-3);
      font-size: 12px;
      letter-spacing: .04em;
    }
    .mobile-index {
      display: none;
      position: sticky;
      top: 0;
      z-index: 10;
      color: var(--brass);
      background: var(--iron-850);
      border-bottom: 1px solid var(--hairline);
      font: 600 11px/1.2 var(--mono);
      text-transform: uppercase;
      letter-spacing: .16em;
    }
    .mobile-index > summary {
      padding: 12px 18px;
      cursor: pointer;
      list-style: none;
      min-height: 44px;
      display: flex;
      align-items: center;
    }
    .mobile-index > summary::-webkit-details-marker { display: none; }
    .mobile-index > summary::after { content: " ▾"; margin-left: auto; }
    .mobile-index[open] > summary::after { content: " ▴"; }
    .mobile-toc {
      display: flex;
      flex-direction: column;
      max-height: 60vh;
      overflow: auto;
      background: var(--iron);
      border-top: 1px solid var(--hairline);
    }
    .mobile-toc a {
      padding: 12px 18px;
      min-height: 44px;
      display: flex;
      align-items: center;
      color: var(--body-ink);
      text-decoration: none;
      font: 400 13px/1.4 var(--mono);
      text-transform: none;
      letter-spacing: 0;
      border-bottom: 1px solid var(--divider);
    }
    .mobile-toc a:hover, .mobile-toc a:focus { color: var(--brass); }
    @media (max-width: 1050px) {
      .page-shell { grid-template-columns: minmax(0, var(--content)); }
      .toc { display: none; }
      .mobile-index { display: block; }
      .rule-banner { width: 100%; margin-left: 0; }
    }
    @media (max-width: 640px) {
      body { font-size: 13px; }
      .page-shell { padding: 0 17px 72px; }
      .hero { min-height: 600px; background-position: 67% center; }
      .hero-inner { min-height: 600px; width: calc(100% - 34px); align-items: end; }
      .hero-copy { padding: 160px 0 42px; }
      .brand-row img { width: 58px; height: 58px; }
      .brand-row span { font-size: 10px; }
      .hero h1 { font-size: 58px; }
      .hero p { font-size: 14px; }
      h2 { margin-top: 72px; font-size: 21px; }
      h3 { font-size: 16px; }
      table { display: block; overflow-x: auto; white-space: normal; }
      th, td { min-width: 150px; }
      .rule-banner { margin: 50px 0; }
      .rule-banner img { aspect-ratio: 16 / 7; }
    }
    /* Paper is the parchment ground: one ink, brass·3 for the headings. */
    @media print {
      @page { size: A4; margin: 15mm 16mm 18mm; }
      html, body { background: #fff; color: var(--iron); }
      body { font-size: 9.5pt; }
      .hero {
        min-height: 168mm;
        break-after: page;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .hero-inner { min-height: 168mm; }
      .mobile-index, .toc { display: none; }
      .page-shell { display: block; padding: 0; }
      article { max-width: none; }
      article p, article li { color: var(--iron); }
      h2 { margin-top: 16mm; color: var(--iron); font-size: 20pt; break-after: avoid; }
      h2::before { display: none; }
      h3 { color: var(--brass-3); font-size: 13pt; break-after: avoid; }
      h4 { color: var(--brass-3); break-after: avoid; }
      strong { color: var(--iron); }
      code { color: var(--iron); background: var(--parchment); }
      table { background: #fff; break-inside: avoid; }
      th { color: var(--iron); background: var(--parchment); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      td { color: var(--iron); }
      tr:nth-child(even) td { background: #fff; }
      blockquote { color: var(--iron); background: var(--parchment); border-color: var(--brass-3); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      blockquote p { color: var(--iron); }
      .rule-banner { width: 100%; margin: 12mm 0; break-inside: avoid; }
      .card-system-preview { break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
      .footer { color: var(--brass-3); }
    }
  </style>
</head>
<body>
  <a class="skip" href="#rules-top">Skip to the rules</a>
  <nav class="nav">
    <img class="nav__mark" src="../art/brand/600B-logo-primary.png" alt="">
    <a class="nav__brand" href="index.html" style="text-decoration:none;color:inherit">600B TIMELOCK TCG<small>WE STACK · WE BUILD · WE MEME</small></a>
    <div class="nav__links">
      <a class="link" href="play.html">Play</a>
    <a class="link" href="matchmaking.html">Play online</a>
      <a class="link" href="shop.html">Shop</a>
      <a class="link" href="cards.html">Cards</a>
      <a class="link" href="deck.html">Stacks</a>
      <a class="link" href="rules.html" aria-current="page">Rules</a>
      <a class="link" href="lore.html">Lore</a>
      <a class="link" href="leaderboard.html">Leaderboard</a>
    </div>
  </nav>
  <!-- PHONES USED TO GET NO RULEBOOK NAVIGATION AT ALL. The sidebar contents
       is hidden below 1050px, and its only replacement was a single link to
       "#fast-start" — an id that does not exist, because the heading slugs are
       numbered ("1-fast-start"). So the one control a phone had did nothing,
       and a 1,400-line rulebook had to be scrolled from the top to find
       anything. It is a real contents list now, closed by default. -->
  <details class="mobile-index">
    <summary>Contents — jump to a chapter</summary>
    <nav class="mobile-toc" aria-label="Rulebook contents">${toc}</nav>
  </details>
  <header class="hero">
    <div class="hero-inner">
      <div class="hero-copy">
        <div class="brand-row">
          <img src="../art/brand/600B-logo-primary.png" alt="600 000 000 000">
          <span>Timelock TCG · Edition One</span>
        </div>
        <h1>Build the <em>Network.</em></h1>
        <p>A positive cypherpunk trading card game about Bitcoin, Nostr and the people who keep open systems alive.</p>
        <div class="pills">
          <span class="tcg-chip">2 players</span>
          <span class="tcg-chip">20 Uptime</span>
          <span class="tcg-chip">40+ cards</span>
        </div>
        <div class="pills">
          <a class="tcg-btn tcg-btn--primary" href="quickstart.html">New? Play in 5 minutes →</a>
          <a class="tcg-btn" href="play.html">Play now →</a>
          <a class="tcg-btn" href="cards.html">Browse all cards →</a>
        </div>
      </div>
    </div>
  </header>
  <div class="page-shell">
    <nav class="toc" aria-label="Rulebook chapters">
      <strong>Rulebook E1</strong>
      <input id="tocSearch" class="tcg-field" type="search" placeholder="Filter chapters…" autocomplete="off"
        aria-label="Filter rulebook chapters">
      <div id="tocLinks">${toc}</div>
      <p id="tocEmpty" hidden>No chapter matches.</p>
    </nav>
    <main id="rules-top">
      <article>${article}</article>
      <footer class="footer">
        600B Timelock TCG · E1.0-draft · We stack. We build. We meme. We repeat.
      </footer>
    </main>
  </div>
  <script>
    const links = [...document.querySelectorAll("#tocLinks a")];
    const sections = links
      .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
      .filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === "#" + entry.target.id));
      }
    }, { rootMargin: "-18% 0px -72% 0px" });
    sections.forEach((section) => observer.observe(section));

    /* Filter the chapter list by its title and generated chapter terms. */
    const search = document.getElementById("tocSearch");
    const empty = document.getElementById("tocEmpty");
    search.addEventListener("input", () => {
      const needle = search.value.trim().toLowerCase();
      let shown = 0;
      for (const link of links) {
        const hit = !needle || link.dataset.terms.includes(needle);
        link.hidden = !hit;
        if (hit) shown += 1;
      }
      empty.hidden = shown > 0;
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { search.value = ""; search.dispatchEvent(new Event("input")); }
      if (event.key === "Enter") {
        const first = links.find((link) => !link.hidden);
        if (first) first.click();
      }
    });
  </script>
</body>
</html>`;
  fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html);
}

async function main() {
  renderWebsite();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
