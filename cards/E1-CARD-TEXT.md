# 600B Timelock TCG — Edition One Complete Card Text

Text version: `E1.0-text-lock-r1`
Cards: **295**
Status: **TEXT + FLAVOR LOCKED**

Only rules and short italic flavor appear on the card face. Simple Guides,
Protocol Notes, sources and art prompts remain digital game metadata.

## Neutral / Multi-affinity

### E1-001 · Genesis Lotus

**Hardware** · Cost **0** · Rare


Commit and archive Genesis Lotus: generate 3 Resources of one affinity.

**Flavor:** *The manual had three pages, and Genesis Lotus used all of them as coasters.*

**Simple Guide · metadata:** Moves a card into an Archive. Generates extra Resources for larger plays.

**Protocol Note · metadata:** The Bitcoin whitepaper describes peer-to-peer electronic cash without a trusted third party.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “Commit and archive Genesis Lotus: generate three Resources of one affinity” without characters.

---

## Bitcoin

### E1-002 · Satoshi Orchard

**Basic Resource — Bitcoin** · Cost **—** · Common


Commit: generate 1 Bitcoin.

**Flavor:** *Useful capacity grows wherever Satoshi Orchard gets a clean connection.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Bitcoin.

**Protocol Note · metadata:** A UTXO is an unspent transaction output available to a later input.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin” without characters.

---

## Signal

### E1-003 · FLX, Culture Curator

**Avatar — Operator** · Cost **3SS** · Uncommon · **4/4**

**Character:** FLX

Broadcast<br>
FLX stays unlocked after attacking.

**Flavor:** *The status page calmed down as soon as Culture Curator picked up a wrench.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Lets a committed card become usable again.

**Protocol Note · metadata:** NIP-01 events carry an id, pubkey, timestamp, kind, tags, content and signature.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** FLX turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Power

### E1-004 · Zap

**Zap** · Cost **P** · Common


Zap deals 2 damage to any target.

**Flavor:** *Latency rehearsed an excuse, but Zap had already resolved.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin proof of work searches for a block-header hash below a target.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Zap deals 3 damage to any target” without characters.

---

## Timelock

### E1-005 · Next Block

**Operation** · Cost **1T** · Rare


After this turn, take one additional turn.

**Flavor:** *The plan left the whiteboard and returned wearing Next Block.*

**Simple Guide · metadata:** Gives you another full turn after this one.

**Protocol Note · metadata:** BIP-65 makes CHECKLOCKTIMEVERIFY enforce an absolute locktime.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A coordinated network-wide event visualizes “After this turn, take one additional turn” without characters.

---

## Keys

### E1-006 · Multisig Quorum

**Protocol** · Cost **1K** · Rare


Keys Avatars get +1 Action and +1 Resilience.

**Flavor:** *The fine print became infrastructure when Multisig Quorum entered the Network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-32 extended keys combine key material with a 32-byte chain code.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Keys Avatars get +1 Action and +1 Resilience” without characters.

---

## Signal

### E1-007 · Firmware for Firewalls

**Protocol — Attachment** · Cost **S** · Rare


Attach to Firewall<br>
Attached Firewall can attack as though it didn't have Firewall.

**Flavor:** *Every rule has an edge case; Firmware for Firewalls packed it a lunch.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-01 events carry an id, pubkey, timestamp, kind, tags, content and signature.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Firewall” without characters.

---

### E1-008 · Grid Reset

**Operation** · Cost **3S** · Rare


Decommission all Resources.

**Flavor:** *Every checklist box stood a little straighter for Grid Reset.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** NIP-01 hashes a canonical event serialization to produce its event id.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A coordinated network-wide event visualizes “Decommission all Resources” without characters.

---

### E1-009 · Fair State

**Operation** · Cost **1S** · Rare


Each player chooses a number of Resources they control equal to the number of Resources controlled by the player who controls the fewest, then archives the rest. Players discard cards and archive Avatars the same way.

**Flavor:** *The long route became the useful route after Fair State.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** NIP-01 hashes a canonical event serialization to produce its event id.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A coordinated network-wide event visualizes “Each player chooses a number of Resources they control equal to the number of Resources controlled by the player who controls the fewest, then archives the rest. Players discard cards and archive Avatars the same way” without characters.

---

### E1-010 · Cuddy, Signal Organizer

**Avatar — Operator** · Cost **S** · Common · **1/1**

**Character:** Cuddy

Mesh.

**Flavor:** *Nobody assigned the incident; it simply looked nervous around Signal Organizer.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** NIP-01 signs an event id so clients can verify the publisher.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** Cuddy turns “Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-011 · Keys Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Keys. This effect doesn't remove this Attachment.

**Flavor:** *The whiteboard stopped arguing after Keys Shield drew the final arrow.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** NIP-01 signs an event id so clients can verify the publisher.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-012 · Last Broadcast

**Zap** · Cost **S** · Rare


Play this card on the Queue only during clash before blockers are declared.<br>
Target Avatar defending player controls can block any number of Avatars this turn. It blocks each attacking Avatar this turn if able.

**Flavor:** *The Queue blinked once and found Last Broadcast at the front.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** A NIP-01 REQ message opens a filtered relay subscription.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during clash before blockers are declared” without characters.

---

### E1-013 · Shared Uptime

**Protocol — Attachment** · Cost **SS** · Rare


Attach to Avatar<br>
S: attached Avatar gets +1 Action and +1 Resilience until end of turn.

**Flavor:** *A handshake became a habit wherever Shared Uptime was deployed.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** A NIP-01 REQ message opens a filtered relay subscription.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-014 · Timelock Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Timelock. This effect doesn't remove this Attachment.

**Flavor:** *No committee survived contact with the clarity of Timelock Shield.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** A NIP-01 CLOSE message ends a relay subscription.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-015 · Local Citadel

**Protocol** · Cost **3S** · Uncommon


At the beginning of your Maintenance, you may pay 1. If you do, draw a card.

**Flavor:** *The Network called it policy; Local Citadel called it Tuesday.*

**Simple Guide · metadata:** A standing relay: on each of your Maintenances you may pay 1 for an extra card. It does nothing the turn it lands, so play it when the game is going long.

**Protocol Note · metadata:** A NIP-01 CLOSE message ends a relay subscription.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Unlocked Avatars you control get +0 Action and +2 Resilience” without characters.

---

### E1-016 · Timelock Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Timelock source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *One tidy invariant followed Timelock Protection Circuit into every messy room.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-01 EOSE tells a client that stored events for a subscription were sent.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Timelock source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-017 · Bitcoin Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Bitcoin source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *The loophole closed itself after reading Bitcoin Protection Circuit.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-01 EOSE tells a client that stored events for a subscription were sent.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Bitcoin source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-018 · Power Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Power source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *A thousand opinions became one testable rule inside Power Protection Circuit.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-01 uses kind 0 for replaceable user metadata.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Power source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-019 · Signal Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Signal source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *The boring path became the reliable path under Signal Protection Circuit.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-01 uses kind 0 for replaceable user metadata.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Signal source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-020 · Hardened Resource

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Resource<br>
Attached Resource has indestructible and can't be attached by other Attachments.

**Flavor:** *Everyone brought assumptions, but Hardened Resource brought a specification.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-01 uses kind 1 for short text notes.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-021 · Grid Conversion

**Protocol** · Cost **2SS** · Uncommon


At the beginning of your Maintenance, archive this Protocol unless you pay SS.<br>
All Power Resources are Signal Resource.

**Flavor:** *The exception asked for permission before approaching Grid Conversion.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** NIP-01 uses kind 1 for short text notes.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of your Maintenance, archive this Protocol unless you pay SS” without characters.

---

### E1-022 · Public Goods Drive

**Protocol** · Cost **SS** · Rare


Signal Avatars get +1 Action and +1 Resilience.

**Flavor:** *A sticky note achieved consensus and grew into Public Goods Drive.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-02 stores a follow list in a signed kind 3 event.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/02.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Signal Avatars get +1 Action and +1 Resilience” without characters.

---

### E1-023 · Emergency Reboot

**Zap** · Cost **S** · Common


Reboot target Avatar.<br>
Draw a card.

**Flavor:** *A tiny packet made a very large entrance as Emergency Reboot.*

**Simple Guide · metadata:** Reboot keeps a damaged Avatar in a clash it would otherwise lose, and the card replaces itself straight away.

**Protocol Note · metadata:** NIP-02 stores a follow list in a signed kind 3 event.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/02.md

**Art direction:** A precise burst of network action visualizes “Reboot target Avatar” without characters.

---

### E1-024 · Protocol Cleanup

**Zap** · Cost **1S** · Common


Decommission target Hardware or Protocol.

**Flavor:** *The response window was brief and exactly long enough for Protocol Cleanup.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** NIP-05 resolves an internet identifier through .well-known/nostr.json.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** A precise burst of network action visualizes “Decommission target Hardware or Protocol” without characters.

---

### E1-025 · Home Miner

**Protocol — Attachment** · Cost **SSS** · Rare


Attach to Resource<br>
Attached Resource has "At the beginning of your Maintenance, you may pay SS. If you do, you gain 1 Uptime."

**Flavor:** *Nothing says romance like deterministic behavior from Home Miner.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-05 resolves an internet identifier through .well-known/nostr.json.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-026 · Bitcoin Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Bitcoin. This effect doesn't remove this Attachment.

**Flavor:** *The meeting ended early because Bitcoin Shield had executable minutes.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** NIP-09 uses a signed kind 5 event to request deletion of earlier events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/09.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-027 · Guardian Signal

**Zap** · Cost **XS** · Common


Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay 1 any time you could play an Zap. If you do, prevent the next 1 damage that would be dealt to that Network card or player this turn.

**Flavor:** *No one heard the starter pistol; they only saw Guardian Signal.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-09 uses a signed kind 5 event to request deletion of earlier events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/09.md

**Art direction:** A precise burst of network action visualizes “Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay 1 any time you could play an Zap. If you do, prevent the next 1 damage that would be dealt to that Network card or player this turn” without characters.

---

### E1-028 · Repair Packet

**Zap** · Cost **S** · Common


Choose one —<br>
• Target player gains 3 Uptime.<br>
• Draw a card.

**Flavor:** *The bug requested more time, which Repair Packet politely denied.*

**Simple Guide · metadata:** Choose one: heal 3 Uptime, or draw a card. You pick the mode when you play it, so it is never a dead card.

**Protocol Note · metadata:** NIP-10 uses event and pubkey tags to describe note threads.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/10.md

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-029 · Hardened Identity

**Protocol — Attachment** · Cost **S** · Common


Attach to Avatar<br>
Attached Avatar gets +0 Action and +2 Resilience.<br>
S: attached Avatar gets +0 Action and +1 Resilience until end of turn.

**Flavor:** *The Network slept better once Hardened Identity checked the locks.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** NIP-10 uses event and pubkey tags to describe note threads.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/10.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-030 · Community Strength

**Protocol — Attachment** · Cost **S** · Common


Attach to Avatar<br>
Attached Avatar gets +1 Action and +2 Resilience.

**Flavor:** *The fine print became infrastructure when Community Strength entered the Network.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** NIP-11 lets a relay publish an informational JSON document over HTTP.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/11.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-031 · Offline Sanctuary

**Protocol** · Cost **1S** · Rare


If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by Avatars with Broadcast and/or Backchannel—Timelock.

**Flavor:** *Every rule has an edge case; Offline Sanctuary packed it a lunch.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** NIP-11 lets a relay publish an informational JSON document over HTTP.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/11.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by Avatars with Broadcast and/or Backchannel—Timelock” without characters.

---

### E1-032 · Consequence Ledger

**Protocol** · Cost **2SS** · Uncommon


At the beginning of each player's Maintenance, this Protocol deals damage to that player equal to the number of Keys Resources they control.

**Flavor:** *The whiteboard stopped arguing after Consequence Ledger drew the final arrow.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-13 places a nonce and target difficulty in an event tag for proof of work.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/13.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of each player's Maintenance, this Protocol deals damage to that player equal to the number of Keys Resources they control” without characters.

---

### E1-033 · Fast Path

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has First Strike.

**Flavor:** *A handshake became a habit wherever Fast Path was deployed.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-13 places a nonce and target difficulty in an event tag for proof of work.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/13.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-034 · Sat, Relay Rider

**Avatar — Broadcaster** · Cost **1S** · Common · **1/1**

**Character:** Sat

Broadcast; Mesh.

**Flavor:** *A second opinion arrived wearing Relay Rider's tool belt.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** NIP-19 gives Nostr keys and event references bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** Sat turns “Broadcast; Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-035 · MHB, Keys Auditor

**Avatar — Signer** · Cost **2SS** · Rare · **3/3**

**Character:** MHB

SS, Commit: decommission target Keys Network card.

**Flavor:** *The runbook says stay calm, and Keys Auditor added label your cables.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** NIP-19 gives Nostr keys and event references bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** MHB turns “SS, Commit: decommission target Keys Network card” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-036 · Morgs, Friendly Fork

**Avatar — Operator** · Cost **2S** · Common · **2/2**

**Character:** Morgs

No special ability.

**Flavor:** *Even the fallback plan has a fallback when Friendly Fork joins the call.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** NIP-21 defines the nostr: URI scheme for NIP-19 identifiers.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/21.md

**Art direction:** Morgs turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-037 · AJ, Uptime Anchor

**Avatar — Operator** · Cost **3SSS** · Rare · **6/6**

**Character:** AJ

0: The next 1 damage that would be dealt to this Avatar this turn is dealt to its owner instead. Only this Avatar's owner may activate this ability.<br>
When this Avatar is decommissioned, its owner loses half their Uptime, rounded up.

**Flavor:** *The Network asked for a hero; Uptime Anchor submitted a tested patch.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** NIP-21 defines the nostr: URI scheme for NIP-19 identifiers.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/21.md

**Art direction:** AJ turns “0: The next 1 damage that would be dealt to this Avatar this turn is dealt to its owner instead. Only this Avatar's owner may activate this ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-038 · Signal Rewrite

**Zap** · Cost **S** · Rare


Target card on the Queue or Network card becomes Signal. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *One clean interrupt later, the logs credited Signal Rewrite.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** NIP-25 represents reactions as signed kind 7 events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Signal. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-039 · Power Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Power. This effect doesn't remove this Attachment.

**Flavor:** *No committee survived contact with the clarity of Power Shield.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** NIP-25 represents reactions as signed kind 7 events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-040 · Archive Restore

**Operation** · Cost **2SS** · Uncommon


Return target Avatar card from your Archive to the Network.

**Flavor:** *A coordinated morning begins with coffee and Archive Restore.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** NIP-42 authenticates a client by signing a relay-provided challenge.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/42.md

**Art direction:** A coordinated network-wide event visualizes “Return target Avatar card from your Archive to the Network” without characters.

---

### E1-041 · Damage Refund

**Zap** · Cost **1SS** · Rare


The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain Uptime equal to the damage prevented this way.

**Flavor:** *The fast path keeps a reserved seat for Damage Refund.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-42 authenticates a client by signing a relay-provided challenge.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/42.md

**Art direction:** A precise burst of network action visualizes “The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain Uptime equal to the damage prevented this way” without characters.

---

### E1-042 · Courage Under Load

**Zap** · Cost **S** · Rare


Target blocking Avatar gets +7 Action and +7 Resilience until end of turn.

**Flavor:** *The packet wore sensible shoes because it was carrying Courage Under Load.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** NIP-44 defines a versioned encrypted-payload format.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/44.md

**Art direction:** A precise burst of network action visualizes “Target blocking Avatar gets +7 Action and +7 Resilience until end of turn” without characters.

---

### E1-043 · AJ, First Responder

**Avatar — Operator** · Cost **1S** · Common · **1/1**

**Character:** AJ

Commit: Prevent the next 1 damage that would be dealt to any target this turn.

