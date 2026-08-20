# Repository instructions

- Configure early access with `NUTFT_SALES=allowlist` and the comma-separated `NUTFT_ALLOWLIST` environment variable. Never hardcode buyer pubkeys.
- Check the allowlist only before issuance: when creating a paid invoice, or at claim time for a free mint. Never identify or re-check a paid claim or a NutFT transfer.
- Production NutFT issuance stays on the first-party mint. Do not substitute a generic public Cashu mint for the NutFT issuer.

