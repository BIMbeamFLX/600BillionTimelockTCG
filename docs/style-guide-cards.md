# Edition One Card Text Style Guide

This guide records the wording conventions already used by the E1 rules contract. It
governs card copy and reminder text; the rulebook remains authoritative when the two
conflict.

## Voice

- Teach one accurate Bitcoin, Nostr or cypherpunk idea per card through its Protocol Note.
- Keep flavor free-form, warm and lightly funny. Do not append a rotating slogan.
- Avoid investment language, price predictions and advice.
- Write rules literally. Flavor and Protocol Notes never change gameplay.

## Numbers

- Use digits for damage, Uptime, Resource amounts, costs, counters and stat changes:
  `deal 3 damage`, `gain 2 Uptime`, `generate 1 Signal`, `gets +1/+1`.
- Spell out card counts in prose: `draw two cards`, `discard a card`.
- Use `X` for a chosen variable and `*` for a stat defined by the card's ability.

## Capitalization

- Capitalize zones and rules-facing values: Stack, Wallet, Network, Archive, Cold Storage,
  Queue, Buffer, Uptime, Action and Resilience.
- Capitalize card types, affinities, steps, phases and named keywords.
- Keep action verbs lowercase in running text: commit, unlock, archive and decommission.
- Capitalize `Commit` when it begins an ability cost: `Commit: generate 1 Power.`

## Durations

- Use `until end of turn` for stat or ability changes:
  `Target Avatar gets +2 Action until end of turn.`
- Use `this turn` for permissions, restrictions, prevention shields and action history:
  `Target Avatar can't block this turn.`
- State longer or unusual durations explicitly.

## Ability costs and qualifiers

- Put costs before a colon and the effect after it: `<cost>: <effect>`.
- Separate simultaneous costs with commas: `2, Commit: draw a card.`
- A timing or module qualifier may use an em dash next to the part it qualifies:
  `X, Commit — Maintenance: refill X markers.`
- A module qualifier may precede the cost:
  `Toss module — Commit: perform the Toss instruction.`
- A qualifier limits when or where the ability is available; it is not an extra Resource
  cost unless the text explicitly says so.

## Triggers and static text

- Triggered abilities begin with `When`, `Whenever` or `At`.
- Activated abilities contain a colon separating cost from effect.
- Replacement effects use `If ... would ..., instead ...`.
- Static abilities state a continuously true rule without a trigger or cost.

## Keyword reminders

Use one reminder per keyword. Granted effects may replace `This Avatar` with
`that Avatar`, `attached Avatar` or a grammatically matching plural.

| Keyword | Canonical self-reminder |
| --- | --- |
| Broadcast | `(This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)` |
| Firewall | `(This Avatar can't attack.)` |
| Backchannel — X | `(This Avatar can't be blocked while the defending player controls an X Resource.)` |
| Shielded from X | `(It can't be targeted, attached, blocked or dealt damage by X sources.)` |
| Reboot | `(The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)` |

Reminder text explains a rule; it does not create an additional ability.
