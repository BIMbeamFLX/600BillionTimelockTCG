# Technisches Handover — 2026-08-15

## Stand und Scope

Ausgangspunkt ist `main` auf `5fb20f4` (Merge von PR #10). Der aktuelle Arbeitszweig ist
`feature/remote-reliability`; der geprüfte Reliability-Commit ist `9f9e790`. In diesem
Durchgang wurde nichts deployed und kein öffentlicher Gameserver verändert. Nach Abschluss
der Gates wurde der aktuelle Branch-Stand lokal auf Port 8777 gestartet und per Health-Check
verifiziert.

Der Stand kann heute:

- Hotseat und ein vollständiges Zwei-Client-Match über den autoritativen Referee spielen;
- 295 E1-Karten laden;
- 11 vollständig gescriptete Precons anbieten (5 Starter, 6 Classic);
- Spielzustände pro Sitz redigieren, Aktionen in SQLite persistieren und die Hashkette aus
  dem Transcript reproduzieren;
- 297 releasefähige Web-Bilder anhand ihrer SHA-256-Adressen über drei Blossom-Mirrors laden;
- alle 12 HTML-Seiten über den Node-Referee ausliefern.

Wichtig: Der vollständige Kartenkatalog ist noch nicht vollständig automatisch. Aktuell
sind 169 Karten vollständig gescriptet und 126 Karten als `manual` markiert. Die 11 Precons
enthalten dagegen nur gescriptete Karten. Für Ranked ist deshalb ein expliziter legaler,
vollständig deterministischer Kartenpool nötig.

## Inhalt des Reliability-Slices

- Trigger-Einträge besitzen vor View, Public Hash und Persistenz immer vollständige,
  JSON-sichere Felder. Damit ist der zuvor flakige Match-Freeze reproduziert und behoben.
- Spielernamen gelangen im Turn-HUD nur noch als Text in das DOM.
- Fehlerhafte Prozent-Escapes liefern HTTP 400, ohne den Referee zu beschädigen.
- WebSocket-Nachrichten sind standardmäßig auf 64 KiB dekomprimierte Nutzlast begrenzt.
- HTTP und WebSocket prüfen vertrauenswürdige `Host`-Namen; Browser-WebSockets prüfen
  zusätzlich Origin oder eine explizite `TABLE_ORIGINS`-Freigabe.
- Control-, fehlerhafte und nicht authentifizierte Nachrichten teilen ein Adressbudget,
  das Reconnects überlebt und ungeprüfte `X-Forwarded-For`-Werte ignoriert.

## Verifikation

Alle Angaben beziehen sich auf den finalen Arbeitsstand dieses Handover-Durchgangs.

| Gate | Ergebnis |
| --- | --- |
| `npm run test:js` | 129/129 grün |
| `uv run pytest -q` | 104/104 grün |
| `npm run build` | grün |
| `uv run ruff check .` | grün |
| `uv run ruff format .` | 67 Dateien unverändert |
| Remote-Soak vor dem finalen Review | 100/100 vollständige Matches grün |
| Out-of-process, Port 8778 | vollständiges Match, 642 Aktionen, 248 Transcript-Einträge |
| HTTP-Smoke, Port 8778 | `/api/health`, `/api/tables` und alle 12 Seiten erfolgreich |

Der Out-of-process-Test bestätigte zwei verschiedene Sitz-Views, serverseitiges Fog of War,
Engine-Rejections, SQLite-Persistenz, Replay, Public/State/Entry-Hashes, eine lückenlose
Hashkette und Manipulationserkennung. Danach meldete `/api/health` ein gesundes System und
`/api/tables` null offene Tische, weil das Testmatch beendet war.

Zusätzlich wurden Hotseat und zwei echte Browser-Tabs gegen einen isolierten Referee bedient.
Create/Join, die getrennten Sitze, der HTML-sichere Spielername und ein sauberer Browser ohne
Console-Fehler wurden geprüft. Es wurden dabei keine Screenshot-Artefakte abgelegt; eine
vollständige visuelle Abnahme aller Zustände ist weiterhin offen.

## Architektur in einem Absatz

`site/engine.js` ist die deterministische Regelmaschine. `site/play.js` rendert Hotseat und
Remote-Spiel; `site/net.js` verwaltet WebSocket, Sitz-Token und Resume. `server/table.js` ist
der autoritative Node-Referee: Er besitzt den vollständigen Zustand, liefert pro Sitz nur eine
redigierte View und schreibt akzeptierte Aktionen vor dem Broadcast nach SQLite. Nostr wird
nur für Einladung/Handshake und Ergebnis verwendet, nie für einzelne Züge. Kartenbilder sind
lokal cachebar und über `site/blob-map.js` content-addressed auf Blossom gespiegelt.

## nsite und Referee sind nicht dasselbe

Ein nsite kann die statischen Dateien veröffentlichen, aber keinen Node-WebSocket oder die
HTTP-APIs ausführen. Auf einer HTTPS-Seite leitet `site/net.js` ohne weitere Konfiguration
automatisch `wss://<site-host>/ws` ab. Ein reines nsite hat diesen Endpunkt nicht.

Für LAN und öffentliche Unranked-Spiele ist deshalb die kleinste robuste Form:

1. ein Node-Referee, der Website, `/ws` und `/api/*` gemeinsam ausliefert;
2. für öffentlich: ein TLS-Reverse-Proxy vor genau diesem Prozess;
3. vor dem Launch eine vollständige externe `wss://`-Advertise-URL ergänzen — `PUBLIC_HOST`
   allein veröffentlicht heute noch `ws://<host>:<interner-port>/ws`;
4. den Origin-Port gegen direkten Zugriff sperren und erst dann eine exakt gemessene Zahl
   vertrauenswürdiger Proxy-Hops für die Client-IP-Auflösung implementieren;
5. anschließend zwei reale Geräte, Resume und einen vollständigen Matchlauf prüfen.

Eine getrennte statische Domain kann den Socket per `?table=` und `TABLE_ORIGINS` erreichen.
Die Open-Tables-API hat aktuell aber keine Cross-Origin-Freigabe. Same-Origin vermeidet diese
zusätzliche Fehlerfläche und ist die Empfehlung für die erste öffentliche Version.

## Vertical-Slice-Plan

Jeder Slice endet in etwas Spielbarem und testet Hotseat und Remote über dieselbe Engine.

### Slice 1 — Kampfregeln haben genau eine Wahrheit

- Eine öffentliche Engine-Funktion für Clash-Prognose/Schadensplan bereitstellen.
- Die duplizierte Mathematik aus `site/play.js` entfernen und nur das Engine-Ergebnis rendern.
- Mesh vollständig implementieren: Gruppen deklarieren, gemeinsames Blocken, Damage Routing
  und Sitz-Entscheidungen.
- Akzeptanz: Engine-, UI- und Remote-Tests für First Strike, Overflow, mehrere Blocker und Mesh;
  die Vorschau ist nicht nur gleich, sondern stammt strukturell aus der Engine.

### Slice 2 — Eine verständliche Deklarationsphase

- Targeting, Angriff und Blocken über ein einheitliches Drag-Modell.
- Reihenfolge mehrerer Blocker sichtbar und änderbar machen.
- Undo erlauben, solange die atomare Deklaration noch nicht an den Referee gesendet wurde.
- Akzeptanz: Maus und Touch, legale Ziele sichtbar, keine zusätzliche Netzwerkaktion pro Drag.

### Slice 3 — LAN und öffentliches Unranked wirklich ausliefern

- Same-Origin-Setup mit TLS-Reverse-Proxy als versionierte Konfiguration dokumentieren.
- Eine vollständige externe Table-URL konfigurieren, Host/Origin prüfen und Proxy-Vertrauen nur
  nach gesperrtem Direktzugriff mit exakt gemessener Hop-Zahl aktivieren.
- Zwei-Geräte-LAN-Test und öffentlicher Create/Join/Resume/Full-Match-Test durchführen.
- Akzeptanz: Invite-Link funktioniert auf einem zweiten Gerät; kein Mixed Content; Health,
  Tabellenliste und WebSocket laufen unter derselben HTTPS-Origin.

### Slice 4 — NIP-07 als Login, nicht als Zugprotokoll

- NIP-07 im Lobby-Einstieg verwenden und den angemeldeten npub sichtbar an den Sitz binden.
- Gastmodus für Unranked bewusst erlauben oder bewusst abschalten; keine Signatur-Popups pro Zug.
- Sitz-Token bleibt das schnelle Reconnect-Credential.
- Akzeptanz: zwei echte Extensions, Login/Logout, Reload und Seat-Resume. Kryptografische
  Serverprüfung von Ergebnisereignissen bleibt ausdrücklich ein späterer Ranked-Slice.

### Slice 5 — Release-Assets aufräumen

- Zuerst ein unveränderliches Release/Tag mit den bisherigen Quellen und Generatorausgaben
  erstellen.
- Im aktiven Tree nur den freigegebenen Node-Runner-Websatz, Card Back, Promo und die dafür
  nötigen Manifeste/Generatorquellen behalten; alte JPEG-/Zwischengenerationen auslagern.
- Manifest, 297 Hashes, lokale Fallbacks und alle drei Blossom-Mirrors erneut verifizieren.
- Akzeptanz: frischer Checkout zeigt jede veröffentlichte Karte, ohne alte Laufzeitpfade.

### Slice 6 — Ranked als eigener deterministischer Modus

- Ranked-Legalität auf vollständig gescriptete Karten/Decks begrenzen; `manual`/assisted bleibt
  in Casual/Unranked sichtbar erlaubt, bis die jeweilige Karte gescriptet ist.
- Danach Signaturprüfung, Matchmaking, Ergebnisbestätigung, Dispute-Regeln und Ladder ergänzen.
- Akzeptanz: der Referee kann jede legale Ranked-Partie ohne menschliche Regelauslegung replayen;
  beide Identitäten und das Ergebnis sind kryptografisch verifiziert.

## Direkte nächste Entscheidung

Die sinnvollste Reihenfolge ist Slice 1 → 2 → 3 → 4 → 5 → 6. Damit wird zuerst das Spiel
regelrichtig und angenehm, dann erreichbar, danach identitätsfähig und erst anschließend
ranked. Die offenen Detailentscheidungen stehen am Ende von [`BUGS.md`](BUGS.md).
