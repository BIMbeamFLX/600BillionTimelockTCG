# Bestätigte Befunde — 2026-08-15

Dieses Dokument enthält nur lokal belegte Befunde. Es ist kein Wunschzettel. Der Reliability-
Slice wurde behoben und getestet; die folgenden Punkte wurden in diesem Durchgang bewusst
nicht implementiert.

## Übersicht

| ID | Schwere | Befund | Ziel betroffen |
| --- | --- | --- | --- |
| B-01 | P1 hoch | Mesh ist gespeichert, aber regeltechnisch wirkungslos | alle Modi |
| B-02 | P1 hoch | Clash-Vorschau dupliziert Engine-Mathematik | garantierte Korrektheit |
| B-03 | P1 hoch | reines nsite kann kein öffentliches Multiplayer liefern | public unranked |
| B-04 | P1 hoch | 126 Karten benötigen weiterhin manuelle Auslegung | Full Set, Ranked |
| B-05 | P1 hoch | Nostr-Events werden serverseitig nicht kryptografisch geprüft | Ranked |
| B-06 | P2 mittel | Angriffs-Puls verwendet eine undefinierte CSS-Variable | Kampf-UX |
| B-07 | P2 mittel | bezahlter Mint ist nicht konfiguriert | Shop |
| B-08 | P2 mittel | aktuelle Dokumente enthalten veraltete Assisted-Zahlen | Handover |
| B-09 | P3 niedrig | Timelock-Weltplatte liest sich violett statt teal | Art Direction |

## B-01 — Mesh hat keine Regelwirkung

**Dateien:** `site/engine.js`, `site/play.js`,
`rules/600B-Timelock-TCG-Rulebook-E1.md`

**Befund:** `DECLARE_ATTACKERS` kann eine `mesh`-Kennung in
`state.clash.meshGroups` schreiben. Außer Initialisierung und Entfernen eines gestorbenen UIDs
gibt es keinen Leser dieses Zustands. Die UI sendet Angreifer zudem als String-UIDs und bietet
keine Gruppenauswahl. Gemeinsames Blocken und das vorgeschriebene Damage Routing finden daher
nicht statt.

**Reproduktion:** Zwei Mesh-Avatare gemeinsam angreifen lassen und nur einen davon blocken.
Nach Regelbuch müsste die Gruppe gemeinsam als geblockt gelten und Routing anbieten; Engine und
UI behandeln die Avatare unabhängig.

## B-02 — Clash-Vorschau kommt nicht aus der Engine

**Dateien:** `site/engine.js`, `site/play.js`, `tests/js/client.test.mjs`

**Befund:** Die Engine berechnet `canonicalAssignment` und `applyCombatDamage` intern, exportiert
aber keinen Vorschauplan. `site/play.js::previewClash` implementiert First Strike, Overflow und
lethal-in-order ein zweites Mal. Der Vergleichstest beweist, dass beide Implementierungen heute
für seine Fixtures übereinstimmen; er macht eine künftige Regeländerung aber nicht strukturell
unmöglich. Die geforderte Garantie „Vorschau stammt aus der Engine“ ist damit noch nicht erfüllt.

**Reproduktion:** Statisch sichtbar, indem die beiden Berechnungspfade verglichen werden. Ein
zukünftiger Fix an nur einem Pfad kann die UI-Vorhersage vom autoritativen Ergebnis trennen.

## B-03 — Öffentliches Multiplayer braucht mehr als ein nsite

**Dateien:** `site/net.js`, `server/table.js`

**Befund:** Unter HTTPS erwartet der Client standardmäßig `wss://<site-host>/ws`. Ein statisches
nsite stellt weder diesen WebSocket noch `/api/*` bereit. Eine getrennte Referee-Origin ist für
den Socket konfigurierbar, aber `/api/tables` sendet keine CORS-Header. Hinter einem TLS-Proxy
reicht auch `PUBLIC_HOST` noch nicht: `publicTableUrl()` veröffentlicht fest
`ws://<PUBLIC_HOST>:<interner-port>/ws`. Der Client bevorzugt diese nicht-loopback Advertise-URL,
was einen Mixed-Content- bzw. Routingfehler erzeugt.

Der aktuelle Adress-Limiter ignoriert Forwarding-Header sicherheitshalber vollständig. Hinter
einem Proxy teilen dadurch alle Spieler dessen eine IP und damit ein Control-Budget. Eine spätere
Proxy-Hop-Konfiguration darf erst nach gesperrtem Direktzugriff auf den Origin aktiviert werden;
sonst könnte ein Client seine Rate-Limit-Identität fälschen.

**Reproduktion:** Statisches nsite ohne Reverse Proxy öffnen und Create/Join ausführen: `/ws` ist
nicht vorhanden. Bei getrennter Origin scheitert die browserseitige Tabellenliste an CORS. Hinter
TLS `PUBLIC_HOST=game.example` setzen und `STATE.table` prüfen: Schema und Port zeigen weiterhin
auf den internen Klartext-Listener.

## B-04 — Der volle Katalog ist nicht vollständig autoritativ gescriptet

**Dateien:** `site/play-data.js`, `site/precons.js`, `tests/js/precons.test.mjs`

