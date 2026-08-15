# Bestätigte Restpunkte — 2026-08-15

> **Nachtrag, später am 2026-08-15.** Dieses Dokument ist der Stand eines
> Zeitpunkts und wird nicht rückwirkend umgeschrieben. Seither erledigt:
>
> - **B-01 teilweise** — die eigentliche Ursache ist behoben: `publicTableUrl()`
>   kodierte `ws://` und den gebundenen Port fest, wodurch hinter TLS jede
>   veröffentlichte Einladung sowohl als Mixed Content blockiert als auch auf
>   einen unerreichbaren Port gerichtet war — lautlos. `PUBLIC_URL` benennt beides
>   jetzt explizit. Deployment und externer Test stehen weiterhin aus (`docs/deploy.md`).
> - **B-02 erledigt** — Invite-, Accept- und Result-Events werden vor dem Speichern
>   geprüft: Event-Id aus den eigenen Bytes neu berechnet, BIP-340-Signatur
>   verifiziert, Ablehnung statt Zeile. `sig_checked` ist `1`. Die damalige
>   Begründung war überholt: `@noble/curves` war für den NIP-42-Login längst
>   Abhängigkeit.
> - **B-05 unverändert und weiterhin richtig so** — der Shop sagt jetzt offen,
>   dass bezahlte Packs nicht live sind, statt einen Knopf anzubieten, der nichts tut.
>
> B-03 (Mesh-Routing ohne freie Spielerwahl) und B-04 (Blocker-Reihenfolge und
> Undo) sind unverändert offen.

Dieses Dokument enthält nur lokal belegte Restpunkte. Behobene frühere Befunde — assisted
Karten, doppelte Clash-Mathematik, wirkungsloses Mesh, bare Pubkey-Claims, Reconnect-/Rate-
Limit-Bypässe und der undefinierte Attack-Glow-Farbwert — stehen nicht mehr als offene Bugs hier.

## Übersicht

| ID | Schwere | Befund | Ziel betroffen |
| --- | --- | --- | --- |
| B-01 | P1 hoch | Öffentliches TLS-/Proxy-Deployment ist nicht konfiguriert oder extern getestet | Public Unranked |
| B-02 | P1 hoch | Invite-, Accept- und Result-Signaturen werden noch nicht serverseitig geprüft | Ranked |
| B-03 | P2 mittel | Mesh-Schadensrouting nutzt einen legalen automatischen Standard, aber noch keine freie Spieleraufteilung | Kampf-UX |
| B-04 | P2 mittel | Mehrfachblocker-Reihenfolge und Undo sind noch nicht sichtbar bedienbar | Kampf-UX |
| B-05 | P2 mittel | Der bezahlte Mint hat keine konfigurierte LNURL | Shop |

## B-01 — Public Unranked braucht die reale Zieltopologie

**Dateien:** `server/table.js`, `site/net.js`

Der Referee liefert lokal Website, API und Socket gemeinsam aus. Hinter HTTPS erzeugt
`PUBLIC_HOST` allein aber noch keine vollständige externe `wss://`-Advertise-URL. Ein statisches
nsite stellt `/ws` und `/api/*` nicht bereit. Reverse Proxy, Origin-Firewall, Proxy-Hop-Vertrauen
und zwei echte Geräte wurden in diesem Durchgang bewusst nicht deployed oder geprüft.

## B-02 — Login ist verifiziert, gespeicherte Nostr-Ergebnisse noch nicht

**Dateien:** `server/table.js`, `docs/net-protocol.md`

Der NIP-42-Login wird vollständig kryptografisch geprüft. Invite-, Accept- und Kind-31600-
Result-Events werden dagegen weiterhin mit `sig_checked = 0` gespeichert. Sitzbindung verhindert
eine fremde Zuschreibung innerhalb der Verbindung, reicht aber nicht als Ranked-Autorität.

## B-03 — Mesh-Routing ist legal, aber noch automatisch

**Dateien:** `site/engine.js`, `site/play.js`

Mesh-Gruppen können im UI gebildet werden; ein Block trifft die ganze Gruppe. Die Engine routet
gegnerischen Schaden deterministisch auf ein legales Opfer und verhindert dadurch Stillstand.
Das Regelbuch erlaubt dem Mesh-Controller jedoch eine freie Verteilung. Diese strategische Wahl
braucht noch eine sichtbare, atomare Routing-Oberfläche.

## B-04 — Kampfdeklarationen brauchen den letzten Bedien-Slice

**Dateien:** `site/play.js`, `site/play.html`

Angreifen und Blocken funktionieren per Klick/Drag, legale Ziele und Engine-Vorschau sind
sichtbar. Bei mehreren Blockern wird die aktuelle Reihenfolge automatisch übernommen; eine
sichtbare Umsortierung und Undo vor dem Absenden fehlen noch.

## B-05 — Paid Mint ist absichtlich aus

**Datei:** `site/shop.js`

`MINT_URL` ist nicht gesetzt. Demo-Packs funktionieren, ein echter LNURL-/Lightning-Zahlungslauf
wurde nicht durchgeführt.

## Nicht verifiziert

- kein öffentliches Deployment, kein TLS-/Reverse-Proxy- und kein Cross-Origin-Test;
- kein Zwei-Geräte-LAN-Test und kein echter NIP-07-Lauf mit zwei Browser-Extensions;
- keine serverseitige Prüfung gespeicherter Invite-/Accept-/Result-Signaturen;
- kein physisches Mobile-/Touch-Gerät; Desktop und Reduced-Motion wurden im echten Browser geprüft;
- keine vollständige visuelle Abnahme aller 295 Karten und jeder möglichen Spielphase;
- keine systematische Accessibility- oder Performance-Messung;
- kein Ranked-Matchmaking, keine Ladder und kein LNURL-Zahlungslauf.

Der ungetrackte Nutzerordner `art/video-intro/` wurde nicht verändert. Sein aktueller Python-WIP
verhindert lediglich, dass ein undifferenzierter Ruff-Root-Scan grün ist; die versionierten
Python-Dateien bestehen Lint und Format vollständig.
