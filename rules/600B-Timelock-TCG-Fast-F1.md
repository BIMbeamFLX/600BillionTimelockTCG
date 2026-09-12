# 600B Timelock TCG — Fast Rules (F1.0)

Fast is the second rules profile of Edition One: the same 295 cards, names and art,
with the turn of a modern digital card game. Classic (E1.0,
`600B-Timelock-TCG-Rulebook-E1.md`) stays exactly as it is.

## A turn

1. **Unlock.** Your committed Avatars and Hardware unlock. Your **pool** grows by 1
   (up to 10) and refills: you have that many Resources to spend this turn.
2. **Maintenance** and **Draw** happen by themselves. Draw a card.
3. **Build.** The only time anyone acts. In any order, as often as you can pay:
   - play a card from your Wallet;
   - use an ability;
   - attack with a ready Avatar.
4. **End turn.** End-of-turn effects happen, you discard down to 7, damage wears off.

Only the player whose turn it is ever acts. Nobody passes back and forth, and nobody
responds: a card or ability resolves the moment it is played, and so do the triggers
it causes, in the order they were raised.

## Resources

- There are no Resource cards to play and nothing to tap. The pool does it.
- Every cost is a plain number. The symbol on a card shows its class, not a colour
  you must pay with: `2S` costs 3.
- Resources you did not spend are gone at your next refill. They do not hurt you.
- The player going second gets **one extra Resource on each of their first two turns**.
- Some cards generate Resources (the Power Plants, the Junctions). That is ramp: the
  Resources are yours for the rest of the turn.

## Attacking

Pick one of your ready Avatars and a target: **the opponent**, or **one of the
opponent's Avatars**. Damage is exchanged at once. There is no blocking.

- An Avatar that attacks is committed until your next Unlock.
- An Avatar cannot attack the turn it arrives (Boot Delay).
- Damage to an Avatar stays until the end of the turn; Resilience that reaches 0
  decommissions it.

## Keywords

| Keyword | In Fast |
| --- | --- |
| **Firewall** | Attacks must target a Firewall first. A Firewall may attack. |
| **Broadcast** | Ignores Firewall. |
| **First Strike** | Hits first; a target it destroys does not hit back. |
| **Overflow** | Damage beyond what destroys the target hits the opponent. |
| **Reboot** | The next time this would be decommissioned, it is not. |
| **Boot Delay** | Cannot attack the turn it arrives. |

Mesh, Backchannel, Broadcast Guard and Shielded from do not exist in Fast. Cards
that printed them have been redesigned (`cards/e1-fast.json`).

## Stacks

A Fast Stack is at least 40 cards, at most 4 copies of a card. The quick-play Stack
for a class is 20 Avatars, 12 Zaps and Operations and 8 Hardware and Protocols.

## Winning

Reduce the opponent's Uptime from 20 to 0. A player who must draw from an empty
Stack loses.

## How the numbers were set

Pool cap, the second player's bonus and every card's Fast values were measured, not
guessed: `node scripts/sim.mjs --games 30` plays every class pairing both ways, bot
against bot. From 300 games per profile:

| | Classic | Fast |
| --- | --- | --- |
| Actions per turn | 31.4 | 7.3 |
| Turns per game (median) | 10 | 8 |
| First player wins | 58.4% | 56.3% |
| Class win rates | 33.9% – 65.8% | 47.5% – 51.7% |
| Games without a verdict | 2 of 300 | 0 of 300 |

The card values come from `scripts/design_fast_cards.py`. It takes each Classic
card and applies these rules:

- **Budget.** An Avatar has Action + Resilience = 2 × cost + 1, less one per
  ability.
- **Dead lines.** Lines about rules Fast does not have are removed.
- **Class kits.** A card left without text gets an effect from its class:
  - Power: damage;
  - Bitcoin: growth and cards;
  - Keys: removal;
  - Signal: bounce;
  - Timelock: digging.
- **Resource cards.** They become ramp Hardware.
