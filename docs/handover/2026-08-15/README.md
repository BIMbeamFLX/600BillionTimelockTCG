# Handover 2026-08-15

Dieses Verzeichnis beschreibt den tatsächlich geprüften Stand nach PR #10 und dem
Reliability-Slice auf `feature/remote-reliability`.

- [HANDOVER.md](HANDOVER.md) — Start, Architektur, Testnachweise und Vertical-Slice-Plan
- [BUGS.md](BUGS.md) — bestätigte Befunde, Reproduktion und bewusst nicht geprüfte Bereiche

## Schnellstart

```powershell
npm install
npm run table
```

Danach läuft Website und Referee gemeinsam unter <http://localhost:8777>. Für ein LAN
`PUBLIC_HOST` auf den von anderen Geräten erreichbaren Hostnamen oder die IP setzen — ohne
Schema und ohne Port:

```powershell
$env:PUBLIC_HOST = "192.168.1.50"
npm run table
```

Der zu Beginn vorhandene Prozess auf Port 8777 wurde nicht von diesem Durchgang beendet, war
beim finalen Betriebscheck aber nicht mehr aktiv. Deshalb wurde der geprüfte Branch-Stand dort
neu gestartet: `/api/health` ist grün, 10 vorhandene Matches wurden aus SQLite wiederhergestellt
und es gibt keine offenen Tische. Die isolierte QA-Instanz auf Port 8778 ist beendet.

Das alte [`docs/handoff.md`](../../handoff.md) bleibt als historischer Stand vom 2. August
unverändert und wird durch dieses Verzeichnis nicht rückwirkend korrigiert.
