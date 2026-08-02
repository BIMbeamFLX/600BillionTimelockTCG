/* Rasterize the canonical resource icons once, so the card renderer can composite
 * them "as-is" per the Node Runner handoff rather than redrawing them by hand.
 * Run after changing art/resources/*.svg. */
const { Resvg } = require("@resvg/resvg-js");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(REPO_ROOT, "art", "resources");
const OUT = path.join(SOURCE, "png");
/* 4x the largest on-card use, so every downscale stays clean. That used to be
 * 256 against a 64px cost pip — but Basic Resource now prints one giant 200px
 * symbol, which left the master only 1.28x its biggest use and no headroom at
 * 300 dpi. */
const SIZE = 800;

fs.mkdirSync(OUT, { recursive: true });

const icons = ["power", "bitcoin", "keys", "signal", "timelock"];
for (const name of icons) {
  const svg = fs.readFileSync(path.join(SOURCE, `${name}.svg`));
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: SIZE } });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  console.log(`  ${name}.png  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`rasterized ${icons.length} resource icons to ${path.relative(REPO_ROOT, OUT)}`);