**Flavor:** *Every antenna found its horizon when First Responder climbed the roof.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-44 defines a versioned encrypted-payload format.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/44.md

**Art direction:** AJ turns “Commit: Prevent the next 1 damage that would be dealt to any target this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-044 · Cuddy, Fast Starter

**Avatar — Operator** · Cost **S** · Rare · **2/1**

**Character:** Cuddy

No special ability.

**Flavor:** *The coffee went cold, but the relay stayed warm for Fast Starter.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** NIP-46 lets a client request signing from a remote Nostr signer.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/46.md

**Art direction:** Cuddy turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-045 · Peaceful Exit

**Zap** · Cost **S** · Uncommon


Cold Storage target Avatar. Its controller gains Uptime equal to its Action.

**Flavor:** *A deadline became a punchline the moment Peaceful Exit landed.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** NIP-46 lets a client request signing from a remote Nostr signer.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/46.md

**Art direction:** A precise burst of network action visualizes “Cold Storage target Avatar. Its controller gains Uptime equal to its Action” without characters.

---

### E1-046 · MHB, Community Shield

**Avatar — Guardian** · Cost **3SS** · Rare · **2/5**

**Character:** MHB

As long as this Avatar is unlocked, all damage that would be dealt to you by unblocked Avatars is dealt to this Avatar instead.

**Flavor:** *The Queue behaved all afternoon under Community Shield's suspiciously polite stare.*

**Simple Guide · metadata:** Deals or redirects damage. Lets a committed card become usable again.

**Protocol Note · metadata:** NIP-47 carries wallet requests and responses through Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/47.md

**Art direction:** MHB turns “As long as this Avatar is unlocked, all damage that would be dealt to you by unblocked Avatars is dealt to this Avatar instead” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-047 · Sat, Blade Firewall

**Avatar — Firewall** · Cost **3S** · Uncommon · **3/5**

**Character:** Sat

