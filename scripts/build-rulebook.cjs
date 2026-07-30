const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MD = path.join(ROOT, "rules", "600B-Timelock-TCG-Rulebook-E1.md");
const OUTPUT_HTML = path.join(ROOT, "site", "rules.html");

const colors = {
  orange: "#F7931A",
  bright: "#FFA733",
  ember: "#FF6A00",
  purple: "#B991E4",
  purpleDeep: "#7447B8",
  violet: "#5E5ACB",
  black: "#000000",
  soot: "#111111",
  charcoal: "#222222",
  white: "#FFF7EC",
};

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
  let markdown = fs.readFileSync(SOURCE_MD, "utf8").replace(/^\uFEFF/, "");
  markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  markdown = markdown.replace(/^# 600B Timelock TCG\r?\n+## Edition One Rules\r?\n+/m, "");
  markdown = markdown
    .replaceAll("600B-rulebook-assets/", "../art/rulebook/")
    .replaceAll("600B-resource-icons/", "../art/resources/")
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
  article = article.replace(
    /<p><img src="([^"]*banner-[^"]+)" alt="([^"]*)"><\/p>/g,
    '<figure class="rule-banner"><img src="$1" alt="$2" loading="lazy"></figure>',
  );
  article = article.replace(
    /<p><img src="\.\.\/art\/cards\/600B-E1-iconic-six-contact-sheet\.png" alt="([^"]*)"><\/p>/g,
    '<figure class="card-system-preview"><img src="../art/cards/600B-E1-iconic-six-contact-sheet.png" alt="$1" loading="lazy"><figcaption>First six E1 pipeline proofs. Rules text and educational notes are rendered separately from the art.</figcaption></figure>',
  );
  article = article.replace(
    /<p><img src="(\.\.\/art\/resources\/[^"]+)" alt="([^"]*)"><\/p>/g,
    '<p class="resource-icon"><img src="$1" alt="$2" loading="lazy"></p>',
  );

  const toc = headings
    .map(({ id, title }) => `<a href="#${id}">${escapeXml(title)}</a>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#000000">
  <meta name="description" content="Edition One rules for 600B Timelock TCG, a positive cypherpunk card game about Bitcoin, Nostr and open systems.">
  <title>600B Timelock TCG — Edition One Rules</title>
  <style>
    @font-face {
      font-family: "Anton600";
      src: url("../art/fonts/Anton-Regular.ttf") format("truetype");
      font-display: swap;
    }
    @font-face {
      font-family: "Alfa600";
      src: url("../art/fonts/AlfaSlabOne-Regular.ttf") format("truetype");
      font-display: swap;
    }
    :root {
      --orange: ${colors.orange};
      --bright: ${colors.bright};
      --ember: ${colors.ember};
      --purple: ${colors.purple};
      --purple-deep: ${colors.purpleDeep};
      --violet: ${colors.violet};
      --black: ${colors.black};
      --soot: ${colors.soot};
      --charcoal: ${colors.charcoal};
      --white: ${colors.white};
      --muted: #c9bdcf;
      --line: rgba(185,145,228,.28);
      --content: 850px;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; background: var(--black); }
    body {
      margin: 0;
      color: var(--white);
      background:
        radial-gradient(circle at 86% 10%, rgba(116,71,184,.16), transparent 30rem),
        linear-gradient(180deg, #050506 0, #0d0b10 55%, #050506 100%);
      font: 17px/1.68 "Trebuchet MS", Arial, sans-serif;
    }
    a { color: var(--bright); text-underline-offset: .2em; }
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
      background: rgba(17,17,17,.88);
      border: 1px solid var(--line);
      border-top: 4px solid var(--orange);
      backdrop-filter: blur(16px);
    }
    .toc strong {
      display: block;
      margin: 0 0 11px;
      color: var(--purple);
      font: 24px/1 Anton600, Impact, sans-serif;
      letter-spacing: .045em;
      text-transform: uppercase;
    }
    .toc a {
      display: block;
      padding: 6px 8px;
      color: #d9cede;
      border-left: 2px solid transparent;
      font-size: 12px;
      line-height: 1.35;
      text-decoration: none;
    }
    .toc a:hover, .toc a.active {
      color: var(--white);
      border-left-color: var(--orange);
      background: rgba(185,145,228,.09);
    }
    .hero {
      position: relative;
      min-height: 510px;
      margin: 0 0 36px;
      overflow: hidden;
      background:
        linear-gradient(90deg, rgba(0,0,0,.98) 0, rgba(0,0,0,.78) 46%, rgba(0,0,0,.12) 78%),
        url("../art/rulebook/banner-01-build-the-network.webp") center/cover;
      border-bottom: 1px solid var(--line);
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
      color: var(--purple);
      font-weight: 700;
      letter-spacing: .2em;
      text-transform: uppercase;
    }
    .hero h1 {
      max-width: 670px;
      margin: 0;
      color: var(--white);
      font: clamp(58px, 8.5vw, 108px)/.92 Anton600, Impact, sans-serif;
      letter-spacing: -.025em;
      text-transform: uppercase;
    }
    .hero h1 em { display: block; color: var(--orange); font-style: normal; }
    .hero p {
      max-width: 610px;
      margin: 26px 0 0;
      color: #e6dfea;
      font-size: clamp(18px, 2vw, 23px);
    }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 30px; }
    .pill {
      display: inline-block;
      padding: 8px 12px;
      color: var(--black);
      background: var(--purple);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    a.pill { text-decoration: none; }
    a.pill:hover { background: var(--orange); }
    article { min-width: 0; padding-top: 20px; }
    article > p:first-child {
      margin-top: 0;
      color: var(--purple);
      font: 29px/1.24 Georgia, serif;
    }
    h2, h3, h4 { scroll-margin-top: 28px; }
    h2 {
      margin: 92px 0 24px;
      color: var(--orange);
      font: clamp(38px, 6vw, 64px)/1 Anton600, Impact, sans-serif;
      letter-spacing: -.015em;
      text-transform: uppercase;
    }
    h2::before {
      content: "";
      display: block;
      width: 82px;
      height: 6px;
      margin-bottom: 17px;
      background: linear-gradient(90deg, var(--orange), var(--purple));
    }
    h3 {
      margin: 48px 0 11px;
      color: var(--purple);
      font: 29px/1.12 Anton600, Impact, sans-serif;
      letter-spacing: .015em;
      text-transform: uppercase;
    }
    h4 {
      margin: 34px 0 8px;
      color: var(--bright);
      font-size: 18px;
      letter-spacing: .035em;
    }
    p, li { color: #ded6e1; }
    strong { color: var(--white); }
    blockquote {
      margin: 34px 0;
      padding: 22px 26px;
      color: var(--black);
      background: var(--purple);
      border-left: 8px solid var(--orange);
    }
    blockquote p { margin: 0; color: var(--black); font-weight: 700; }
    table {
      width: 100%;
      margin: 24px 0 34px;
      border-collapse: collapse;
      background: rgba(17,17,17,.75);
      font-size: 14px;
    }
    th, td {
      padding: 13px 15px;
      text-align: left;
      vertical-align: top;
      border: 1px solid var(--line);
    }
    th { color: var(--black); background: var(--purple); }
    tr:nth-child(even) td { background: rgba(185,145,228,.04); }
    ol, ul { padding-left: 1.4em; }
    li + li { margin-top: .35em; }
    code {
      padding: .14em .34em;
      color: var(--black);
      background: var(--purple);
      font: .9em "JetBrains Mono", Consolas, monospace;
    }
    hr {
      height: 1px;
      margin: 76px 0;
      border: 0;
      background: linear-gradient(90deg, transparent, var(--orange), var(--purple), transparent);
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
      border: 1px solid var(--line);
      box-shadow: 0 28px 90px rgba(0,0,0,.48);
    }
    .card-system-preview {
      margin: 36px 0 54px;
      padding: 12px;
      background: #050506;
      border: 1px solid var(--line);
    }
    .card-system-preview img { display: block; width: 100%; }
    figcaption { padding: 11px 4px 2px; color: var(--muted); font-size: 12px; }
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
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
    }
    .mobile-index {
      display: none;
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 11px 18px;
      color: var(--black);
      background: var(--purple);
      font-weight: 900;
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    @media (max-width: 1050px) {
      .page-shell { grid-template-columns: minmax(0, var(--content)); }
      .toc { display: none; }
      .mobile-index { display: block; }
      .rule-banner { width: 100%; margin-left: 0; }
    }
    @media (max-width: 640px) {
      body { font-size: 16px; }
      .page-shell { padding: 0 17px 72px; }
      .hero { min-height: 600px; background-position: 67% center; }
      .hero-inner { min-height: 600px; width: calc(100% - 34px); align-items: end; }
      .hero-copy { padding: 160px 0 42px; }
      .brand-row img { width: 58px; height: 58px; }
      .brand-row span { font-size: 12px; }
      .hero h1 { font-size: 58px; }
      .hero p { font-size: 17px; }
      h2 { margin-top: 72px; font-size: 42px; }
      h3 { font-size: 25px; }
      table { display: block; overflow-x: auto; white-space: normal; }
      th, td { min-width: 150px; }
      .rule-banner { margin: 50px 0; }
      .rule-banner img { aspect-ratio: 16 / 7; }
    }
    @media print {
      @page { size: A4; margin: 15mm 16mm 18mm; }
      html, body { background: #fff; color: #000; }
      body { font-size: 10pt; }
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
      article p, article li { color: #181818; }
      h2 { margin-top: 16mm; color: #7b3d00; font-size: 29pt; break-after: avoid; }
      h3 { color: #5f328c; font-size: 17pt; break-after: avoid; }
      h4 { color: #9a4b00; break-after: avoid; }
      table { background: #fff; break-inside: avoid; }
      th { color: #000; background: #d4b5ed; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      td { color: #111; }
      blockquote { background: #d4b5ed; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .rule-banner { width: 100%; margin: 12mm 0; break-inside: avoid; }
      .rule-banner img { box-shadow: none; }
      .card-system-preview { break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
      .footer { color: #333; }
    }
  </style>
</head>
<body>
  <a class="mobile-index" href="#fast-start">Jump to rules</a>
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
          <span class="pill">2 players</span>
          <span class="pill">20 Uptime</span>
          <span class="pill">40+ cards</span>
          <span class="pill">Classic profile</span>
          <a class="pill" href="cards.html">Browse all cards →</a>
          <a class="pill" href="leaderboard.html">Sats leaderboard →</a>
        </div>
      </div>
    </div>
  </header>
  <div class="page-shell">
    <nav class="toc" aria-label="Rulebook chapters">
      <strong>Rulebook E1</strong>
      ${toc}
    </nav>
    <main>
      <article>${article}</article>
      <footer class="footer">
        600B Timelock TCG · E1.0-draft · We stack. We build. We meme. We repeat.
      </footer>
    </main>
  </div>
  <script>
    const links = [...document.querySelectorAll(".toc a")];
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