**Befund:** Gemessen sind 295 Karten, davon 169 ohne und 126 mit `manual: true`; 144 von 296
Abilities sind manuell markiert. Die 11 ausgelieferten Precons sind vollständig gescriptet und
damit ein guter erster Certified-Pool. „Alle Karten sind im UI vorhanden“ ist nicht dasselbe wie
„jede Karte kann in Ranked ohne menschliche Regelauslegung entschieden werden“.

**Reproduktion:** `site/play-data.js` nach Karten mit `manual: true` filtern; beispielsweise ist
`E1-003 FLX, Culture Curator` betroffen. Ein Full-Set-Deck kann daher eine manuelle Entscheidung
erfordern, ein aktuelles Precon nicht.

## B-05 — Nostr-Identität ist heute ein Claim

**Dateien:** `server/table.js`, `docs/net-protocol.md`, `docs/napplet-spec.md`

**Befund:** Empfangene Nostr-Ereignisse werden mit `sig_checked = 0` gespeichert. Der Sitz-Token
schützt den Live-Reconnect, aber der Referee prüft keine Schnorr-Signatur und kann den npub daher
nicht selbst kryptografisch bestätigen. Das ist für LAN/Unranked eine dokumentierte Grenze,
aber ein Ranked-Blocker.

**Reproduktion:** Ein Invite-/Result-Event einreichen und die Zeile in `nostr_events` prüfen;
`sig_checked` bleibt 0.

## B-06 — Attack-Glow referenziert `--ember`, das lokal nicht existiert

**Datei:** `site/play.html`

**Befund:** `canattackPulse` benutzt `var(--ember)`. Der lokale `:root`-Block definiert
`--orange`, aber kein `--ember`; `play.html` lädt das zentrale `600b.css` nicht. Dadurch ist der
orange Box-Shadow dieser Keyframes ungültig bzw. unvollständig, obwohl andere Teile der Animation
weiterlaufen können.

**Reproduktion:** Angreifer-Deklaration erreichen, einen legalen Angreifer inspizieren und in den
Computed Styles die ungültige `box-shadow`-Deklaration der Animation prüfen.

## B-07 — Paid Mint ist absichtlich noch aus

**Datei:** `site/shop.js`

**Befund:** `MINT_URL` ist `null`. Demo-Packs funktionieren; `?shop=mint` meldet, dass Minting
nicht live ist. Für den bezahlten Pfad fehlen Ziel-URL und ein echter LNURL-End-to-end-Test.

**Reproduktion:** `shop.html?shop=mint` öffnen und einen Pack-Pull starten.

## B-08 — Dokumentation ist teilweise überholt

**Dateien:** `README.md`, `docs/delivery-plan.md`, `docs/multiplayer-architecture.md`,
`docs/napplet-spec.md`

**Befund:** Mehrere Texte nennen noch 204 assisted Karten oder ältere Testzahlen. Der aktuelle
Messwert ist 126 manuelle Karten; die aktuellen Gates sind 129 JS plus 104 Python. Das alte
`docs/handoff.md` bleibt absichtlich historisch, die anderen aktiven Dokumente sollten in einem
eigenen Docs-Slice konsolidiert werden.

**Reproduktion:** Nach `204 of 295`, `204 assisted` und alten Testzahlen suchen und mit
`site/play-data.js` bzw. den aktuellen Testläufen vergleichen.

## B-09 — Timelock-Weltplatte verfehlt den eigenen Farbkanal

**Datei:** `art/world-plates/timelock.png`

**Befund:** Die Platte wird visuell von Violett/Orange dominiert, während der Timelock-Kanal im
Spiel teal codiert ist. Das ist kein Funktionsfehler, schwächt aber die schnelle Affinitätslesung.

**Reproduktion:** Weltplatte neben Timelock-Chrome und Ressourcen-Icon betrachten.

## Nicht verifiziert

- kein Deployment auf eine öffentliche Domain, kein TLS-/Reverse-Proxy-Test und kein CORS-Test
  gegen zwei echte Origins;
- kein Zwei-Geräte-Test im realen LAN oder über Tailscale;
- kein echter NIP-07-Login mit zwei Extensions und keine Relay-Publikation;
- kein LNURL-/Lightning-Zahlungslauf;
- keine vollständige visuelle Abnahme aller Spielphasen, Viewports und mobilen Touch-Gesten;
- keine systematische Accessibility- oder Performance-Messung;
- kein Ranked-Matchmaking, keine Ladder und keine kryptografisch geprüften Ergebnisse.

Verifiziert wurden dagegen ein echter Zwei-Tab-Create/Join-Pfad im Browser, ein vollständiges
headless Zwei-Client-Match gegen einen separaten Prozess sowie alle automatisierten Gates.

## Entscheidungen, die vor den jeweiligen Slices gebraucht werden

1. Welche Domain bzw. welcher erreichbare LAN-Hostname soll der erste Same-Origin-Referee haben?
2. Soll Public Unranked Gäste neben NIP-07 zulassen? Empfehlung: ja, mit sichtbarem
   „Guest/Unverified“-Status; Ranked später nur mit verifizierter Identität.
3. Soll Unranked alle 295 Karten mit sichtbarem Manual-Hinweis erlauben? Empfehlung: ja;
   Ranked zunächst nur die vollständig gescripteten Precons bzw. einen Certified-Kartenpool.
4. Wohin sollen alte JPEGs und Generator-Zwischenstände archiviert werden, bevor sie aus dem
   aktiven Tree verschwinden: GitHub Release, separates Archiv-Repo oder externer Storage?
