# Claude-Handover — Website-Art — 2026-08-16

## Kurzfassung

Der gesperrte Website-Art-Katalog in
`art/prompts/WEBSITE-ART-PROMPTS.md` wurde vollständig ausgeführt. Zehn finale Assets
sind erzeugt, auf die geforderten Ausgabegrößen hochskaliert und auf den vorgesehenen
Seiten eingebunden. Build, 305 JavaScript-Tests, 108 Python-Tests und die visuelle
Browser-Abnahme sind grün.

Es wurde bewusst **nicht committed, gepusht oder veröffentlicht**. Keine Schlüssel,
`nsec`, Blossom-, nsite- oder sonstigen Publishing-Schritte wurden verwendet.

## Git-Zustand

- Repository: `G:\Github\TCG600nap`
- Branch: `fix/art-crop-full-heads`
- HEAD vor diesem uncommitteten Website-Art-Slice: `87703c8`
- Der Branch enthält bereits vier Commits gegenüber `origin/main`:
  - `f1f1c0f fix: stop cutting the heads off sixteen cards`
  - `d35c406 feat: the card shows the whole picture`
  - `499e0df docs: the handover's unpublished-blob count moved from 13 to the whole set`
  - `87703c8 feat: audit the site's imagery and lock the website art prompts`
- `art/video-intro/` ist ungetrackter, fremder Nutzer-WIP. Nicht ändern und nicht stagen.

## Erzeugte Assets

| ID | Datei | Ausgabe |
| --- | --- | --- |
| WEB-01 | `art/site/hero-index.webp` | 2880 × 1280, WebP q90 |
| WEB-02 | `art/site/hero-rules.webp` | 2880 × 1280, WebP q90 |
| WEB-03 | `art/site/hero-quickstart.webp` | 2880 × 1280, WebP q90 |
| WEB-04 | `art/site/hero-lore.webp` | 2880 × 1280, WebP q90 |
| WEB-05 | `art/site/hero-play.webp` | 2880 × 1280, WebP q90 |
| WEB-06 | `art/site/hero-shop.webp` | 2880 × 1280, WebP q90 |
| WEB-07 | `art/site/hero-leaderboard.webp` | 2880 × 1280, WebP q90 |
| WEB-08 | `art/rulebook/banner-02-five-resources.webp` | 1600 × 480, WebP q90 |
| WEB-09 | `art/rulebook/banner-05-clash.webp` | 1600 × 480, WebP q90 |
| WEB-10 | `art/site/og-card.png` | 1200 × 630, PNG |

Die Prompts wurden unverändert aus dem Katalog übernommen. Die Bildgenerierung lief mit
der höchsten eingebauten, schlüssellosen Auflösung; anschließend wurde mit Pillow/Lanczos
deterministisch auf das Ausgabeformat skaliert. WEB-08 und WEB-09 bekamen wegen ihrer
weniger breiten Rohbilder ruhige dunkle Seitenflächen statt Verzerrung oder aggressivem
Beschnitt. Das Ergebnis wurde im echten Seitenlayout abgenommen.

Verwendete Identitäts-/Weltreferenzen:

- WEB-01: `art/world-plates/original/timelock.png`
- WEB-03: `art/references/join-detailed-front/flx.png`
- WEB-03: `art/references/join-detailed-front/madmunky.png`
- WEB-10: `art/brand/600B-logo-primary.png` wurde nach der Generierung als echtes Logo
  mit ungefähr 180 px Größe zusammengesetzt.

