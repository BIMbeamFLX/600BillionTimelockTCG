# Handover 2026-08-15

Dieser Ordner beschreibt den aktuell geprüften Stand auf
`feature/remote-reliability`. Er ersetzt nicht das historische
[`docs/handoff.md`](../../handoff.md) vom 2. August.

- [HANDOVER.md](HANDOVER.md) — Architektur, Fähigkeiten, Nachweise und Vertical-Slice-Plan
- [BUGS.md](BUGS.md) — nur bestätigte Restpunkte und bewusst nicht geprüfte Bereiche

## Schnellstart

```powershell
npm install
npm run table
```

Website, HTTP-API und WebSocket-Referee laufen gemeinsam unter
<http://localhost:8777>. Lokales Hotseat/NPC-Spiel funktioniert ohne Browser-Erweiterung.
Jeder Online-Sitz benötigt NIP-07; der Referee fordert pro Verbindung einen frischen,
signierten NIP-42-Nachweis an.

Für einen LAN-Test muss `PUBLIC_HOST` auf einen vom zweiten Gerät erreichbaren Hostnamen
oder eine IP zeigen:

```powershell
$env:PUBLIC_HOST = "192.168.1.50"
npm run table
```

Das ist noch kein öffentliches Deployment. Für HTTPS/Public Unranked fehlen weiterhin die
versionierte Reverse-Proxy-Konfiguration und eine externe `wss://`-Advertise-URL.
