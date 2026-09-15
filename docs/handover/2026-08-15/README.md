# Handover 2026-08-15

This folder describes the currently verified state on
`feature/remote-reliability`. It does not replace the historical
[`docs/handoff.md`](../../handoff.md) from 2 August.

- [HANDOVER.md](HANDOVER.md) — architecture, capabilities, evidence and vertical slice plan
- [BUGS.md](BUGS.md) — only confirmed remaining issues and areas that were deliberately not checked

## Quick start

```powershell
npm install
npm run table
```

The website, HTTP API and WebSocket referee run together at
<http://localhost:8777>. Local hotseat/NPC play works without a browser extension.
Every online seat requires NIP-07; the referee requests a fresh, signed NIP-42 proof
for each connection.

For a LAN test, `PUBLIC_HOST` must point to a hostname or an IP that the second device
can reach:

```powershell
$env:PUBLIC_HOST = "192.168.1.50"
npm run table
```

This is not yet a public deployment. For HTTPS/Public Unranked, the version-controlled
reverse proxy configuration and an external `wss://` advertised URL are still missing.
