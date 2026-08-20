# Art

All files in this directory are website assets or derived 600B artwork.

## Rules

- Preserve source assets; create a new derived file for every edit.
- Every visible character must exist on `join.600.wtf`.
- Use official character references for identity, clothing, silhouette and props.
  join.600.wtf publishes each character twice and the two are not interchangeable:
  the **Detailed ·front** study (`references/join-detailed-front/`) is what E1 card
  artwork is drawn from, and the **homepage** image (`references/join-homepage/`) is
  the face the character wears on the site — square, and the one to use wherever an
  avatar is shown rather than a card. `scripts/sync_join_references.py --variant`
  mirrors either, read-only and checksummed.
- Do not add generic background people.
- Keep orange and black dominant; violet is the protocol accent.
- Resource icons must remain optically centered and readable at 20 px.
- Generated illustrations contain no card text, logos or frames.

## Folders

- `brand/` — official logo and identity assets.
- `cards/` — rendered card previews and contact sheets.
- `fonts/` — bundled open-source display fonts.
- `resources/` — canonical Resource icons.
- `rulebook/` — wide, low-text banners used between rule chapters.