Die unbeschnittenen Weltplatten unter `art/world-plates/original/` waren vorhanden. Es
wurde nicht auf die weicheren Web-Proxies zurückgefallen. Die rohen Modell-Ausgaben liegen
außerhalb des Repositories unter
`C:\Users\FLX\.codex\generated_images\01a004e0-fa6f-7292-b9ef-d3d570999c7d\`.
Der nur für diese Verarbeitung verwendete Scratch-Runner
`art/generated/process_website_art.py` ist gitignoriert und gehört nicht automatisch in
einen Commit.

## Einbindung

- `site/index.html`
  - neues Hero-Hintergrundbild;
  - OG-/Twitter-Bild auf `og-card.png`, inklusive 1200 × 630 Metadaten;
  - Ressourcen-Banner von SVG auf das neue WebP umgestellt.
- `site/rules.html`
  - neues Rules-Hero;
  - Ressourcen-Banner auf WebP umgestellt;
  - Clash-Banner nutzt denselben Pfad und benötigte keine Markup-Änderung.
- `scripts/build-rulebook.cjs`
  - dieselben Hero- und Banner-Verweise wurden im Generator hinterlegt, damit ein
    Regelbuch-Build diese Änderung nicht zurücksetzt.
- `site/quickstart.html`, `site/lore.html`, `site/play.html`
  - bisherige World-Plate-Hintergründe durch die jeweiligen neuen Heroes ersetzt.
- `site/shop.html`, `site/leaderboard.html`
  - echte, responsive Hero-Bereiche ergänzt und den vorhandenen Einleitungstext dorthin
    verschoben.

Wichtig: `npm run build` besitzt schon vor diesem Slice eine unabhängige Drift beim
`card-system-preview`-Alttext/Caption in `site/rules.html`. Der Build schreibt dort den
älteren Generator-Text. Nach dem erfolgreichen Build wurde die bereits vorgefundene,
neuere Fassung in `site/rules.html` wiederhergestellt. Wenn Claude den Build erneut laufen
lässt, darf diese eine fremde Textänderung nicht versehentlich mitcommittet werden; entweder
die bestehende Fassung wiederherstellen oder den Generator in einem getrennten Fix angleichen.

## Verifikation

| Gate | Ergebnis |
| --- | --- |
| `npm run build` | erfolgreich |
| `npm run test:js` | 305/305 grün |
| `uv run pytest -q` | 108/108 grün |
| `git diff --check` | sauber; nur Windows-Zeilenende-Warnungen |
| Bildformatprüfung | alle zehn Dateien haben exakt die Zielmaße |
| Browser-Abnahme | Index, Rules, Quickstart, Lore, Play, Shop und Leaderboard ohne Console-Fehler |
| Banner-Abnahme | Ressourcen- und Clash-Banner im jeweiligen Regelkapitel sichtbar und korrekt |

Der lokale Server antwortete während der Abnahme unter
`http://localhost:8777/index.html` mit HTTP 200.

## Beabsichtigter uncommitteter Scope

Vor dem Staging mit `git status --short` prüfen. Zum Website-Art-Slice gehören:

```text
art/rulebook/banner-02-five-resources.webp
art/rulebook/banner-05-clash.webp
art/site/hero-index.webp
art/site/hero-leaderboard.webp
art/site/hero-lore.webp
art/site/hero-play.webp
art/site/hero-quickstart.webp
art/site/hero-rules.webp
art/site/hero-shop.webp
art/site/og-card.png
scripts/build-rulebook.cjs
site/index.html
site/leaderboard.html
site/lore.html
site/play.html
site/quickstart.html
site/rules.html
site/shop.html
docs/handover/2026-08-16/CLAUDE-HANDOVER.md
```

Explizit nicht Teil dieses Scopes:

```text
art/video-intro/
art/generated/process_website_art.py
```

## Empfohlene Fortsetzung für Claude

1. `git status --short` lesen und `art/video-intro/` ausschließen.
2. Den oben beschriebenen Build-Drift beachten, falls `npm run build` erneut läuft.
3. Falls der Owner einen Commit freigibt, nur den expliziten Scope stagen und einen
   Conventional-Commit wie `feat: add locked website artwork` verwenden.
4. Wegen der vier vorhandenen Branch-Commits vor Push/PR zuerst den geplanten PR-Scope mit
   dem Owner bestätigen.
5. Keine Bilder zu Blossom/nsite hochladen und keine Schlüssel lesen oder verwenden, bis
   der Owner dies ausdrücklich als separaten Publishing-Slice beauftragt.

