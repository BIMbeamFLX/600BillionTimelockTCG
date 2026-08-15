# Technisches Handover — 2026-08-15

## Ergebnis dieses Arbeitsstands

Ausgangspunkt ist `main` auf `5fb20f4` (PR #10). Gearbeitet wird auf
`feature/remote-reliability`; die bereits lokalen Commits `9f9e790` und `d966dc2` tragen
Referee-Härtung und den ersten Handover-Stand. Dieser Durchgang wurde nicht deployed und
nicht gepusht.

Der Stand kann heute:

- Hotseat, NPC und vollständige Zwei-Client-Matches über denselben deterministischen
  Engine-Kern spielen;
- alle 295 Edition-One-Karten automatisch auflösen: 295 gescriptet, 0 assisted;
- alle 11 Precons und den vollständigen Kartenpool in Casual und künftig Ranked verwenden;
- Mesh-Gruppen bilden, gemeinsam blockieren und gegnerischen Schaden über einen
  deterministischen legalen Standard routen;
- Clash-Vorschauen direkt durch eine Engine-Simulation erzeugen — die UI enthält keine
  zweite Schadensrechnung mehr;
- jede strukturierte Spielaktion als kurzen, semantisch gefärbten Impuls darstellen;
- Uptime als Kreis- und Balkenmeter mit Prozentfüllung, Farbstufe, Status und statischem
  Reduced-Motion-Fallback darstellen;
- Online-Sitze ausschließlich nach einer frischen NIP-07/NIP-42-Signatur vergeben und die
  Identität bei Create, Join und Resume an den Sitz binden;
- Fog of War serverseitig erzwingen, Aktionen in SQLite persistieren und die komplette
  Hashkette aus dem Transcript reproduzieren;
- 297 content-adressierte Release-WebPs lokal und über die bestehenden Blossom-Mirrors laden.

Released Local und Remote verwenden `policy.freeform = "deny"`. Die alten Manual-APIs bleiben
nur als getestete Abwärtskompatibilitäts- und Sicherheitsgrenze im Engine-Code; keine
veröffentlichte Karte benötigt sie.

## Verifikation

| Gate | Ergebnis |
| --- | --- |
| `npm run test:js` | 182/182 grün |
| `uv run pytest -q` | 108/108 grün |
| `npm run build` | grün |
| Ruff auf allen versionierten Python-Dateien | grün; 49 Dateien formatiert |
| Kartencompiler | 295 Karten, 295 auto-resolving, 0 assisted |
| Galeriecompiler | 296 Bild-/Textkarten |
| HTTP-Smoke | alle 12 HTML-Seiten sowie `/api/health` und `/api/tables` erfolgreich |
| Out-of-process-Match | 380 Aktionen, 210 Transcript-Einträge, reguläres Ende in Turn 7 |
| Browser-Abnahme | Zap 20 → 17, Meter 100 % → 85 %, Treffer sichtbar, Reduced Motion statisch, keine Console-Fehler |

Der Zwei-Client-Lauf bestätigte unterschiedliche Sitz-Views, serverseitiges Fog of War,
Engine-Rejections, SQLite-Persistenz, Replay, Public-/State-/Entry-Hashes, eine lückenlose
Hashkette, Manipulationserkennung und identische Ergebnisbytes für beide Signaturen.

Die NIP-42-Tests prüfen den kanonischen Event-Hash, BIP-340-Schnorr-Signatur, Kind `22242`,
leeren Inhalt, exakte Relay-/Challenge-Tags, Zeitfenster und Einmaligkeit der Challenge.
Bare Pubkey-Claims, Replays und Identitätswechsel werden abgewiesen. Offene Tabellen aus der
Zeit vor dem verpflichtenden NIP-07-Login werden weder gelistet noch joinbar gemacht.

Der normale Root-Aufruf `uv run ruff check .` sieht zusätzlich den ungetrackten,
nicht zu diesem Arbeitsstand gehörenden Ordner `art/video-intro/` und meldet dort sechs
Lint-Befunde sowie eine Formatabweichung. Der Ordner wurde bewusst weder geändert noch
committet; alle versionierten Python-Dateien bestehen Ruff.

## Architektur

`site/engine.js` ist die Regelwahrheit. `site/play.js` rendert Hotseat und Remote-Spiel,
übersetzt Engine-Ereignisse in lesbare Aktionsimpulse und sammelt nur noch nicht abgesendete
Spielerabsichten. `site/net.js` führt den NIP-42-Handshake und transportiert danach Aktionen.
`server/table.js` besitzt den vollständigen Zustand, sendet pro Sitz eine redigierte View und
schreibt akzeptierte Aktionen vor dem Broadcast nach SQLite. `site/fx.js` liefert die gepoolten,
begrenzten Audio-/VFX-Cues; wichtige Treffer und Uptime-Änderungen verdrängen bei schnellen
Ereignisketten gewöhnliche Pass-/Phasenmeldungen, nicht umgekehrt.

Ein nsite kann weiterhin nur die statischen Dateien veröffentlichen. Public Unranked und
Ranked brauchen den Node-Referee hinter TLS. Same-Origin für Website, `/ws` und `/api/*` bleibt
die kleinste robuste öffentliche Topologie.

## Kartenbilder und Aufräumen

`art/cards/final/` war die ersetzte JPEG-Generation und ist im aktuellen Arbeitsstand gelöscht.
Aktiv bleibt ausschließlich `art/cards/node-runner-web/`: 297 getrackte WebPs plus Manifest,
41.8 MB, alle 297 lokalen SHA-256-Prüfungen grün. Der Release-Satz ist bereits durch Commit
`3c50d45` auf `origin/main` und `public/main` in GitHub gesichert; die Blossom-Adressen bleiben
die ausliefernden Mirrors.

## Ranked-Regel

Es gibt keinen künstlich kleineren „Certified“-Pool mehr: Casual und Ranked dürfen alle 295
Karten verwenden, weil der gesamte Katalog gescriptet ist. Ranked ergänzt später Identitäts-,
Matchmaking-, Zeit-, Ergebnis- und Ladder-Regeln, aber keine zweite Kartenregelmaschine.

## Nächste Vertical Slices

### Slice 1 — Public Unranked ausliefern

- Same-Origin-TLS-Proxy und vollständige externe `wss://`-URL versionieren.
- Origin-Port sperren und Proxy-Hop-Vertrauen exakt konfigurieren.
- Zwei echte Geräte: NIP-07-Login, Create, Join, Resume und vollständiges Match.
- Akzeptanz: keine Gäste, kein Mixed Content, Health/API/Socket unter einer HTTPS-Origin.

### Slice 2 — Kampfentscheidungen vollständig sichtbar machen

- Mehrfachblocker-Reihenfolge sichtbar und änderbar machen.
- Mesh-Schadensrouting als bewusste Spielerentscheidung anbieten; der heutige automatische
  Standard bleibt der sichere Fallback.
- Undo für noch nicht abgesendete Angreifer-/Blocker-/Routing-Deklarationen.
- Akzeptanz: Maus und Touch, eine atomare Netzwerkaktion pro Deklaration, Engine validiert alles.

### Slice 3 — Verifizierte Ergebnisse

- Invite-, Accept- und Result-Event-IDs/Signaturen serverseitig prüfen.
- Beide verifizierten Resultate mit der Sitzidentität verbinden.
- Authority-Key republished nur bestätigte Matches für Ranked.

### Slice 4 — Ranked spielbar machen

- Matchmaking, Rundenzeit, Disconnect-/Forfeit-Regeln und Deck-Commitment.
- Rating/Ladder erst nach verifiziertem Ergebnis aktualisieren.
- Replay-/Dispute-Ansicht für Turnierbetrieb.

### Slice 5 — Bezahlter Mint

- LNURL-Ziel konfigurieren, Zahlung Ende-zu-Ende testen und Fehler-/Refund-Pfade belegen.