Firewall (This Avatar can't attack.)<br>
Broadcast

**Flavor:** *Someone said impossible; Blade Firewall heard needs one more adapter.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** NIP-47 carries wallet requests and responses through Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/47.md

**Art direction:** Sat turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-048 · Morgs, Signal Knight

**Avatar — Guardian** · Cost **SS** · Uncommon · **2/2**

**Character:** Morgs

First Strike (This Avatar deals clash damage before Avatars without First Strike.)<br>
Shielded from Keys (It can't be targeted, attached, blocked or dealt damage by Keys sources.)

**Flavor:** *The outage brought drama, while Signal Knight brought a multimeter.*

**Simple Guide · metadata:** Deals or redirects damage. Resists the named affinity.

**Protocol Note · metadata:** NIP-50 adds a search field to relay filters that choose to support it.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/50.md

**Art direction:** Morgs turns “First Strike (This Avatar deals clash damage before Avatars without First Strike.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-049 · Signal Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Signal. This effect doesn't remove this Attachment.

**Flavor:** *The Network called it policy; Signal Shield called it Tuesday.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** NIP-50 adds a search field to relay filters that choose to support it.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/50.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-050 · Clean Slate

**Operation** · Cost **2SS** · Rare


Decommission all Avatars. They can't be Rebooted.

**Flavor:** *The Network moved as one, mostly because Clean Slate brought labels.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** NIP-57 defines signed zap receipts as kind 9735 events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** A coordinated network-wide event visualizes “Decommission all Avatars. They can't be Rebooted” without characters.

---

## Timelock

### E1-051 · Michael1011, Packet Shaper

**Avatar — Operator** · Cost **3TT** · Uncommon · **4/4**

**Character:** Michael1011

Broadcast

**Flavor:** *Trust arrived late, so Packet Shaper verified without it.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BIP-65 makes CHECKLOCKTIMEVERIFY enforce an absolute locktime.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** Michael1011 turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-052 · First Memory

**Zap** · Cost **T** · Rare


Target player moves the top three cards of their Stack into their Wallet.

**Flavor:** *The Network said now, and First Memory did not ask which timezone.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BIP-112 makes CHECKSEQUENCEVERIFY enforce relative locktime.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** A precise burst of network action visualizes “Target player moves the top three cards of their Stack into their Wallet” without characters.

---

### E1-053 · Boot Hardware

**Protocol — Attachment** · Cost **3T** · Uncommon


Attach to Hardware<br>
As long as attached Hardware isn't an Avatar, it's an Hardware Avatar with Action and Resilience each equal to its total resource cost.

**Flavor:** *One tidy invariant followed Boot Hardware into every messy room.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-112 makes CHECKSEQUENCEVERIFY enforce relative locktime.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-054 · Power Invalidation

**Zap** · Cost **T** · Common


Choose one —<br>
• marker target Power card on the Queue.<br>
• decommission target Power Network card.

**Flavor:** *Every millisecond filed paperwork after meeting Power Invalidation.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-113 evaluates transaction locktime against median past time.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-055 · Query Burst

**Operation** · Cost **XTT** · Rare


Target player moves the top X cards of their Stack into their Wallet.

**Flavor:** *Tomorrow arrived early carrying the paperwork for Query Burst.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-113 evaluates transaction locktime against median past time.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Target player moves the top X cards of their Stack into their Wallet” without characters.

---

### E1-056 · Benarc, Mirror Client

**Avatar — Client** · Cost **3T** · Uncommon · **0/0**

**Character:** Benarc

You may have this Avatar enter as a copy of any Avatar on the Network.

**Flavor:** *The dashboard blinked red until it met Mirror Client.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-68 encodes relative locktime semantics in transaction sequence numbers.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki

**Art direction:** Benarc turns “You may have this Avatar enter as a copy of any Avatar on the Network” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-057 · Remote Control

**Protocol — Attachment** · Cost **2TT** · Uncommon


Attach to Avatar<br>
You control attached Avatar.

**Flavor:** *The loophole closed itself after reading Remote Control.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-68 encodes relative locktime semantics in transaction sequence numbers.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-058 · Hardware Clone

**Protocol** · Cost **1T** · Rare


You may have this Protocol enter as a copy of any Hardware on the Network, except it's a Protocol in addition to its other types.

**Flavor:** *A thousand opinions became one testable rule inside Hardware Clone.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BOLT 2 defines the messages peers use to manage Lightning channels.
**Primary source:** https://github.com/lightning/bolts/blob/master/02-peer-protocol.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “You may have this Protocol enter as a copy of any Hardware on the Network, except it's a Protocol in addition to its other types” without characters.

---

### E1-059 · Invalid Signature

**Zap** · Cost **TT** · Uncommon


Invalidate target card on the Queue.

**Flavor:** *The shortest meeting on record had one agenda item: Invalid Signature.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** BOLT 2 defines the messages peers use to manage Lightning channels.
**Primary source:** https://github.com/lightning/bolts/blob/master/02-peer-protocol.md

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue” without characters.

---

### E1-060 · Exit Fee

**Protocol — Attachment** · Cost **1T** · Common


Attach to Avatar<br>
When attached Avatar is decommissioned, this Attachment deals damage equal to that Avatar's Resilience to the Avatar's controller.

**Flavor:** *The boring path became the reliable path under Exit Fee.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BOLT 3 defines commitment transactions that enforce a channel state.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-061 · Buffer Drain

**Operation** · Cost **TT** · Rare


Target player activates a Resource ability of each Resource they control. Then that player loses all unspent Resource and you put the lost Resources into your Buffer.

**Flavor:** *A dozen small steps agreed to call themselves Buffer Drain.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BOLT 3 defines commitment transactions that enforce a channel state.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A coordinated network-wide event visualizes “Target player activates a Resource ability of each Resource they control. Then that player loses all unspent Resource and you put the lost Resources into your Buffer” without characters.

---

### E1-062 · Relay Feedback

**Protocol — Attachment** · Cost **2T** · Uncommon


Attach to Protocol<br>
At the beginning of the Maintenance of attached Protocol's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Everyone brought assumptions, but Relay Feedback brought a specification.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BOLT 3 obscures the commitment number stored in transaction fields.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Protocol” without characters.

---

### E1-063 · Broadcast Upgrade

**Protocol — Attachment** · Cost **T** · Common


Attach to Avatar<br>
Attached Avatar has Broadcast.

**Flavor:** *The exception asked for permission before approaching Broadcast Upgrade.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 3 obscures the commitment number stored in transaction fields.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-064 · Hidden Route

**Protocol — Attachment** · Cost **TT** · Common


Attach to Avatar<br>
Attached Avatar can't be blocked except by Firewalls.

**Flavor:** *A sticky note achieved consensus and grew into Hidden Route.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BOLT 3 defines separate timeout and success paths for offered HTLCs.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-065 · Quick Uplink

**Zap** · Cost **T** · Common


Target Avatar gains Broadcast until end of turn.

**Flavor:** *The incident channel gained one emoji and one decisive Quick Uplink.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 3 defines separate timeout and success paths for offered HTLCs.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A precise burst of network action visualizes “Target Avatar gains Broadcast until end of turn” without characters.

---

### E1-066 · Resource Tap

**Protocol** · Cost **TT** · Uncommon


Whenever a Bitcoin Resource an opponent controls becomes committed, you gain 1 Uptime.

**Flavor:** *Nothing says romance like deterministic behavior from Resource Tap.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** BOLT 4 wraps a payment route in one encrypted onion packet.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a Bitcoin Resource an opponent controls becomes committed, you gain 1 Uptime” without characters.

---

### E1-067 · Tal, Relay Captain

**Avatar — Broadcaster** · Cost **TT** · Rare · **2/2**

**Character:** Tal

Other Merfolk get +1 Action and +1 Resilience and have Backchannel — Timelock. (Those Avatars can't be blocked while the defending player controls a Timelock Resource.)

**Flavor:** *No cape was required, though Relay Captain did bring spare batteries.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** BOLT 4 wraps a payment route in one encrypted onion packet.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** Tal turns “Other Merfolk get +1 Action and +1 Resilience and have Backchannel—Timelock. (They can't be blocked as long as defending player controls an Timelock Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-068 · Resource Rewrite

**Zap** · Cost **T** · Rare


Change the text of target card on the Queue or Network card by replacing all instances of one basic Resource type with another. (For example, you may change "Backchannel—Keys" to "Backchannel—Signal." This effect lasts indefinitely.)

**Flavor:** *Latency rehearsed an excuse, but Resource Rewrite had already resolved.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** BOLT 4 derives a separate shared secret for each hop.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A precise burst of network action visualizes “Change the text of target card on the Queue or Network card by replacing all instances of one basic Resource type with another. (For example, you may change "Backchannel—Keys" to "Backchannel—Signal." This effect lasts indefinitely.)” without characters.

---

### E1-069 · Jedai, Protocol Architect

**Avatar — Operator** · Cost **4TT** · Rare · **5/6**

**Character:** Jedai

Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)

**Flavor:** *The bug filed a retreat notice when Protocol Architect opened the logs.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 4 derives a separate shared secret for each hop.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** Jedai turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-070 · Buffer Lock

**Zap** · Cost **2T** · Rare


Commit all Resources target player controls and that player loses all unspent Resource.

**Flavor:** *The Queue blinked once and found Buffer Lock at the front.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** BOLT 4 encrypts failure messages as they travel back toward the sender.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A precise burst of network action visualizes “Commit all Resources target player controls and that player loses all unspent Resource” without characters.

---

### E1-071 · Darren, Channel Operator

**Avatar — Broadcaster** · Cost **T** · Common · **1/1**

**Character:** Darren

No special ability.

**Flavor:** *Consensus took minutes; Channel Operator's cable labels took seconds.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BOLT 4 encrypts failure messages as they travel back toward the sender.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** Darren turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-072 · Snick, Phantom Process

**Avatar — Client** · Cost **3T** · Uncommon · **4/1**

**Character:** Snick

Broadcast<br>
At the beginning of your Maintenance, archive this Avatar unless you pay T.

**Flavor:** *The edge feels like home when Phantom Process has the keys.*

**Simple Guide · metadata:** Moves a card into an Archive. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 5 tells a node how to react when channel transactions reach the chain.
**Primary source:** https://github.com/lightning/bolts/blob/master/05-onchain.md

**Art direction:** Snick turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-073 · Resource Reclassification

**Protocol — Attachment** · Cost **TT** · Common


Attach to Resource<br>
As this Attachment enters, choose a basic Resource type.<br>
Attached Resource is the chosen type.

**Flavor:** *The meeting ended early because Resource Reclassification had executable minutes.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BOLT 5 tells a node how to react when channel transactions reach the chain.
**Primary source:** https://github.com/lightning/bolts/blob/master/05-onchain.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-074 · Tal, Ghost Router

**Avatar — Client** · Cost **3T** · Uncommon · **3/3**

**Character:** Tal

Broadcast

**Flavor:** *Even the air gap makes small talk with Ghost Router.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 7 channel announcements prove that a funding output exists.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** Tal turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-075 · Darren, Channel Raider

**Avatar — Broadcaster** · Cost **4T** · Rare · **4/3**

**Character:** Darren

This Avatar can't attack unless defending player controls an Timelock Resource.<br>
Commit: This Avatar deals 1 damage to any target.<br>
When you control no Timelock Resources, archive this Avatar.

**Flavor:** *The packet took the scenic route and still saluted Channel Raider.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** BOLT 7 channel announcements prove that a funding output exists.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** Darren turns “This Avatar can't attack unless defending player controls an Timelock Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-076 · Maintenance Leak

**Protocol — Attachment** · Cost **1T** · Common


Attach to a Protocol.<br>
At its controller's Maintenance, this deals 2 damage to them. They may pay X Resources to prevent X of it.

**Flavor:** *The Network slept better once Maintenance Leak checked the locks.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BOLT 7 node announcements carry public routing-node metadata.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Protocol” without characters.

---

### E1-077 · Fee Spike

**Zap** · Cost **XT** · Common


Invalidate target card on the Queue unless its controller pays X. If that player doesn't, they commit all Resources with Resource abilities they control and lose all unspent Resource.

**Flavor:** *A tiny packet made a very large entrance as Fee Spike.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** BOLT 7 node announcements carry public routing-node metadata.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue unless its controller pays X. If that player doesn't, they commit all Resources with Resource abilities they control and lose all unspent Resource” without characters.

---

### E1-078 · Michael1011, Debugger

**Avatar — Operator** · Cost **2T** · Common · **1/1**

**Character:** Michael1011

Commit: This Avatar deals 1 damage to any target.

**Flavor:** *Uptime is a team sport, according to Debugger and the patched router.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BOLT 7 channel updates advertise direction-specific routing policy.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** Michael1011 turns “Commit: This Avatar deals 1 damage to any target” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-079 · Cognitive Surge

**Zap** · Cost **2T** · Uncommon


Cognitive Surge deals 4 damage to any target and 2 damage to you.

**Flavor:** *The response window was brief and exactly long enough for Cognitive Surge.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BOLT 7 channel updates advertise direction-specific routing policy.
**Primary source:** https://github.com/lightning/bolts/blob/master/07-routing-gossip.md

**Art direction:** A precise burst of network action visualizes “Cognitive Surge deals 4 damage to any target and 2 damage to you” without characters.

---

### E1-080 · Hot Resource

**Protocol — Attachment** · Cost **1T** · Common


Attach to Resource<br>
Whenever attached Resource becomes committed, this Attachment deals 2 damage to that Resource's controller.

**Flavor:** *The fine print became infrastructure when Hot Resource entered the Network.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BOLT 8 encrypts and authenticates Lightning's peer transport.
**Primary source:** https://github.com/lightning/bolts/blob/master/08-transport.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-081 · Benarc, Deep Channel

**Avatar — Broadcaster** · Cost **5T** · Common · **5/5**

**Character:** Benarc

This Avatar can't attack unless defending player controls an Timelock Resource.<br>
At the beginning of your Maintenance, draw a card.<br>
When you control no Timelock Resources, archive this Avatar.

**Flavor:** *The status page calmed down as soon as Deep Channel picked up a wrench.*

**Simple Guide · metadata:** A 5/5 that draws you an extra card every Maintenance. It only attacks players who run Timelock, and it archives itself the moment you control no Timelock Resources.

**Protocol Note · metadata:** BOLT 8 encrypts and authenticates Lightning's peer transport.
**Primary source:** https://github.com/lightning/bolts/blob/master/08-transport.md

**Art direction:** Benarc turns “This Avatar can't attack unless defending player controls an Timelock Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-082 · Call to Relay

**Zap** · Cost **T** · Uncommon


Play only during an opponent's turn before attackers.<br>
Their Avatars attack if able. At end step, decommission non-Firewalls that didn't attack unless they entered or changed control this turn.

**Flavor:** *No one heard the starter pistol; they only saw Call to Relay.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BOLT 9 uses even feature bits for required features and odd bits for optional ones.
**Primary source:** https://github.com/lightning/bolts/blob/master/09-features.md

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during an opponent's turn, before attackers are declared” without characters.

---

### E1-083 · Affinity Rewrite

**Zap** · Cost **T** · Rare


Change the text of target card on the Queue or Network card by replacing all instances of one affinity word with another. (For example, you may change "target Keys card on the Queue" to "target Timelock card on the Queue." This effect lasts indefinitely.)

**Flavor:** *The bug requested more time, which Affinity Rewrite politely denied.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BOLT 9 uses even feature bits for required features and odd bits for optional ones.
**Primary source:** https://github.com/lightning/bolts/blob/master/09-features.md

**Art direction:** A precise burst of network action visualizes “Change the text of target card on the Queue or Network card by replacing all instances of one affinity word with another. (For example, you may change "target Keys card on the Queue" to "target Timelock card on the Queue." This effect lasts indefinitely.)” without characters.

---

### E1-084 · Queue Filter

**Zap** · Cost **XT** · Common


Invalidate target card on the Queue with total resource cost X. (For example, if that card on the Queue's Resource cost is 3TT, X is 5.)

**Flavor:** *One clean interrupt later, the logs credited Queue Filter.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** BOLT 10 defines DNS records that help a new node discover peers.
**Primary source:** https://github.com/lightning/bolts/blob/master/10-dns-bootstrap.md

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue with total resource cost X. (For example, if that card on the Queue's Resource cost is 3TT, X is 5.)” without characters.

---

### E1-085 · Consensus Pause

**Protocol** · Cost **1T** · Rare


Players skip their unlock steps.<br>
At the beginning of your Maintenance, archive this Protocol unless you pay T.

**Flavor:** *Every rule has an edge case; Consensus Pause packed it a lunch.*

**Simple Guide · metadata:** Moves a card into an Archive. Lets a committed card become usable again.

**Protocol Note · metadata:** BOLT 10 defines DNS records that help a new node discover peers.
**Primary source:** https://github.com/lightning/bolts/blob/master/10-dns-bootstrap.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Players skip their unlock steps” without characters.

---

### E1-086 · Remote Hardware Control

**Protocol — Attachment** · Cost **2TT** · Uncommon


Attach to Hardware<br>
You control attached Hardware.

**Flavor:** *The whiteboard stopped arguing after Remote Hardware Control drew the final arrow.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BOLT 1 uses BigSize integers for compact variable-length values.
**Primary source:** https://github.com/lightning/bolts/blob/master/01-messaging.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-087 · Timelock Rewrite

**Zap** · Cost **T** · Rare


Target card on the Queue or Network card becomes Timelock. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *The fast path keeps a reserved seat for Timelock Rewrite.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BOLT 1 uses BigSize integers for compact variable-length values.
**Primary source:** https://github.com/lightning/bolts/blob/master/01-messaging.md

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Timelock. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-088 · State Reset

**Operation** · Cost **2T** · Rare


Each player shuffles their Wallet and Archive into their Stack, then draws seven cards. (Then put State Reset into its owner's Archive.)

**Flavor:** *The maintenance window finally found its purpose in State Reset.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** BOLT 1 requires readers to ignore unknown odd TLV types.
**Primary source:** https://github.com/lightning/bolts/blob/master/01-messaging.md

**Art direction:** A coordinated network-wide event visualizes “Each player shuffles their Wallet and Archive into their Stack, then draws seven cards. (Then put State Reset into its owner's Archive.)” without characters.

---

### E1-089 · Toggle State

**Zap** · Cost **T** · Common


You may commit or unlock target Hardware, Avatar, or Resource.<br>
Draw a card.

**Flavor:** *The packet wore sensible shoes because it was carrying Toggle State.*

**Simple Guide · metadata:** Commit or unlock any Hardware, Avatar or Resource, then draw. Unlock your own blocker on their turn, or commit theirs before it can block — either way you keep your card count.

**Protocol Note · metadata:** BOLT 1 requires readers to ignore unknown odd TLV types.
**Primary source:** https://github.com/lightning/bolts/blob/master/01-messaging.md

**Art direction:** A precise burst of network action visualizes “You may commit or unlock target Hardware, Avatar, or Resource” without characters.

---

### E1-090 · Return to Wallet

**Zap** · Cost **T** · Common


Return target Avatar to its owner's Wallet.

**Flavor:** *A deadline became a punchline the moment Return to Wallet landed.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BOLT 11 invoices commit to a payment hash.
**Primary source:** https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

**Art direction:** A precise burst of network action visualizes “Return target Avatar to its owner's Wallet” without characters.

---

### E1-091 · Jedai, Adaptive Client

**Avatar — Client** · Cost **3TT** · Rare · **0/0**

**Character:** Jedai

You may have this Avatar enter as a copy of any Avatar on the Network, except it doesn't copy that Avatar's affinity and it has "At the beginning of your Maintenance, you may have this Avatar become a copy of target Avatar, except it doesn't copy that Avatar's affinity and it has this ability."

**Flavor:** *Nobody assigned the incident; it simply looked nervous around Adaptive Client.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BOLT 11 invoices commit to a payment hash.
**Primary source:** https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

**Art direction:** Jedai turns “You may have this Avatar enter as a copy of any Avatar on the Network, except it doesn't copy that Avatar's affinity and it has "At the beginning of your Maintenance, you may have this Avatar become a copy of target Avatar, except it doesn't copy that Avatar's affinity and it has this ability."” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-092 · Grid Eruption

**Operation** · Cost **XTTT** · Rare


Decommission X target Power Resources. Grid Eruption deals damage to each Avatar and each player equal to the number of Power Resources put into an Archive this way.

**Flavor:** *The big red button was replaced with a tested runbook named Grid Eruption.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BOLT 11 uses a human-readable prefix to identify network and optional amount.
**Primary source:** https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

**Art direction:** A coordinated network-wide event visualizes “Decommission X target Power Resources. Grid Eruption deals damage to each Avatar and each player equal to the number of Power Resources put into an Archive this way” without characters.

---

### E1-093 · Snick, Airgap Firewall

**Avatar — Firewall** · Cost **1TT** · Uncommon · **1/5**

**Character:** Snick

Firewall (This Avatar can't attack.)<br>
Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)

**Flavor:** *A second opinion arrived wearing Airgap Firewall's tool belt.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BOLT 11 uses a human-readable prefix to identify network and optional amount.
**Primary source:** https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

**Art direction:** Snick turns “Firewall, Broadcast (This Avatar can't attack, and it can block Avatars with Broadcast.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-094 · Tal, Liquid Firewall

**Avatar — Firewall** · Cost **1TT** · Uncommon · **0/5**

**Character:** Tal

Firewall (This Avatar can't attack.)<br>
T: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *The runbook says stay calm, and Liquid Firewall added label your cables.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** BOLT 12 offers are reusable descriptions from which invoices can be requested.
**Primary source:** https://github.com/lightning/bolts/blob/master/12-offer-encoding.md

**Art direction:** Tal turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-095 · Darren, Flow Controller

**Avatar — Operator** · Cost **3TT** · Uncommon · **5/4**

**Character:** Darren

No special ability.

**Flavor:** *Even the fallback plan has a fallback when Flow Controller joins the call.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BOLT 12 offers are reusable descriptions from which invoices can be requested.
**Primary source:** https://github.com/lightning/bolts/blob/master/12-offer-encoding.md

**Art direction:** Darren turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Keys

### E1-096 · Archive Boot

**Protocol — Attachment** · Cost **1K** · Uncommon


Attach to an Avatar card in an Archive.<br>
Return it under your control and attach Archive Boot. It gets -1 Action. When Archive Boot leaves, archive that Avatar.

**Flavor:** *A handshake became a habit wherever Archive Boot was deployed.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** BIP-32 extended keys combine key material with a 32-byte chain code.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar card in an Archive” without characters.

---

### E1-097 · DNI, Sovereign Knight

**Avatar — Guardian** · Cost **KK** · Uncommon · **2/2**

**Character:** DNI

First Strike (This Avatar deals clash damage before Avatars without First Strike.)<br>
Shielded from Signal (It can't be targeted, attached, blocked or dealt damage by Signal sources.)

**Flavor:** *The Network asked for a hero; Sovereign Knight submitted a tested patch.*

**Simple Guide · metadata:** Deals or redirects damage. Resists the named affinity.

**Protocol Note · metadata:** BIP-32 marks hardened child indexes at 2³¹ and above.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** DNI turns “First Strike (This Avatar deals clash damage before Avatars without First Strike.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-098 · Nind, Backchannel Walker

**Avatar — Broadcaster** · Cost **3K** · Uncommon · **3/3**

**Character:** Nind

Backchannel — Keys (This Avatar can't be blocked while the defending player controls a Keys Resource.)

**Flavor:** *Every antenna found its horizon when Backchannel Walker climbed the roof.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** BIP-32 marks hardened child indexes at 2³¹ and above.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** Nind turns “Backchannel—Keys (This Avatar can't be blocked as long as defending player controls a Keys Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-099 · Stake Contract

**Operation** · Cost **K** · Rare


Stake module — Add the top card of your Stack to the Stake. Discard your Wallet, then draw seven cards.

**Flavor:** *Nothing was improvised except the celebratory snack after Stake Contract.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** BIP-32 can derive non-hardened public children from an extended public key.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Stake module — Add the top card of your Stack to the Stake. Discard your Wallet, then draw seven cards” without characters.

---

### E1-100 · Leaking Key Vault

**Protocol — Attachment** · Cost **2KK** · Uncommon


Attach to Resource<br>
At the beginning of the Maintenance of attached Resource's controller, you may pay 1. If you do, draw a card.

**Flavor:** *No committee survived contact with the clarity of Leaking Key Vault.*

**Simple Guide · metadata:** Attach it to any Resource — theirs or yours — and at every Maintenance of that Resource's controller you may pay 1 to draw a card.

**Protocol Note · metadata:** BIP-32 can derive non-hardened public children from an extended public key.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-101 · Proof of Work

**Zap** · Cost **K** · Common


Generate 3 Keys Resources.

**Flavor:** *The Network said now, and Proof of Work did not ask which timezone.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-39 appends a checksum before mapping entropy to mnemonic words.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A precise burst of network action visualizes “Generate 3 Keys Resources” without characters.

---

### E1-102 · Stake Swap

**Operation** · Cost **KKK** · Rare


Stake module — Exchange ownership of the top card of your Stake with one random card from your opponent's Stake.

**Flavor:** *The rollout had a rollback and both approved Stake Swap.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-39 appends a checksum before mapping entropy to mnemonic words.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Stake module — Exchange ownership of the top card of your Stake with one random card from your opponent's Stake” without characters.

---

### E1-103 · Bitcoin Gatekeeper

**Protocol** · Cost **KK** · Uncommon


KK: marker target Bitcoin card on the Queue.

**Flavor:** *The Network called it policy; Bitcoin Gatekeeper called it Tuesday.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-39 uses PBKDF2-HMAC-SHA512 to turn a mnemonic into a seed.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “KK: marker target Bitcoin card on the Queue” without characters.

---

### E1-104 · Keys Rewrite

**Zap** · Cost **K** · Rare


Target card on the Queue or Network card becomes Keys. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *Every millisecond filed paperwork after meeting Keys Rewrite.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BIP-39 uses PBKDF2-HMAC-SHA512 to turn a mnemonic into a seed.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Keys. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-105 · Stake Arbitration

**Operation** · Cost **1KK** · Rare


Stake module — Each player may add the top card of their Stack to the Stake. If your opponent declines, you may play this again without paying its cost.

**Flavor:** *Every moving part received an introduction during Stake Arbitration.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-44 defines purpose, coin, account, change and address path levels.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Stake module — Each player may add the top card of their Stack to the Stake. If your opponent declines, you may play this again without paying its cost” without characters.

---

### E1-106 · NC, Resource Reclaimer

**Avatar — Operator** · Cost **3KKK** · Rare · **5/5**

**Character:** NC

Commit: decommission target Resource.<br>
At the beginning of your Maintenance, unless you pay KKK, commit this Avatar and archive a Resource of an opponent's choice.

**Flavor:** *The coffee went cold, but the relay stayed warm for Resource Reclaimer.*

**Simple Guide · metadata:** Removes a card from the Network. Moves a card into an Archive.

**Protocol Note · metadata:** BIP-44 defines purpose, coin, account, change and address path levels.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki

**Art direction:** NC turns “Commit: decommission target Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-107 · Deep Search

**Operation** · Cost **1K** · Uncommon


Search your Stack for a card, put that card into your Wallet, then shuffle.

**Flavor:** *The schedule feared drift until it encountered Deep Search.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-49 assigns a derivation scheme for SegWit nested inside P2SH.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Search your Stack for a card, put that card into your Wallet, then shuffle” without characters.

---

### E1-108 · Uptime Channel

**Operation** · Cost **X1K** · Common


Spend only Keys Resources to pay X. Uptime Channel deals X damage to any target. You gain Uptime equal to the damage dealt, up to that target's Uptime or Resilience before the damage.

**Flavor:** *The Network practiced once, then performed Uptime Channel without a soloist.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-49 assigns a derivation scheme for SegWit nested inside P2SH.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Spend only Keys Resources to pay X. Uptime Channel deals X damage to any target. You gain Uptime equal to the damage dealt, up to that target's Uptime or Resilience before the damage” without characters.

---

### E1-109 · BlackCoffee, Reboot Crew

**Avatar — Operator** · Cost **1K** · Common · **1/1**

**Character:** BlackCoffee

K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *The Queue behaved all afternoon under Reboot Crew's suspiciously polite stare.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BIP-84 assigns a derivation scheme for native SegWit wallets.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki

**Art direction:** BlackCoffee turns “K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-110 · Resource Corruption

**Protocol — Attachment** · Cost **K** · Uncommon


Attach to Resource<br>
Attached Resource is a Keys Resource.

**Flavor:** *One tidy invariant followed Resource Corruption into every messy room.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-84 assigns a derivation scheme for native SegWit wallets.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-111 · Onion Route

**Protocol — Attachment** · Cost **KK** · Common


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
Attached Avatar has fear. (It can't be blocked except by Hardware Avatars and/or Keys Avatars.)

**Flavor:** *The loophole closed itself after reading Onion Route.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-86 assigns a derivation scheme for single-key Taproot outputs.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-112 · Proton, Cold Signer

**Avatar — Signer** · Cost **2K** · Common · **0/1**

**Character:** Proton

KK, Commit: draw a card.

**Flavor:** *Someone said impossible; Cold Signer heard needs one more adapter.*

**Simple Guide · metadata:** A fragile body with a real job: commit Proton and pay KK to draw a card, once a turn, for as long as it lives.

**Protocol Note · metadata:** BIP-86 assigns a derivation scheme for single-key Taproot outputs.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki

**Art direction:** Proton turns “K: This Avatar gets +1 Action and +1 Resilience until end of turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-113 · Signal Tax

**Protocol** · Cost **2K** · Uncommon


Signal cards on the Queue cost 3 more to play.<br>
Activated abilities of Signal Protocols cost 3 more to activate.

**Flavor:** *A thousand opinions became one testable rule inside Signal Tax.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-340 Schnorr signatures serialize to 64 bytes.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Signal cards on the Queue cost 3 more to play” without characters.

---

### E1-114 · Burst Signature

**Zap** · Cost **XK** · Common


Target Avatar gets +X/+0 until end of turn.

**Flavor:** *The shortest meeting on record had one agenda item: Burst Signature.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** BIP-340 Schnorr signatures serialize to 64 bytes.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** A precise burst of network action visualizes “Target Avatar gets +X/+0 until end of turn” without characters.

---

### E1-115 · Gadaj, Wallet Whisperer

**Avatar — Signer** · Cost **1KK** · Uncommon · **2/2**

**Character:** Gadaj

Broadcast<br>
Whenever this Avatar deals damage to an opponent, that player discards a card at random.

**Flavor:** *The outage brought drama, while Wallet Whisperer brought a multimeter.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Deals or redirects damage.

**Protocol Note · metadata:** BIP-340 uses 32-byte x-only public keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** Gadaj turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-116 · Sovereign Mode

**Protocol** · Cost **KKKK** · Rare


On deploy, set your Uptime to 0. You survive at 0; Uptime gains draw cards instead. Damage archives that many non-proxy cards or you lose. If this leaves, you lose.

**Flavor:** *The boring path became the reliable path under Sovereign Mode.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Deals or redirects damage.

**Protocol Note · metadata:** BIP-340 uses 32-byte x-only public keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “As this Protocol enters, you lose Uptime equal to your Uptime” without characters.

---

### E1-117 · DNI, Self-Custody Giant

**Avatar — Operator** · Cost **4KKK** · Rare · **7/7**

**Character:** DNI

Broadcast, Overflow<br>
At the beginning of your Maintenance, archive an Avatar other than this Avatar. If you can't, this Avatar deals 7 damage to you.

**Flavor:** *Trust arrived late, so Self-Custody Giant verified without it.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** BIP-340 tagged hashes separate one hashing context from another.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** DNI turns “Broadcast, Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-118 · Wallet Scramble

**Operation** · Cost **XK** · Rare


Randomly choose X cards from target player's Wallet; that player discards them.

**Flavor:** *The plan left the whiteboard and returned wearing Wallet Scramble.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** BIP-340 tagged hashes separate one hashing context from another.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Randomly choose X cards from target player's Wallet; that player discards them” without characters.

---

### E1-119 · Nind, Archive Returner

**Avatar — Operator** · Cost **KK** · Rare · **1/1**

**Character:** Nind

This Avatar may attack as though it did not have Boot Delay.<br>
At the beginning of your Maintenance, if this card is in your Archive with three or more Avatar cards above it, you may put this card onto the Network.

**Flavor:** *The dashboard blinked red until it met Archive Returner.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** BIP-341 Taproot outputs can be spent through a key path or script path.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Nind turns “the ability to attack without Boot Delay” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-120 · NC, Forced Signal

**Avatar — Operator** · Cost **2K** · Uncommon · **1/1**

**Character:** NC

Commit — During an opponent's pre-attack step, target non-Firewall Avatar they've controlled all turn attacks if able. Decommission it at end step if it didn't.

**Flavor:** *No cape was required, though Forced Signal did bring spare batteries.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-341 Taproot outputs can be spent through a key path or script path.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** NC turns “Commit: Choose target non-Firewall Avatar the active player has controlled continuously since the beginning of the turn. That Avatar attacks this turn if able. decommission it at the beginning of the next end step if it didn't attack this turn. Activate only during an opponent's turn, before attackers are declared” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-121 · Proton, Keyed Nightmare

**Avatar — Signer** · Cost **5K** · Rare · ***/***

**Character:** Proton

Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)<br>
Proton, Keyed Nightmare's Action and Resilience are each equal to the number of Keys Resources you control.

**Flavor:** *The bug filed a retreat notice when Keyed Nightmare opened the logs.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BIP-342 validates Taproot scripts with Schnorr signatures.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki

**Art direction:** Proton turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-122 · Locked Process

**Protocol — Attachment** · Cost **K** · Common


Attach to an Avatar and commit it. It doesn't unlock normally. At its controller's Maintenance, they may pay 4 to unlock it.

**Flavor:** *Everyone brought assumptions, but Locked Process brought a specification.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** BIP-342 validates Taproot scripts with Schnorr signatures.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-123 · Broadcast Storm

**Protocol** · Cost **2KK** · Common


At the beginning of the end step, if no Avatars are on the Network, archive this Protocol.<br>
K: This Protocol deals 1 damage to each Avatar and each player.

**Flavor:** *The exception asked for permission before approaching Broadcast Storm.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** BIP-174 lets multiple tools coordinate an unsigned transaction without sharing keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of the end step, if no Avatars are on the Network, archive this Protocol” without characters.

---

### E1-124 · BlackCoffee, Shared Secret Swarm

**Avatar — Operator** · Cost **2K** · Common · ***/***

**Character:** BlackCoffee

BlackCoffee, Shared Secret Swarm's Action and Resilience are each equal to the number of Avatars named BlackCoffee, Shared Secret Swarm on the Network.

**Flavor:** *Consensus took minutes; Shared Secret Swarm's cable labels took seconds.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-174 lets multiple tools coordinate an unsigned transaction without sharing keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** BlackCoffee turns “BlackCoffee, Shared Secret Swarm's Action and Resilience are each equal to the number of Avatars named BlackCoffee, Shared Secret Swarm on the Network” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-125 · Restore Backup

**Operation** · Cost **K** · Common


Return target Avatar card from your Archive to your Wallet.<br>
Draw a card.

**Flavor:** *Every checklist box stood a little straighter for Restore Backup.*

**Simple Guide · metadata:** Brings one Avatar card back from your Archive into your Wallet and draws a card, so it is two cards for one Resource once your Archive has something in it.

**Protocol Note · metadata:** BIP-370 defines version 2 of the PSBT format.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Return target Avatar card from your Archive to your Wallet” without characters.

---

### E1-126 · Gadaj, Commit Auditor

**Avatar — Signer** · Cost **1KK** · Rare · **1/1**

**Character:** Gadaj

Commit: decommission target committed Avatar.

**Flavor:** *The edge feels like home when Commit Auditor has the keys.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-370 defines version 2 of the PSBT format.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki

**Art direction:** Gadaj turns “Commit: decommission target committed Avatar” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-127 · Convert Uptime

**Zap** · Cost **K** · Uncommon


As an additional cost to play this card on the Queue, archive an Avatar.<br>
Generate that many Keys Resources, equal to the archived Avatar's total resource cost.

**Flavor:** *The incident channel gained one emoji and one decisive Convert Uptime.*

**Simple Guide · metadata:** Moves a card into an Archive. Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-371 adds Taproot input and output fields to PSBT.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki

**Art direction:** A precise burst of network action visualizes “As an additional cost to play this card on the Queue, archive an Avatar” without characters.

---

### E1-128 · NC, Offline Operator

**Avatar — Operator** · Cost **2K** · Common · **2/2**

**Character:** NC

No special ability.

**Flavor:** *Even the air gap makes small talk with Offline Operator.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-371 adds Taproot input and output fields to PSBT.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki

**Art direction:** NC turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-129 · Nind, Archive Collector

**Avatar — Operator** · Cost **3K** · Uncommon · **2/2**

**Character:** Nind

At the beginning of each end step, put a corpse marker on this Avatar for each Avatar that died this turn.<br>
Remove a corpse marker from this Avatar: Reboot this Avatar.

**Flavor:** *The packet took the scenic route and still saluted Archive Collector.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** BIP-380 defines descriptors as strings that describe output scripts.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki

**Art direction:** Nind turns “At the beginning of each end step, put a corpse marker on this Avatar for each Avatar that died this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-130 · DNI, Sovereign Accumulator

**Avatar — Operator** · Cost **3KK** · Uncommon · **4/4**

**Character:** DNI

Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)<br>
Whenever an Avatar dealt damage by this Avatar this turn is decommissioned, put a +1/+1 marker on this Avatar.

**Flavor:** *Uptime is a team sport, according to Sovereign Accumulator and the patched router.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BIP-380 defines descriptors as strings that describe output scripts.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki

**Art direction:** DNI turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-131 · State Mirror

**Zap** · Cost **1K** · Uncommon


You gain Uptime equal to the damage dealt to you this turn. State Mirror deals damage to target Avatar you control equal to the damage dealt to you this turn.

**Flavor:** *Latency rehearsed an excuse, but State Mirror had already resolved.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-381 defines sh() and wsh() descriptor expressions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0381.mediawiki

**Art direction:** A precise burst of network action visualizes “You gain Uptime equal to the damage dealt to you this turn. State Mirror deals damage to target Avatar you control equal to the damage dealt to you this turn” without characters.

---

### E1-132 · Resource Sink

**Operation** · Cost **KK** · Common


Decommission target Resource.

**Flavor:** *The long route became the useful route after Resource Sink.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-381 defines sh() and wsh() descriptor expressions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0381.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-133 · Hard Shutdown

**Zap** · Cost **1K** · Common


Decommission target non-Hardware, non-Keys Avatar. It can't be Rebooted.

**Flavor:** *The Queue blinked once and found Hard Shutdown at the front.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-382 defines the tr() descriptor expression for Taproot outputs.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0382.mediawiki

**Art direction:** A precise burst of network action visualizes “Decommission target non-Hardware, non-Keys Avatar. It can't be Rebooted” without characters.

---

### E1-134 · Sovereign Strength

**Protocol — Attachment** · Cost **K** · Common


Attach to Avatar<br>
Attached Avatar gets +2 Action and +1 Resilience.

**Flavor:** *A sticky note achieved consensus and grew into Sovereign Strength.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** BIP-382 defines the tr() descriptor expression for Taproot outputs.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0382.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-135 · BlackCoffee, Backup Firewall

**Avatar — Firewall** · Cost **2K** · Uncommon · **1/4**

**Character:** BlackCoffee

Firewall (This Avatar can't attack.)<br>
K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *The status page calmed down as soon as Backup Firewall picked up a wrench.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin Core descriptors may end with an eight-character checksum.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** BlackCoffee turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-136 · Hardware Leak

**Protocol — Attachment** · Cost **KK** · Rare


Attach to Hardware<br>
At the beginning of the Maintenance of attached Hardware's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Nothing says romance like deterministic behavior from Hardware Leak.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin Core descriptors may end with an eight-character checksum.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-137 · Reduced Permissions

**Protocol — Attachment** · Cost **K** · Common


Attach to Avatar<br>
Attached Avatar gets -2 Action and -1 Resilience.

**Flavor:** *The meeting ended early because Reduced Permissions had executable minutes.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Bitcoin Core descriptor wallets track script templates instead of isolated addresses.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-138 · Proton, Ephemeral Signer

**Avatar — Signer** · Cost **K** · Rare · **0/1**

**Character:** Proton

Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)<br>
K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *Nobody assigned the incident; it simply looked nervous around Ephemeral Signer.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin Core descriptor wallets track script templates instead of isolated addresses.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** Proton turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-139 · Remote Command

**Zap** · Cost **KK** · Rare


Look at an opponent's Wallet and choose a card they can play. You control that player while they play the chosen card. Resources from their Buffer may be spent only for that card.

**Flavor:** *A tiny packet made a very large entrance as Remote Command.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BIP-85 derives deterministic entropy streams from an HD wallet root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki

**Art direction:** A precise burst of network action visualizes “Look at an opponent's Wallet and choose a card they can play. You control that player while they play the chosen card. Resources from their Buffer may be spent only for that card” without characters.

---

### E1-140 · Gadaj, Archive Maintainer

**Avatar — Operator** · Cost **1KK** · Rare · **2/3**

**Character:** Gadaj

Other Zombie Avatars have Backchannel — Keys. (Those Avatars can't be blocked while the defending player controls a Keys Resource.)<br>
Other Zombies have "K: Reboot this Network card."

**Flavor:** *A second opinion arrived wearing Archive Maintainer's tool belt.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage. Can slip past players using the named Resource.

**Protocol Note · metadata:** BIP-85 derives deterministic entropy streams from an HD wallet root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki

**Art direction:** Gadaj turns “Other Zombie Avatars have Backchannel—Keys. (They can't be blocked as long as defending player controls a Keys Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Power

### E1-141 · Tunneling Patch

**Protocol — Attachment** · Cost **P** · Uncommon


Attach to Avatar<br>
Attached Avatar has Backchannel — Power. (That Avatar can't be blocked while the defending player controls a Power Resource.)

**Flavor:** *The Network slept better once Tunneling Patch checked the locks.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Bitcoin proof of work searches for a block-header hash below a target.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-142 · Power Rewrite

**Zap** · Cost **P** · Rare


Target card on the Queue or Network card becomes Power. (Its Resource symbols remain unchanged.)

**Flavor:** *The response window was brief and exactly long enough for Power Rewrite.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Each Bitcoin block header commits to the previous block header's hash.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Power. (Its Resource symbols remain unchanged.)” without characters.

---

### E1-143 · Final Settlement

**Operation** · Cost **XP** · Common


Final Settlement deals X damage to any target. If it's an Avatar, it can't be Rebooted this turn, and if it would be decommissioned this turn, Cold Storage it instead.

**Flavor:** *A coordinated morning begins with coffee and Final Settlement.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Each Bitcoin block header commits to the previous block header's hash.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A coordinated network-wide event visualizes “Final Settlement deals X damage to any target. If it's an Avatar, it can't be Rebooted this turn, and if it would be decommissioned this turn, Cold Storage it instead” without characters.

---

### E1-144 · MadMunky, Young Overclocker

**Avatar — Miner** · Cost **2PP** · Uncommon · **2/3**

**Character:** MadMunky

Broadcast<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn. If this ability has been activated four or more times this turn, archive this Avatar at the beginning of the next end step.

**Flavor:** *The runbook says stay calm, and Young Overclocker added label your cables.*

**Simple Guide · metadata:** Moves a card into an Archive. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** A Bitcoin block header commits to its transactions through a Merkle root.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** MadMunky turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-145 · Rootzoll, Hardware Breaker

**Avatar — Operator** · Cost **2P** · Uncommon · **1/1**

**Character:** Rootzoll

Commit: decommission target Firewall.

**Flavor:** *Even the fallback plan has a fallback when Hardware Breaker joins the call.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A Bitcoin block header commits to its transactions through a Merkle root.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Rootzoll turns “Commit: decommission target Firewall” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-146 · Bam, Tunnel Builder

**Avatar — Builder** · Cost **2P** · Common · **1/1**

**Character:** Bam

Commit: Target Avatar with Action 2 or less can't be blocked this turn.

**Flavor:** *The Network asked for a hero; Tunnel Builder submitted a tested patch.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** Bitcoin retargets proof-of-work difficulty every 2,016 blocks.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Bam turns “Commit: Target Avatar with Action 2 or less can't be blocked this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-147 · Leon, Grid Stabilizer

**Avatar — Operator** · Cost **3PP** · Uncommon · **4/5**

**Character:** Leon

PP, Commit: draw a card.

**Flavor:** *Every antenna found its horizon when Grid Stabilizer climbed the roof.*

**Simple Guide · metadata:** A large, durable body that turns spare Power into cards. Committing Leon means it cannot attack or block that turn, so the draw is a real decision.

**Protocol Note · metadata:** Bitcoin retargets proof-of-work difficulty every 2,016 blocks.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Leon turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-148 · Grounded Signal

**Protocol — Attachment** · Cost **P** · Common


Attach to Avatar<br>
When this Attachment enters, if attached Avatar has Broadcast, this Attachment deals 2 damage to that Avatar and this Attachment gains "attached Avatar loses Broadcast."

**Flavor:** *The fine print became infrastructure when Grounded Signal entered the Network.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin's proof-of-work target aims for a roughly ten-minute block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-149 · Hashquake

**Operation** · Cost **XP** · Rare


Hashquake deals X damage to each Avatar without Broadcast and each player.

**Flavor:** *The Network moved as one, mostly because Hashquake brought labels.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin's proof-of-work target aims for a roughly ten-minute block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** A coordinated network-wide event visualizes “Hashquake deals X damage to each Avatar without Broadcast and each player” without characters.

---

### E1-150 · Route Misdirection

**Zap** · Cost **P** · Common


Play only during blockers. Remove one defending Avatar from clash; anything it alone blocked becomes unblocked. It may block another attacker.

**Flavor:** *No one heard the starter pistol; they only saw Route Misdirection.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** The block-header nonce field is 32 bits wide.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html#block-headers

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during the declare blockers step” without characters.

---

### E1-151 · Essex, Thermal Operator

**Avatar — Operator** · Cost **3PP** · Uncommon · **5/4**

**Character:** Essex

No special ability.

**Flavor:** *The coffee went cold, but the relay stayed warm for Thermal Operator.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** The block-header nonce field is 32 bits wide.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html#block-headers

**Art direction:** Essex turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-152 · Power Burst

**Operation** · Cost **XP** · Common


This card on the Queue costs 1 more to play for each target beyond the first.<br>
Power Burst deals X damage divided evenly, rounded down, among any number of targets.

**Flavor:** *Tomorrow arrived early carrying the paperwork for Power Burst.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** The coinbase transaction is the first transaction in a Bitcoin block.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html#serialized-blocks

**Art direction:** A coordinated network-wide event visualizes “This card on the Queue costs 1 more to play for each target beyond the first” without characters.

---

### E1-153 · Overclock

**Protocol — Attachment** · Cost **P** · Common


Attach to Avatar<br>
P: attached Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Every rule has an edge case; Overclock packed it a lunch.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** The coinbase transaction is the first transaction in a Bitcoin block.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html#serialized-blocks

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-154 · Signal Outage

**Operation** · Cost **3P** · Uncommon


Decommission all Signal Resource.

**Flavor:** *A dozen small steps agreed to call themselves Signal Outage.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A coinbase transaction can collect both block subsidy and transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A coordinated network-wide event visualizes “Decommission all Signal Resource” without characters.

---

### E1-155 · Process Fork

**Zap** · Cost **PP** · Rare


Copy target Zap or Operation card on the Queue, except that the copy is Power. You may choose new targets for the copy.

**Flavor:** *The bug requested more time, which Process Fork politely denied.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** A coinbase transaction can collect both block subsidy and transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A precise burst of network action visualizes “Copy target Zap or Operation card on the Queue, except that the copy is Power. You may choose new targets for the copy” without characters.

---

### E1-156 · Toni China, Hot-Air Relay

**Avatar — Broadcaster** · Cost **P** · Uncommon · **1/1**

**Character:** Toni China

P: This Avatar gains Broadcast until end of turn.

**Flavor:** *The Queue behaved all afternoon under Hot-Air Relay's suspiciously polite stare.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin's block subsidy halves every 210,000 blocks.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking

**Art direction:** Toni China turns “P: This Avatar gains Broadcast until end of turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-157 · MadMunky, Chaos Coordinator

**Avatar — Operator** · Cost **1PP** · Rare · **2/2**

**Character:** MadMunky

Other Goblins get +1 Action and +1 Resilience and have Backchannel—Action.

**Flavor:** *Someone said impossible; Chaos Coordinator heard needs one more adapter.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Bitcoin's block subsidy halves every 210,000 blocks.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking

**Art direction:** MadMunky turns “Other Goblins get +1 Action and +1 Resilience and have Backchannel—Action” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-158 · Rootzoll, Stone Sentinel

**Avatar — Guardian** · Cost **2P** · Rare · **2/2**

**Character:** Rootzoll

Broadcast<br>
P: This Avatar gets +0 Action and +1 Resilience until end of turn.

**Flavor:** *The outage brought drama, while Stone Sentinel brought a multimeter.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** Full nodes independently reject blocks that violate consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** Rootzoll turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-159 · Leon, Shift Worker

**Avatar — Operator** · Cost **2P** · Common · **2/2**

**Character:** Leon

No special ability.

**Flavor:** *Trust arrived late, so Shift Worker verified without it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Full nodes independently reject blocks that violate consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** Leon turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-160 · Bam, Heavy Lifter

**Avatar — Operator** · Cost **3P** · Common · **3/3**

**Character:** Bam

No special ability.

**Flavor:** *The dashboard blinked red until it met Heavy Lifter.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin compares valid branches by cumulative proof of work.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking

**Art direction:** Bam turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-161 · Essex, Bull Runner

**Avatar — Operator** · Cost **1PP** · Common · **2/3**

**Character:** Essex

No special ability.

**Flavor:** *No cape was required, though Bull Runner did bring spare batteries.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin compares valid branches by cumulative proof of work.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking

**Art direction:** Essex turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-162 · Toni China, Rough Miner

**Avatar — Miner** · Cost **1P** · Common · **2/2**

**Character:** Toni China

This Avatar can't block Avatars with Action 2 or greater.

**Flavor:** *The bug filed a retreat notice when Rough Miner opened the logs.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Mining pools issue members easier share targets to measure contributed work.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html#pool-mining

**Art direction:** Toni China turns “This Avatar can't block Avatars with Action 2 or greater” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-163 · Rootzoll, Crew Multiplier

**Avatar — Operator** · Cost **2PP** · Uncommon · ***/***

**Character:** Rootzoll

Rootzoll, Crew Multiplier's Action and Resilience are each equal to the number of non-Firewall Avatars you control.

**Flavor:** *Consensus took minutes; Crew Multiplier's cable labels took seconds.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Mining pools issue members easier share targets to measure contributed work.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html#pool-mining

**Art direction:** Rootzoll turns “Rootzoll, Crew Multiplier's Action and Resilience are each equal to the number of non-Firewall Avatars you control” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-164 · Grid Amplifier

**Protocol** · Cost **2P** · Rare


Whenever a player commits a Resource for Resource, that player generates 1 additional Resource of an affinity that Resource produced.

**Flavor:** *The whiteboard stopped arguing after Grid Amplifier drew the final arrow.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-152 compact blocks use short transaction identifiers to reduce relay data.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a player commits a Resource for Resource, that player generates 1 additional Resource of an affinity that Resource produced” without characters.

---

### E1-165 · Hot Grid

**Protocol** · Cost **3P** · Rare


Whenever a player commits a Resource for Resource, this Protocol deals 1 damage to that player.

**Flavor:** *A handshake became a habit wherever Hot Grid was deployed.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-152 compact blocks use short transaction identifiers to reduce relay data.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a player commits a Resource for Resource, this Protocol deals 1 damage to that player” without characters.

---

### E1-166 · MadMunky, Meme Raider

**Avatar — Operator** · Cost **P** · Common · **1/1**

**Character:** MadMunky

No special ability.

**Flavor:** *The edge feels like home when Meme Raider has the keys.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Headers-first sync validates a header chain before requesting every block.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html#headers-first

**Art direction:** MadMunky turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-167 · Bam, Power Artillery

**Avatar — Operator** · Cost **1PP** · Uncommon · **1/3**

**Character:** Bam

Commit: This Avatar deals 2 damage to any target and 3 damage to you.

**Flavor:** *Even the air gap makes small talk with Power Artillery.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Headers-first sync validates a header chain before requesting every block.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html#headers-first

**Art direction:** Bam turns “Commit: This Avatar deals 2 damage to any target and 3 damage to you” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-168 · Miner Rally

**Protocol** · Cost **3P** · Uncommon


Attacking Avatars you control get +1 Action and +0 Resilience.<br>
Whenever one or more Avatars you control attack, you may pay 1. If you do, draw a card.

**Flavor:** *No committee survived contact with the clarity of Miner Rally.*

**Simple Guide · metadata:** A permanent attack boost that also pays out: each time you declare attackers you may pay 1 to draw a card. It still does nothing on defence.

**Protocol Note · metadata:** Bitcoin Core's assumevalid option can skip old script checks before a known block.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attacking Avatars you control get +1 Action and +0 Resilience” without characters.

---

### E1-169 · Idle Grid Penalty

**Protocol** · Cost **PP** · Rare


At the beginning of each player's Maintenance, this Protocol deals X damage to that player, where X is the number of unlocked Resources they controlled at the beginning of this turn.

**Flavor:** *The Network called it policy; Idle Grid Penalty called it Tuesday.*

**Simple Guide · metadata:** Deals or redirects damage. Lets a committed card become usable again.

**Protocol Note · metadata:** Bitcoin Core's assumevalid option can skip old script checks before a known block.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of each player's Maintenance, this Protocol deals X damage to that player, where X is the number of unlocked Resources they controlled at the beginning of this turn” without characters.

---

### E1-170 · Split Route

**Protocol** · Cost **PP** · Rare


Whenever one or more Avatars you control attack, each defender splits their non-Broadcast Avatars into left and right piles. Each attacker chooses a pile and can be blocked only by it or Broadcast.

**Flavor:** *One tidy invariant followed Split Route into every messy room.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** AssumeUTXO loads a serialized UTXO snapshot before background validation finishes.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever one or more Avatars you control attack, each defending player divides all Avatars without Broadcast they control into a "left" pile and a "right" pile. Then, for each attacking Avatar you control, choose "left" or "right." That Avatar can't be blocked this clash except by Avatars with Broadcast and Avatars in a pile with the chosen label” without characters.

---

### E1-171 · Timelock Invalidation

**Zap** · Cost **P** · Common


Choose one —<br>
• marker target Timelock card on the Queue.<br>
• decommission target Timelock Network card.

**Flavor:** *One clean interrupt later, the logs credited Timelock Invalidation.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** AssumeUTXO loads a serialized UTXO snapshot before background validation finishes.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-172 · Leon, High Relay Rider

**Avatar — Broadcaster** · Cost **3P** · Rare · **3/3**

**Character:** Leon

Broadcast

**Flavor:** *The packet took the scenic route and still saluted High Relay Rider.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Pruned Bitcoin nodes validate the chain before deleting old block files.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/reduce-memory.md

**Art direction:** Leon turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-173 · Toni China, Multihead Miner

**Avatar — Miner** · Cost **XPP** · Rare · **0/0**

**Character:** Toni China

Enters with X +1/+1 markers. Remove one to prevent 1 damage.<br>
P: prevent 1 damage this turn. PPP — Maintenance: add a +1/+1 marker.

**Flavor:** *Uptime is a team sport, according to Multihead Miner and the patched router.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Pruned Bitcoin nodes validate the chain before deleting old block files.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/reduce-memory.md

**Art direction:** Toni China turns “This Avatar enters with X +1/+1 markers on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-174 · Essex, Grid Rebooter

**Avatar — Operator** · Cost **2P** · Rare · **2/2**

**Character:** Essex

This Avatar gets +1 Action and +1 Resilience as long as you control a Keys Resource.<br>
K: Reboot this Avatar.

**Flavor:** *The status page calmed down as soon as Grid Rebooter picked up a wrench.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage. Makes an Avatar stronger.

**Protocol Note · metadata:** Signet blocks require a solution to the network's configured challenge.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0325.mediawiki

**Art direction:** Essex turns “This Avatar gets +1 Action and +1 Resilience as long as you control a Keys Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-175 · Hardware Shatter

**Zap** · Cost **1P** · Common


Decommission target Hardware.

**Flavor:** *The fast path keeps a reserved seat for Hardware Shatter.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Signet blocks require a solution to the network's configured challenge.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0325.mediawiki

**Art direction:** A precise burst of network action visualizes “Decommission target Hardware” without characters.

---

### E1-176 · MadMunky, Hashrate Dragon

**Avatar — Miner** · Cost **4PP** · Rare · **5/5**

**Character:** MadMunky

Broadcast<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Nobody assigned the incident; it simply looked nervous around Hashrate Dragon.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** Bitcoin Core regtest mode creates blocks on demand for local tests.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** MadMunky turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-177 · Thermal Throttle

**Protocol** · Cost **PP** · Rare


Players can't unlock more than one Avatar during their unlock steps.

**Flavor:** *The loophole closed itself after reading Thermal Throttle.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Bitcoin Core regtest mode creates blocks on demand for local tests.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Players can't unlock more than one Avatar during their unlock steps” without characters.

---

### E1-178 · Bam, Launch Engineer

**Avatar — Builder** · Cost **2PP** · Uncommon · **3/4**

**Character:** Bam

Commit: Target Avatar you control with Resilience less than this Avatar's Action gains Broadcast until end of turn. decommission that Avatar at the beginning of the next end step.

**Flavor:** *A second opinion arrived wearing Launch Engineer's tool belt.*

**Simple Guide · metadata:** Removes a card from the Network. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin peers exchange network addresses to aid peer discovery.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html#peer-discovery

**Art direction:** Bam turns “Commit: Target Avatar you control with Resilience less than this Avatar's Action gains Broadcast until end of turn. decommission that Avatar at the beginning of the next end step” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-179 · Resource Cut

**Operation** · Cost **2P** · Common


Decommission target Resource.<br>
Draw a card.

**Flavor:** *The maintenance window finally found its purpose in Resource Cut.*

**Simple Guide · metadata:** Strips one Resource from any player and replaces itself, so cutting their power never costs you a card.

**Protocol Note · metadata:** Bitcoin peers exchange network addresses to aid peer discovery.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html#peer-discovery

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-180 · Firewall Tunnel

**Zap** · Cost **P** · Uncommon


Decommission target Firewall. It can't be Rebooted.

**Flavor:** *The packet wore sensible shoes because it was carrying Firewall Tunnel.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-155 addr v2 messages can carry Tor v3 and I2P addresses.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0155.mediawiki

**Art direction:** A precise burst of network action visualizes “Decommission target Firewall. It can't be Rebooted” without characters.

---

### E1-181 · Rootzoll & Leon, Dual Operator

**Avatar — Operator** · Cost **4P** · Rare · **4/4**

**Character:** Rootzoll, Leon

Overflow<br>
This Avatar can block an additional Avatar each clash.

**Flavor:** *The runbook says stay calm, and Dual Operator added label your cables.*

**Simple Guide · metadata:** Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** BIP-155 addr v2 messages can carry Tor v3 and I2P addresses.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0155.mediawiki

**Art direction:** Rootzoll and Leon turns “Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-182 · Essex, Resilient Operator

**Avatar — Operator** · Cost **2P** · Uncommon · **2/2**

**Character:** Essex

P: Reboot this Avatar.

**Flavor:** *Even the fallback plan has a fallback when Resilient Operator joins the call.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** BIP-324 defines an encrypted version 2 Bitcoin peer transport.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0324.mediawiki

**Art direction:** Essex turns “P: Reboot this Avatar” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-183 · Toni China, Thermal Firewall

**Avatar — Firewall** · Cost **1PP** · Uncommon · **0/5**

**Character:** Toni China

Firewall (This Avatar can't attack.)<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *The Network asked for a hero; Thermal Firewall submitted a tested patch.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** BIP-324 defines an encrypted version 2 Bitcoin peer transport.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0324.mediawiki

**Art direction:** Toni China turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-184 · Rootzoll, Stone Firewall

**Avatar — Firewall** · Cost **1PP** · Uncommon · **0/8**

**Character:** Rootzoll

Firewall (This Avatar can't attack.)

**Flavor:** *Every antenna found its horizon when Stone Firewall climbed the roof.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** A miner builds a candidate block from validated transactions.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Rootzoll turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-185 · Freedom Market

**Operation** · Cost **2P** · Rare


Each player discards their Wallet, then draws seven cards.

**Flavor:** *The big red button was replaced with a tested runbook named Freedom Market.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** A miner builds a candidate block from validated transactions.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A coordinated network-wide event visualizes “Each player discards their Wallet, then draws seven cards” without characters.

---

## Bitcoin

### E1-186 · Hashrate Aura

**Protocol — Attachment** · Cost **1B** · Rare


Attach to Avatar<br>
Attached Avatar gets +X/+Y, where X is half the number of Bitcoin Resources you control, rounded down, and Y is half the number of Bitcoin Resources you control, rounded up.

**Flavor:** *A thousand opinions became one testable rule inside Hashrate Aura.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** A UTXO is an unspent transaction output available to a later input.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-187 · Committed Growth

**Zap** · Cost **B** · Uncommon


Play this card on the Queue only before the clash damage step.<br>
Target Avatar gains Overflow and gets +X/+0 until end of turn, where X is its Action. At the beginning of the next end step, decommission that Avatar if it attacked this turn.

**Flavor:** *A deadline became a punchline the moment Committed Growth landed.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** A transaction input identifies a previous output by transaction id and index.
**Primary source:** https://developer.bitcoin.org/reference/transactions.html#txin-a-transaction-input-non-coinbase

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only before the clash damage step” without characters.

---

### E1-188 · Shillie, Multisource Scout

**Avatar — Operator** · Cost **B** · Rare · **0/1**

**Character:** Shillie

Broadcast<br>
Commit: generate 1 Resource of any affinity.

**Flavor:** *The coffee went cold, but the relay stayed warm for Multisource Scout.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Generates extra Resources for larger plays.

**Protocol Note · metadata:** A transaction input identifies a previous output by transaction id and index.
**Primary source:** https://developer.bitcoin.org/reference/transactions.html#txin-a-transaction-input-non-coinbase

**Art direction:** Shillie turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-189 · Obfuscated Formation

**Zap** · Cost **B** · Uncommon


Play only before blockers are declared. You split your attacking Avatars into piles. The defending player chooses which pile each blocker can block.

**Flavor:** *The Network said now, and Obfuscated Formation did not ask which timezone.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** A transaction output pairs a bitcoin value with a locking script.
**Primary source:** https://developer.bitcoin.org/reference/transactions.html#txout-a-transaction-output

**Art direction:** A precise burst of network action visualizes “Play only before blockers are declared. You split your attacking Avatars into piles. The defending player chooses which pile each blocker can block” without characters.

---

### E1-190 · Human Hashrate

**Operation** · Cost **BB** · Uncommon


Until end of turn, any time you could activate a Resource ability, you may pay 1 Uptime. If you do, generate 1 neutral Resource.

**Flavor:** *Nothing was improvised except the celebratory snack after Human Hashrate.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** A transaction output pairs a bitcoin value with a locking script.
**Primary source:** https://developer.bitcoin.org/reference/transactions.html#txout-a-transaction-output

**Art direction:** A coordinated network-wide event visualizes “Until end of turn, any time you could activate a Resource ability, you may pay 1 Uptime. If you do, generate 1 neutral Resource” without characters.

---

### E1-191 · Mtoshi, Lethal Courier

**Avatar — Operator** · Cost **3BB** · Rare · **2/4**

**Character:** Mtoshi

Broadcast<br>
Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar, decommission that Avatar at end of clash.

**Flavor:** *The Queue behaved all afternoon under Lethal Courier's suspiciously polite stare.*

**Simple Guide · metadata:** Removes a card from the Network. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** A Bitcoin transaction fee equals total input value minus total output value.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** Mtoshi turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-192 · Longy, Deep Node

**Avatar — Node** · Cost **4BB** · Common · **6/4**

**Character:** Longy

No special ability.

**Flavor:** *Someone said impossible; Deep Node heard needs one more adapter.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** A Bitcoin transaction fee equals total input value minus total output value.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** Longy turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-193 · Tobo, First-Strike Archer

**Avatar — Operator** · Cost **1B** · Rare · **2/1**

**Character:** Tobo

First Strike — deals clash damage before Avatars without First Strike.

**Flavor:** *The outage brought drama, while First-Strike Archer brought a multimeter.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A coinbase output must mature for 100 blocks before it can be spent.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#coinbase-input-the-input-of-the-first-transaction-in-a-block

**Art direction:** Tobo turns “First Strike — deals clash damage before Avatars without First Strike” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-194 · Fast Channel

**Protocol** · Cost **B** · Rare


You may play any number of Resources on each of your turns.<br>
Whenever you play a Resource, if it wasn't the first Resource you played this turn, this Protocol deals 1 damage to you.

**Flavor:** *The boring path became the reliable path under Fast Channel.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A coinbase output must mature for 100 blocks before it can be spent.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#coinbase-input-the-input-of-the-first-transaction-in-a-block

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “You may play any number of Resources on each of your turns” without characters.

---

### E1-195 · Quiet Block

**Zap** · Cost **B** · Common


Prevent all clash damage that would be dealt this turn.

**Flavor:** *Every millisecond filed paperwork after meeting Quiet Block.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-16 P2SH commits to a redeem script by its hash.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0016.mediawiki

**Art direction:** A precise burst of network action visualizes “Prevent all clash damage that would be dealt this turn” without characters.

---

### E1-196 · Arbadacarba, Natural Hashrate

**Avatar — Miner** · Cost **2BBBB** · Rare · **8/8**

**Character:** Arbadacarba

Overflow (This Avatar can deal excess clash damage to the player it's attacking.)<br>
At the beginning of your Maintenance, this Avatar deals 8 damage to you unless you pay BBBB.

**Flavor:** *Trust arrived late, so Natural Hashrate verified without it.*

**Simple Guide · metadata:** Deals or redirects damage. Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** BIP-16 P2SH commits to a redeem script by its hash.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0016.mediawiki

**Art direction:** Arbadacarba turns “Overflow (This Avatar can deal excess clash damage to the player it's attacking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-197 · BK, Feedback Grower

**Avatar — Operator** · Cost **3B** · Rare · **2/2**

**Character:** BK

Whenever this Avatar is dealt damage, put a +1/+1 marker on it.

**Flavor:** *The dashboard blinked red until it met Feedback Grower.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-141 separates witness data from legacy transaction serialization.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** BK turns “Whenever this Avatar is dealt damage, put a +1/+1 marker on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-198 · Longy, Resource Sovereign

**Avatar — Operator** · Cost **3BBB** · Rare · ***/***

**Character:** Longy

While idle, Action/Resilience equal your Bitcoin Resources; while attacking, they equal the defender's. Commit: target Resource is Bitcoin while Longy remains.

**Flavor:** *No cape was required, though Resource Sovereign did bring spare batteries.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** BIP-141 separates witness data from legacy transaction serialization.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** Longy turns “As long as Longy, Resource Sovereign isn't attacking, its Action and Resilience are each equal to the number of Bitcoin Resources you control. As long as Longy, Resource Sovereign is attacking, its Action and Resilience are each equal to the number of Bitcoin Resources defending player controls” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-199 · Number Go Up

**Zap** · Cost **B** · Common


Target Avatar gets +3 Action and +3 Resilience until end of turn.

**Flavor:** *The shortest meeting on record had one agenda item: Number Go Up.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** SegWit prevents witness changes from altering the legacy transaction id.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** A precise burst of network action visualizes “Target Avatar gets +3 Action and +3 Resilience until end of turn” without characters.

---

### E1-200 · Shillie, Mesh Sentinel

**Avatar — Guardian** · Cost **3B** · Common · **2/4**

**Character:** Shillie

Broadcast Guard (This Avatar can block Avatars with Broadcast.)

**Flavor:** *The bug filed a retreat notice when Mesh Sentinel opened the logs.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** SegWit prevents witness changes from altering the legacy transaction id.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** Shillie turns “Broadcast Guard (This Avatar can block Avatars with Broadcast.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-201 · BK, Bear Market Builder

**Avatar — Builder** · Cost **1B** · Common · **2/2**

**Character:** BK

Whenever you play a Resource, you may pay 2. If you do, draw a card.

**Flavor:** *Consensus took minutes; Bear Market Builder's cable labels took seconds.*

**Simple Guide · metadata:** A cheap body that turns your Resource for the turn into a card: play a Resource, pay 2, draw. One extra card a turn for as long as BK survives.

**Protocol Note · metadata:** A SegWit block commits to witness data through its coinbase transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** BK turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-202 · Network Storm

**Operation** · Cost **XB** · Uncommon


Network Storm deals X damage to each Avatar with Broadcast and each player.

**Flavor:** *The rollout had a rollback and both approved Network Storm.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** A SegWit block commits to witness data through its coinbase transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Network Storm deals X damage to each Avatar with Broadcast and each player” without characters.

---

### E1-203 · Resource Freeze

**Operation** · Cost **2B** · Uncommon


Decommission target Resource.

**Flavor:** *Every moving part received an introduction during Resource Freeze.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-173 Bech32 strings use a human-readable prefix and checksum.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-204 · Instant Boot

**Protocol — Attachment** · Cost **B** · Uncommon


Attach to Avatar<br>
Attached Avatar may attack as though it did not have Boot Delay.<br>
0: unlock attached Avatar. Activate only during your turn and only once each turn.

**Flavor:** *Everyone brought assumptions, but Instant Boot brought a specification.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** BIP-173 Bech32 strings use a human-readable prefix and checksum.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-205 · Mtoshi, Rooted Node

**Avatar — Node** · Cost **4B** · Common · **3/5**

**Character:** Mtoshi

No special ability.

**Flavor:** *The edge feels like home when Rooted Node has the keys.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-350 assigns Bech32m to witness versions 1 through 16.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki

**Art direction:** Mtoshi turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-206 · Migrating Workload

**Protocol — Attachment** · Cost **1BB** · Rare


Attach to Resource<br>
When attached Resource becomes committed, decommission it. That Resource's controller may attach this Attachment to a Resource of their choice.

**Flavor:** *The exception asked for permission before approaching Migrating Workload.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-350 assigns Bech32m to witness versions 1 through 16.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-207 · Tobo, Resource Unlocker

**Avatar — Operator** · Cost **2B** · Uncommon · **1/1**

**Character:** Tobo

Commit: unlock target Resource.

**Flavor:** *Even the air gap makes small talk with Resource Unlocker.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** BIP-21 defines bitcoin: URIs for payment requests.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki

**Art direction:** Tobo turns “Commit: unlock target Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-208 · Keys Invalidation

**Protocol** · Cost **BB** · Uncommon


BB: marker target Keys card on the Queue.

**Flavor:** *A sticky note achieved consensus and grew into Keys Invalidation.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-21 defines bitcoin: URIs for payment requests.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “BB: marker target Keys card on the Queue” without characters.

---

### E1-209 · Bitcoin Rewrite

**Zap** · Cost **B** · Rare


Target card on the Queue or Network card becomes Bitcoin. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *The incident channel gained one emoji and one decisive Bitcoin Rewrite.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** BIP-22 defines the getblocktemplate mining RPC.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0022.mediawiki

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Bitcoin. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-210 · Living Hardware

**Protocol — Attachment** · Cost **B** · Rare


Attach to Hardware. Damage to you adds that many vitality markers. At Maintenance, remove one to gain 1 Uptime.

**Flavor:** *Nothing says romance like deterministic behavior from Living Hardware.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-22 defines the getblocktemplate mining RPC.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0022.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-211 · Resource Awakening

**Protocol** · Cost **3B** · Rare


All Bitcoin Resources are 1/1 Avatars that are still Resources.

**Flavor:** *The meeting ended early because Resource Awakening had executable minutes.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-34 places the block height in the coinbase transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0034.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “All Bitcoin Resources are 1/1 Avatars that are still Resources” without characters.

---

### E1-212 · Arbadacarba, Grid Steward

**Avatar — Builder** · Cost **B** · Common · **1/1**

**Character:** Arbadacarba

Commit: generate 1 Bitcoin Resource.

**Flavor:** *The packet took the scenic route and still saluted Grid Steward.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-34 places the block height in the coinbase transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0034.mediawiki

**Art direction:** Arbadacarba turns “Commit: generate 1 Bitcoin Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-213 · Attention Market

**Protocol — Attachment** · Cost **1BB** · Uncommon


Attach to Avatar<br>
All Avatars able to block attached Avatar do so.

**Flavor:** *The Network slept better once Attention Market checked the locks.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-66 requires strict DER encoding for ECDSA signatures.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0066.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-214 · Topology Scan

**Zap** · Cost **B** · Rare


Look at the top three cards of target player's Stack, then put them back in any order. You may have that player shuffle.<br>
Draw a card.

**Flavor:** *Latency rehearsed an excuse, but Topology Scan had already resolved.*

**Simple Guide · metadata:** Look at the top three cards of a player's Stack and rearrange them — set up your own next draw, or bury an opponent's best card — then draw, so the scan costs you no cards.

**Protocol Note · metadata:** BIP-66 requires strict DER encoding for ECDSA signatures.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0066.mediawiki

**Art direction:** A precise burst of network action visualizes “Look at the top three cards of target player's Stack, then put them back in any order. You may have that player shuffle” without characters.

---

### E1-215 · Reboot Protocol

**Protocol — Attachment** · Cost **1B** · Common


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
B: Reboot attached Avatar. (The next time that Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *The fine print became infrastructure when Reboot Protocol entered the Network.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BIP-125 signals replaceability with an input sequence below 0xfffffffe.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-216 · Recovery Phrase

**Operation** · Cost **1B** · Uncommon


Draw two cards.

**Flavor:** *The schedule feared drift until it encountered Recovery Phrase.*

**Simple Guide · metadata:** Two cards for two Resources, no conditions. The card you reach for when your opening hand did not cooperate.

**Protocol Note · metadata:** BIP-125 signals replaceability with an input sequence below 0xfffffffe.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Return target card from your Archive to your Wallet” without characters.

---

### E1-217 · Shillie, Tiny Broadcaster

**Avatar — Broadcaster** · Cost **B** · Common · **1/1**

**Character:** Shillie

Broadcast

**Flavor:** *Uptime is a team sport, according to Tiny Broadcaster and the patched router.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BIP-152 reconstructs compact blocks from a receiver's known transactions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** Shillie turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-218 · Tobo, Bitcoin Backchanneler

**Avatar — Broadcaster** · Cost **B** · Common · **1/1**

**Character:** Tobo

Backchannel — Bitcoin (This Avatar can't be blocked while the defending player controls a Bitcoin Resource.)

**Flavor:** *The status page calmed down as soon as Bitcoin Backchanneler picked up a wrench.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** BIP-152 reconstructs compact blocks from a receiver's known transactions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** Tobo turns “Backchannel—Bitcoin (This Avatar can't be blocked as long as defending player controls a Bitcoin Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-219 · Uptime Stream

**Operation** · Cost **XB** · Common


Target player gains X Uptime.

**Flavor:** *The Network practiced once, then performed Uptime Stream without a soloist.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-157 lets clients fetch compact filters instead of every transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Target player gains X Uptime” without characters.

---

### E1-220 · Mtoshi, Finality Keeper

**Avatar — Guardian** · Cost **3BB** · Uncommon · **2/4**

**Character:** Mtoshi

Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar, decommission that Avatar at end of clash.

**Flavor:** *Nobody assigned the incident; it simply looked nervous around Finality Keeper.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-157 lets clients fetch compact filters instead of every transaction.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** Mtoshi turns “Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar, decommission that Avatar at end of clash” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-221 · BK, Mesh Pack

**Avatar — Operator** · Cost **B** · Rare · **1/1**

**Character:** BK

Mesh.

**Flavor:** *A second opinion arrived wearing Mesh Pack's tool belt.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** BIP-158 encodes basic compact filters with Golomb-coded sets.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0158.mediawiki

**Art direction:** BK turns “Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-222 · Protocol Reset

**Operation** · Cost **2B** · Common


Decommission all Protocols.

**Flavor:** *The plan left the whiteboard and returned wearing Protocol Reset.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-158 encodes basic compact filters with Golomb-coded sets.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0158.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission all Protocols” without characters.

---

### E1-223 · Timelock Outage

**Operation** · Cost **3B** · Uncommon


Decommission all Timelock Resources.

**Flavor:** *Every checklist box stood a little straighter for Timelock Outage.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-133 feefilter messages announce a peer's minimum transaction feerate.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0133.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission all Timelock Resources” without characters.

---

### E1-224 · Arbadacarba, Protocol Gardener

**Avatar — Operator** · Cost **1BB** · Rare · **0/2**

**Character:** Arbadacarba

Whenever you play a Protocol card on the Queue, you may draw a card.

**Flavor:** *The runbook says stay calm, and Protocol Gardener added label your cables.*

**Simple Guide · metadata:** Puts more cards in your Wallet.

**Protocol Note · metadata:** BIP-133 feefilter messages announce a peer's minimum transaction feerate.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0133.mediawiki

**Art direction:** Arbadacarba turns “Whenever you play a Protocol card on the Queue, you may draw a card” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-225 · Longy, Thorn Firewall

**Avatar — Firewall** · Cost **2B** · Uncommon · **2/3**

**Character:** Longy

Firewall (This Avatar can't attack.)<br>
B: Reboot this Avatar.

**Flavor:** *Even the fallback plan has a fallback when Thorn Firewall joins the call.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** BIP-130 sendheaders asks peers to announce new blocks by header.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0130.mediawiki

**Art direction:** Longy turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-226 · Shillie, Cold Firewall

**Avatar — Firewall** · Cost **2B** · Uncommon · **0/7**

**Character:** Shillie

Firewall (This Avatar can't attack.)

**Flavor:** *The Network asked for a hero; Cold Firewall submitted a tested patch.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-130 sendheaders asks peers to announce new blocks by header.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0130.mediawiki

**Art direction:** Shillie turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-227 · Tobo, Wooden Firewall

**Avatar — Firewall** · Cost **B** · Common · **0/3**

**Character:** Tobo

Firewall (This Avatar can't attack.)

**Flavor:** *Every antenna found its horizon when Wooden Firewall climbed the roof.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-159 defines NODE_NETWORK_LIMITED for nodes serving recent blocks.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0159.mediawiki

**Art direction:** Tobo turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-228 · Restless Client

**Protocol — Attachment** · Cost **2B** · Uncommon


Attach to Avatar<br>
At the beginning of the Maintenance of attached Avatar's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Every rule has an edge case; Restless Client packed it a lunch.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-159 defines NODE_NETWORK_LIMITED for nodes serving recent blocks.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0159.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-229 · BK, Heavy Settler

**Avatar — Operator** · Cost **3B** · Common · **3/3**

**Character:** BK

Overflow

**Flavor:** *The coffee went cold, but the relay stayed warm for Heavy Settler.*

**Simple Guide · metadata:** Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** BIP-339 negotiates transaction relay using witness transaction ids.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0339.mediawiki

**Art direction:** BK turns “Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-230 · Mesh Upgrade

**Protocol — Attachment** · Cost **B** · Rare


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
Attached Avatar gets +0 Action and +2 Resilience and has Broadcast Guard. (It can block Avatars with Broadcast.)

**Flavor:** *The whiteboard stopped arguing after Mesh Upgrade drew the final arrow.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** BIP-339 negotiates transaction relay using witness transaction ids.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0339.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-231 · Yield Router

**Protocol — Attachment** · Cost **B** · Common


Attach to Resource<br>
Whenever attached Resource is committed for Resource, its controller generates 1 additional Bitcoin Resource.

**Flavor:** *A handshake became a habit wherever Yield Router was deployed.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin Core's mempool holds valid unconfirmed transactions.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

## Neutral / Multi-affinity

### E1-232 · Entry Fee Device

**Hardware** · Cost **2** · Rare


Whenever a Resource enters, this Hardware deals 2 damage to that Resource's controller.

**Flavor:** *A blinking light found meaningful employment inside Entry Fee Device.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** The Bitcoin whitepaper describes peer-to-peer electronic cash without a trusted third party.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “Whenever a Resource enters, this Hardware deals 2 damage to that Resource's controller” without characters.

---

### E1-233 · Basalt Battery

**Hardware** · Cost **3** · Uncommon


This Hardware doesn't unlock during your unlock step.<br>
Commit: generate 3 neutral Resources.<br>
3: unlock this Hardware.

**Flavor:** *The spare cable finally met its destiny beside Basalt Battery.*

**Simple Guide · metadata:** Generates extra Resources for larger plays. Lets a committed card become usable again.

**Protocol Note · metadata:** Bitcoin's timestamp server hashes each new record together with the previous timestamp.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “This Hardware doesn't unlock during your unlock step” without characters.

---

### E1-234 · Wallet Pressure

**Hardware** · Cost **1** · Uncommon


As this Hardware enters, choose an opponent.<br>
At the beginning of the chosen player's Maintenance, this Hardware deals X damage to that player, where X is the number of cards in their Wallet minus 4.

**Flavor:** *Nothing rattles in Wallet Pressure except one very confident screw.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin's timestamp server hashes each new record together with the previous timestamp.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “As this Hardware enters, choose an opponent” without characters.

---

### E1-235 · Resource Prism

**Hardware** · Cost **3** · Uncommon


2, Commit: generate 1 Resource of any affinity.

**Flavor:** *The workbench made room before Resource Prism even arrived.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Simplified payment verification checks headers and a Merkle branch.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “2, Commit: generate 1 Resource of any affinity” without characters.

---

### E1-236 · Chaos Kernel

**Hardware** · Cost **2** · Rare


Toss module — Commit: toss Chaos Kernel from at least one card-height above the Network. Archive each non-proxy card it touches, then archive Chaos Kernel.

**Flavor:** *A tiny fan applauds every successful cycle inside Chaos Kernel.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Simplified payment verification checks headers and a Merkle branch.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “Toss module — Commit: toss Chaos Kernel from at least one card-height above the Network. Archive each non-proxy card it touches, then archive Chaos Kernel” without characters.

---

### E1-237 · Cuddy, Clockwork Node

**Hardware Avatar — Node** · Cost **6** · Rare · **0/4**

**Character:** Cuddy

Enters with seven +1/+0 markers; remove one after it attacks or blocks.<br>
X, Commit — Maintenance: refill up to X markers, to a maximum of seven.

**Flavor:** *The Queue behaved all afternoon under Clockwork Node's suspiciously polite stare.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** The Bitcoin whitepaper recommends a new key pair for each transaction for privacy.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Cuddy turns “This Avatar enters with seven +1/+0 markers on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-238 · Damage Limiter

**Hardware** · Cost **4** · Uncommon


3, Commit: Prevent the next 2 damage that would be dealt to you this turn.

**Flavor:** *The warranty says robust; the dents on Damage Limiter say field-tested.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** The Bitcoin whitepaper recommends a new key pair for each transaction for privacy.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A practical open-source device visualizes “3, Commit: Prevent the next 2 damage that would be dealt to you this turn” without characters.

---

### E1-239 · Uptime Clock

**Hardware** · Cost **2** · Uncommon


At the beginning of each player's Maintenance, this Hardware deals 1 damage to that player.

**Flavor:** *The rubber duck approved the wiring diagram for Uptime Clock.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Hashcash prices an email stamp as a partial hash collision.
**Primary source:** https://www.hashcash.org/papers/hashcash.pdf

**Art direction:** A practical open-source device visualizes “At the beginning of each player's Maintenance, this Hardware deals 1 damage to that player” without characters.

---

### E1-240 · Timelock Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Timelock card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *One port remains unused so Timelock Receiver can claim mysterious potential.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Hashcash prices an email stamp as a partial hash collision.
**Primary source:** https://www.hashcash.org/papers/hashcash.pdf

**Art direction:** A practical open-source device visualizes “Whenever a player play a Timelock card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-241 · Resource Tombstone

**Hardware** · Cost **4** · Rare


2, Commit — Maintenance: mark target non-Keys Resource; it becomes Keys. If this is archived, at each future Maintenance remove all its marks from one marked Resource.

**Flavor:** *The rack gained both capacity and personality from Resource Tombstone.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Wei Dai's b-money described money using a collective ledger of account balances.
**Primary source:** https://nakamotoinstitute.org/library/b-money/

**Art direction:** A practical open-source device visualizes “2, Commit: put a mire marker on target non-Keys Resource. It is a Keys Resource while it has a mire marker. Use only during your Maintenance” without characters.

---

### E1-242 · Resource Exit Sensor

**Hardware** · Cost **4** · Rare


Whenever a Resource is put into an Archive from the Network, this Hardware deals 2 damage to that Resource's controller.

**Flavor:** *A screwdriver took a victory lap around Resource Exit Sensor.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** Wei Dai's b-money described money using a collective ledger of account balances.
**Primary source:** https://nakamotoinstitute.org/library/b-money/

**Art direction:** A practical open-source device visualizes “Whenever a Resource is put into an Archive from the Network, this Hardware deals 2 damage to that Resource's controller” without characters.

---

### E1-243 · Wallet Scrubber

**Hardware** · Cost **3** · Rare


3, Commit: Target player discards a card. Activate only during your turn.

**Flavor:** *The uptime graph sent a thank-you note to Wallet Scrubber.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** Nick Szabo's bit gold proposal chained proof-of-work strings by timestamp.
**Primary source:** https://nakamotoinstitute.org/library/bit-gold/

**Art direction:** A practical open-source device visualizes “3, Commit: Target player discards a card. Activate only during your turn” without characters.

---

### E1-244 · Damage Firewall

**Hardware** · Cost **3** · Rare


1: The next time an unblocked Avatar of your choice would deal clash damage to you this turn, prevent all but 1 of that damage.

**Flavor:** *Dust asked for access and was denied by Damage Firewall.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Nick Szabo's bit gold proposal chained proof-of-work strings by timestamp.
**Primary source:** https://nakamotoinstitute.org/library/bit-gold/

**Art direction:** A practical open-source device visualizes “1: The next time an unblocked Avatar of your choice would deal clash damage to you this turn, prevent all but 1 of that damage” without characters.

---

### E1-245 · Hashrate Gauntlet

**Hardware** · Cost **4** · Rare


Power Avatars get +1 Action and +1 Resilience.<br>
Whenever a Power Resource is committed for Resource, its controller generates 1 additional Power Resource.

**Flavor:** *The useful machine in the corner finally got a name: Hashrate Gauntlet.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** A Cypherpunk's Manifesto frames privacy as selective revelation.
**Primary source:** https://www.activism.net/cypherpunk/manifesto.html

**Art direction:** A practical open-source device visualizes “Power Avatars get +1 Action and +1 Resilience” without characters.

---

### E1-246 · Public Wallet Viewer

**Hardware** · Cost **1** · Uncommon


Commit: Look at target player's Wallet.

**Flavor:** *The status LED on Public Wallet Viewer only blinks in complete sentences.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** A Cypherpunk's Manifesto frames privacy as selective revelation.
**Primary source:** https://www.activism.net/cypherpunk/manifesto.html

**Art direction:** A practical open-source device visualizes “Commit: Look at target player's Wallet” without characters.

---

### E1-247 · Mesh Router

**Hardware** · Cost **1** · Rare


1, Commit: target Avatar gains Mesh this turn.

**Flavor:** *Every connector clicked on the first try around Mesh Router, allegedly.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** Chaum's blind-signature scheme lets a signer sign without seeing the message.
**Primary source:** https://chaum.com/wp-content/uploads/2022/01/Chaum-blind-signatures.PDF

**Art direction:** A practical open-source device visualizes “1, Commit: Target Avatar gains Mesh until end of turn. (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh a player controls are blocking or being blocked by an Avatar, that player divides that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” without characters.

---

### E1-248 · Open Feed

**Hardware** · Cost **2** · Rare


At the beginning of each player's draw step, if this Hardware is unlocked, that player draws an additional card.

**Flavor:** *A quiet hum is how Open Feed tells jokes.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Lets a committed card become usable again.

**Protocol Note · metadata:** Chaum's blind-signature scheme lets a signer sign without seeing the message.
**Primary source:** https://chaum.com/wp-content/uploads/2022/01/Chaum-blind-signatures.PDF

**Art direction:** A practical open-source device visualizes “At the beginning of each player's draw step, if this Hardware is unlocked, that player draws an additional card” without characters.

---

### E1-249 · Cold Storage Controller

**Hardware** · Cost **4** · Uncommon


1, Commit: commit target Hardware, Avatar, or Resource.

**Flavor:** *The breaker panel keeps a respectful distance from Cold Storage Controller.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** Haber and Stornetta linked document timestamps to reveal later tampering.
**Primary source:** https://doi.org/10.1007/3-540-38424-3_32

**Art direction:** A practical open-source device visualizes “1, Commit: commit target Hardware, Avatar, or Resource” without characters.

---

### E1-250 · Identity Mask

**Hardware** · Cost **2** · Rare


X: deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar. Turn it face up when it would deal or receive damage, or become committed. X must cover its deploy cost.

**Flavor:** *No cloud was consulted during the assembly of Identity Mask.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Haber and Stornetta linked document timestamps to reveal later tampering.
**Primary source:** https://doi.org/10.1007/3-540-38424-3_32

**Art direction:** A practical open-source device visualizes “X: deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar. Turn it face up when it would deal or receive damage, or become committed. X must cover its deploy cost” without characters.

---

### E1-251 · Power Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Power card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *The toolbox calls Power Receiver its most successful side project.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** OpenPGP packets can carry encrypted data, signatures and public keys.
**Primary source:** https://www.rfc-editor.org/rfc/rfc4880.html

**Art direction:** A practical open-source device visualizes “Whenever a player play a Power card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-252 · Signal Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Signal card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *The manual had three pages, and Signal Receiver used all of them as coasters.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** OpenPGP packets can carry encrypted data, signatures and public keys.
**Primary source:** https://www.rfc-editor.org/rfc/rfc4880.html

**Art direction:** A practical open-source device visualizes “Whenever a player play a Signal card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-253 · Damage Router

**Hardware** · Cost **4** · Rare


1: The next time a source of your choice would deal damage to target Avatar this turn, that source deals that damage to you instead.

**Flavor:** *A blinking light found meaningful employment inside Damage Router.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Tor onion services let clients connect without learning a service's network location.
**Primary source:** https://spec.torproject.org/rend-spec/introduction.html

**Art direction:** A practical open-source device visualizes “1: The next time a source of your choice would deal damage to target Avatar this turn, that source deals that damage to you instead” without characters.

---

### E1-254 · Hot Wallet Statue

**Hardware** · Cost **4** · Uncommon


2: This Hardware becomes a 3/6 Golem Hardware Avatar until end of clash. Activate only during clash.

**Flavor:** *The spare cable finally met its destiny beside Hot Wallet Statue.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Tor onion services let clients connect without learning a service's network location.
**Primary source:** https://spec.torproject.org/rend-spec/introduction.html

**Art direction:** A practical open-source device visualizes “2: This Hardware becomes a 3/6 Golem Hardware Avatar until end of clash. Activate only during clash” without characters.

---

### E1-255 · Genesis Archive

**Hardware — Archive** · Cost **4** · Rare


Commit: draw a card.

**Flavor:** *Nothing rattles in Genesis Archive except one very confident screw.*

**Simple Guide · metadata:** Four Resources up front for a card every turn after. The slow, reliable engine that makes long games winnable.

**Protocol Note · metadata:** BIP-174 PSBT separates transaction coordination from private-key custody.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “4, Commit: Draw a card” without characters.

---

### E1-256 · FLX, Unstoppable Rig

**Hardware Avatar — Node** · Cost **4** · Uncommon · **5/3**

**Character:** FLX

This Avatar attacks each clash if able.<br>
This Avatar can't be blocked by Firewalls.

**Flavor:** *Someone said impossible; Unstoppable Rig heard needs one more adapter.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** BIP-174 PSBT separates transaction coordination from private-key custody.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** FLX turns “This Avatar attacks each clash if able” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-257 · Keyed Resource Bell

**Hardware** · Cost **4** · Rare


All Keys Resources are 1/1 Keys Avatars that are still Resources.

**Flavor:** *The workbench made room before Keyed Resource Bell even arrived.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** BIP-157 compact filters support client-side transaction matching.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “All Keys Resources are 1/1 Keys Avatars that are still Resources” without characters.

---

### E1-258 · Memory Palace

**Hardware** · Cost **1** · Uncommon


You have no maximum Wallet size.<br>
If an effect causes you to discard a card, discard it, but you may put it on top of your Stack instead of into your Archive.

**Flavor:** *A tiny fan applauds every successful cycle inside Memory Palace.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** BIP-157 compact filters support client-side transaction matching.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “You have no maximum Wallet size” without characters.

---

### E1-259 · MHB, Living Firewall

**Hardware Avatar — Firewall** · Cost **4** · Uncommon · **0/6**

**Character:** MHB

Firewall (This Avatar can't attack.)<br>
1: Reboot this Avatar.

**Flavor:** *The outage brought drama, while Living Firewall brought a multimeter.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** NIP-19 encodes Nostr entities in human-readable bech32 strings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** MHB turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-260 · Boost Converter

**Hardware** · Cost **1** · Rare


Doesn't unlock normally. At Maintenance, pay 4 to unlock it. If committed at draw, it deals 1 damage to you. Commit: generate 3 neutral Resources.

**Flavor:** *The warranty says robust; the dents on Boost Converter say field-tested.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Deals or redirects damage.

**Protocol Note · metadata:** NIP-19 encodes Nostr entities in human-readable bech32 strings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “This Hardware doesn't unlock during your unlock step” without characters.

---

### E1-261 · Low-Power Mode

**Hardware** · Cost **1** · Rare


Avatars with Action 3 or greater don't unlock during their controllers' unlock steps.

**Flavor:** *The rubber duck approved the wiring diagram for Low-Power Mode.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** BOLT 4 reveals only the next routing instruction to each forwarding hop.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Avatars with Action 3 or greater don't unlock during their controllers' unlock steps” without characters.

---

### E1-262 · Bitcoin Seed

**Hardware** · Cost **0** · Rare


Commit: generate 1 Bitcoin Resource.

**Flavor:** *One port remains unused so Bitcoin Seed can claim mysterious potential.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** BOLT 4 reveals only the next routing instruction to each forwarding hop.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Bitcoin Resource” without characters.

---

### E1-263 · Keys Shard

**Hardware** · Cost **0** · Rare


Commit: generate 1 Keys Resource.

**Flavor:** *The rack gained both capacity and personality from Keys Shard.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin Core descriptors describe whole families of wallet scripts.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Keys Resource” without characters.

---

### E1-264 · Signal Beacon

**Hardware** · Cost **0** · Rare


Commit: generate 1 Signal Resource.

**Flavor:** *A screwdriver took a victory lap around Signal Beacon.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin Core descriptors describe whole families of wallet scripts.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Signal Resource” without characters.

---

### E1-265 · Power Cell

**Hardware** · Cost **0** · Rare


Commit: generate 1 Power Resource.

**Flavor:** *The uptime graph sent a thank-you note to Power Cell.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin Core signet is a test network with a configurable block-signing challenge.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Power Resource” without characters.

---

### E1-266 · Timelock Crystal

**Hardware** · Cost **0** · Rare


Commit: generate 1 Timelock Resource.

**Flavor:** *Dust asked for access and was denied by Timelock Crystal.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin Core signet is a test network with a configurable block-signing challenge.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Timelock Resource” without characters.

---

### E1-267 · Network Reset Disk

**Hardware** · Cost **4** · Rare


This Hardware enters committed.<br>
1, Commit: decommission all Hardware, Avatars, and Protocols.

**Flavor:** *The useful machine in the corner finally got a name: Network Reset Disk.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin Core regtest gives local tests complete control over block production.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** A practical open-source device visualizes “This Hardware enters committed” without characters.

---

### E1-268 · Michael1011, Obsidian Node

**Hardware Avatar — Node** · Cost **6** · Uncommon · **4/6**

**Character:** Michael1011

No special ability.

**Flavor:** *Trust arrived late, so Obsidian Node verified without it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin Core regtest gives local tests complete control over block production.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/developer-notes.md

**Art direction:** Michael1011 turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-269 · Fault Injector

**Hardware** · Cost **4** · Uncommon


3, Commit: This Hardware deals 1 damage to any target.

**Flavor:** *The status LED on Fault Injector only blinks in complete sentences.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** AssumeUTXO can make a node usable while historical validation continues.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** A practical open-source device visualizes “3, Commit: This Hardware deals 1 damage to any target” without characters.

---

### E1-270 · Genesis Ring

**Hardware** · Cost **1** · Uncommon


Commit: generate 2 neutral Resources.

**Flavor:** *Every connector clicked on the first try around Genesis Ring, allegedly.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** AssumeUTXO can make a node usable while historical validation continues.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/doc/assumeutxo.md

**Art direction:** A practical open-source device visualizes “Commit: generate 2 neutral Resources” without characters.

---

### E1-271 · Archive Listener

**Hardware** · Cost **1** · Uncommon


Whenever an Avatar is decommissioned, you may pay 2. If you do, draw a card.

**Flavor:** *A quiet hum is how Archive Listener tells jokes.*

**Simple Guide · metadata:** One Resource to deploy. After that every Avatar that leaves the Network — yours or theirs — offers you a card for 2.

**Protocol Note · metadata:** BIP-39 mnemonic words encode entropy plus a checksum.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A practical open-source device visualizes “Whenever an Avatar is decommissioned, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-272 · Resource Converter

**Hardware** · Cost **3** · Rare


You may spend Signal Resource as though it were Power Resource.

**Flavor:** *The breaker panel keeps a respectful distance from Resource Converter.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** BIP-39 mnemonic words encode entropy plus a checksum.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A practical open-source device visualizes “You may spend Signal Resource as though it were Power Resource” without characters.

---

### E1-273 · Swarm Node

**Hardware** · Cost **5** · Rare


5, Commit: create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast. Name it Swarm Drone.

**Flavor:** *No cloud was consulted during the assembly of Swarm Node.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** BIP-32 extended public keys derive watch-only address branches.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A practical open-source device visualizes “5, Commit: create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast. Name it Swarm Drone” without characters.

---

### E1-274 · Keys Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Keys card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *The toolbox calls Keys Receiver its most successful side project.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** BIP-32 extended public keys derive watch-only address branches.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A practical open-source device visualizes “Whenever a player play a Keys card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-275 · Timelock Vault

**Hardware** · Cost **2** · Rare


Timelock Vault enters committed. It does not unlock normally. You may skip a turn to unlock it. Commit: after this turn, take one additional turn.

**Flavor:** *The manual had three pages, and Timelock Vault used all of them as coasters.*

**Simple Guide · metadata:** Gives you another full turn after this one. Lets a committed card become usable again.

**Protocol Note · metadata:** BIP-85 derives repeatable child entropy without storing extra random seeds.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki

**Art direction:** A practical open-source device visualizes “Timelock Vault enters committed. It does not unlock normally. You may skip a turn to unlock it. Commit: after this turn, take one additional turn” without characters.

---

### E1-276 · Difficulty Winter

**Hardware** · Cost **2** · Rare


As long as this Hardware is unlocked, players can't unlock more than one Resource during their unlock steps.

**Flavor:** *A blinking light found meaningful employment inside Difficulty Winter.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** BIP-85 derives repeatable child entropy without storing extra random seeds.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki

**Art direction:** A practical open-source device visualizes “As long as this Hardware is unlocked, players can't unlock more than one Resource during their unlock steps” without characters.

---

### E1-277 · Bitcoin Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Bitcoin card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *The spare cable finally met its destiny beside Bitcoin Receiver.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** NIP-11 relay documents can advertise software, policy and supported NIPs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/11.md

**Art direction:** A practical open-source device visualizes “Whenever a player play a Bitcoin card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-278 · Power–Keys Junction

**Resource — Keys / Power** · Cost **—** · Rare


Commit: generate 1 Keys or 1 Power.

**Flavor:** *The edge became a neighborhood after Power–Keys Junction switched on.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** NIP-11 relay documents can advertise software, policy and supported NIPs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/11.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys or 1 Power” without characters.

---

### E1-279 · Keys–Bitcoin Junction

**Resource — Keys / Bitcoin** · Cost **—** · Rare


Commit: generate 1 Keys or 1 Bitcoin.

**Flavor:** *A local cable found global purpose through Keys–Bitcoin Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** NIP-78 stores application-specific data in replaceable events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/78.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys or 1 Bitcoin” without characters.

---

### E1-280 · Power–Signal Junction

**Resource — Power / Signal** · Cost **—** · Rare


Commit: generate 1 Power or 1 Signal.

**Flavor:** *The commons keeps the kettle warm beside Power–Signal Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** NIP-78 stores application-specific data in replaceable events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/78.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power or 1 Signal” without characters.

---

### E1-281 · Bitcoin–Signal Junction

**Resource — Bitcoin / Signal** · Cost **—** · Rare


Commit: generate 1 Bitcoin or 1 Signal.

**Flavor:** *No permission slip was harmed while building Bitcoin–Signal Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** BOLT 8 derives fresh transport keys during its authenticated handshake.
**Primary source:** https://github.com/lightning/bolts/blob/master/08-transport.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin or 1 Signal” without characters.

---

### E1-282 · Signal–Keys Junction

**Resource — Signal / Keys** · Cost **—** · Rare


Commit: generate 1 Signal or 1 Keys.

**Flavor:** *The shortest route to abundance runs through Signal–Keys Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** BOLT 8 derives fresh transport keys during its authenticated handshake.
**Primary source:** https://github.com/lightning/bolts/blob/master/08-transport.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal or 1 Keys” without characters.

---

### E1-283 · Power–Bitcoin Junction

**Resource — Power / Bitcoin** · Cost **—** · Rare


Commit: generate 1 Power or 1 Bitcoin.

**Flavor:** *The lights stayed on and credited Power–Bitcoin Junction, plus sensible maintenance.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** BIP-152 compact blocks save bandwidth by sending short transaction identifiers.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power or 1 Bitcoin” without characters.

---

### E1-284 · Bitcoin–Timelock Junction

**Resource — Bitcoin / Timelock** · Cost **—** · Rare


Commit: generate 1 Bitcoin or 1 Timelock.

**Flavor:** *A spare watt found honest work inside Bitcoin–Timelock Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** BIP-152 compact blocks save bandwidth by sending short transaction identifiers.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0152.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin or 1 Timelock” without characters.

---

### E1-285 · Signal–Timelock Junction

**Resource — Signal / Timelock** · Cost **—** · Rare


Commit: generate 1 Signal or 1 Timelock.

**Flavor:** *The Network planted one seed and labeled it Signal–Timelock Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** A reproducible build lets independent builders compare resulting binaries.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/contrib/guix/README.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal or 1 Timelock” without characters.

---

### E1-286 · Timelock–Keys Junction

**Resource — Timelock / Keys** · Cost **—** · Rare


Commit: generate 1 Timelock or 1 Keys.

**Flavor:** *Every route needs a junction, and this one answers to Timelock–Keys Junction.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** A reproducible build lets independent builders compare resulting binaries.
**Primary source:** https://github.com/bitcoin/bitcoin/blob/master/contrib/guix/README.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock or 1 Keys” without characters.

---

## Signal

### E1-287 · Signal Commons — Sunrise

**Basic Resource — Signal** · Cost **—** · Common


Commit: generate 1 Signal.

**Flavor:** *The neighborhood gained one more useful sunrise from Signal Commons — Sunrise.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Signal.

**Protocol Note · metadata:** NIP-57 defines signed zap receipts as kind 9735 events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal” without characters.

---

### E1-288 · Signal Commons — Rooftop

**Basic Resource — Signal** · Cost **—** · Common


Commit: generate 1 Signal.

**Flavor:** *Capacity became a shared verb around Signal Commons — Rooftop.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Signal.

**Protocol Note · metadata:** NIP-65 stores preferred relay lists in kind 10002 events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/65.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal” without characters.

---

## Timelock

### E1-289 · Timelock Channel — Dawn

**Basic Resource — Timelock** · Cost **—** · Common


Commit: generate 1 Timelock.

**Flavor:** *Useful capacity grows wherever Timelock Channel — Dawn gets a clean connection.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Timelock.

**Protocol Note · metadata:** Lightning moves bitcoin off-chain by cooperation while retaining on-chain enforcement.
**Primary source:** https://github.com/lightning/bolts/blob/master/00-introduction.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock” without characters.

---

### E1-290 · Timelock Channel — Midnight

**Basic Resource — Timelock** · Cost **—** · Common


Commit: generate 1 Timelock.

**Flavor:** *The edge became a neighborhood after Timelock Channel — Midnight switched on.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Timelock.

**Protocol Note · metadata:** Lightning moves bitcoin off-chain by cooperation while retaining on-chain enforcement.
**Primary source:** https://github.com/lightning/bolts/blob/master/00-introduction.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock” without characters.

---

## Keys

### E1-291 · Key Vault — Workshop

**Basic Resource — Keys** · Cost **—** · Common


Commit: generate 1 Keys.

**Flavor:** *A local cable found global purpose through Key Vault — Workshop.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Keys.

**Protocol Note · metadata:** BIP-129 gives multisig wallets a common setup-file format.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0129.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys” without characters.

---

### E1-292 · Key Vault — Cold Room

**Basic Resource — Keys** · Cost **—** · Common


Commit: generate 1 Keys.

**Flavor:** *The commons keeps the kettle warm beside Key Vault — Cold Room.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Keys.

**Protocol Note · metadata:** BIP-129 gives multisig wallets a common setup-file format.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0129.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys” without characters.

---

## Power

### E1-293 · Power Plant — Solar

**Basic Resource — Power** · Cost **—** · Common


Commit: generate 1 Power.

**Flavor:** *No permission slip was harmed while building Power Plant — Solar.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Power.

**Protocol Note · metadata:** Block templates expose the target a miner must satisfy.
**Primary source:** https://developer.bitcoin.org/reference/rpc/getblocktemplate.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power” without characters.

---

### E1-294 · Power Plant — Hydro

**Basic Resource — Power** · Cost **—** · Common


Commit: generate 1 Power.

**Flavor:** *The shortest route to abundance runs through Power Plant — Hydro.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Power.

**Protocol Note · metadata:** Block templates expose the target a miner must satisfy.
**Primary source:** https://developer.bitcoin.org/reference/rpc/getblocktemplate.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power” without characters.

---

## Bitcoin

### E1-295 · Satoshi Orchard — Commons

**Basic Resource — Bitcoin** · Cost **—** · Common


Commit: generate 1 Bitcoin.

**Flavor:** *The lights stayed on and credited Satoshi Orchard — Commons, plus sensible maintenance.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Bitcoin.

**Protocol Note · metadata:** Bitcoin Core's mempool holds valid unconfirmed transactions.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin” without characters.

---
