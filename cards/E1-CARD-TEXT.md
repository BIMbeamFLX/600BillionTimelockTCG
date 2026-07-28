# 600B Timelock TCG — Edition One Complete Card Text

Text version: `E1.0-text-lock`
Cards: **295**
Status: **TEXT + FLAVOR LOCKED**

Only rules and short italic flavor appear on the card face. Simple Guides,
Protocol Notes, sources and art prompts remain digital game metadata.

## Neutral / Multi-affinity

### E1-001 · Genesis Lotus

**Hardware** · Cost **0** · Rare


Commit and archive Genesis Lotus: generate three Resources of one affinity.

**Flavor:** *Genesis Lotus. No permission. Just builders.*

**Simple Guide · metadata:** Moves a card into an Archive. Generates extra Resources for larger plays.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Commit and archive Genesis Lotus: generate three Resources of one affinity” without characters.

---

## Bitcoin

### E1-002 · Satoshi Orchard

**Basic Resource — Bitcoin** · Cost **—** · Common


Commit: generate 1 Bitcoin.

**Flavor:** *Satoshi Orchard. Real capacity. Shared freely.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Bitcoin.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin” without characters.

---

## Signal

### E1-003 · FLX, Culture Curator

**Avatar — Operator** · Cost **3SS** · Uncommon · **4/4**

**Character:** FLX

Broadcast<br>
FLX stays unlocked after attacking.

**Flavor:** *Culture Curator. Culture is a protocol too.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Lets a committed card become usable again.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** FLX turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Power

### E1-004 · Zap

**Zap** · Cost **P** · Common


Zap deals 3 damage to any target.

**Flavor:** *Zap. One clean move. Zero committees.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** A precise burst of network action visualizes “Zap deals 3 damage to any target” without characters.

---

## Timelock

### E1-005 · Next Block

**Operation** · Cost **1T** · Rare


After this turn, take one additional turn.

**Flavor:** *Next Block. Good vibes ship on schedule.*

**Simple Guide · metadata:** Gives you another full turn after this one.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A coordinated network-wide event visualizes “After this turn, take one additional turn” without characters.

---

## Keys

### E1-006 · Multisig Quorum

**Protocol** · Cost **1K** · Rare


Keys Avatars get +1 Action and +1 Resilience.

**Flavor:** *Multisig Quorum. Consensus looks good on us.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Keys Avatars get +1 Action and +1 Resilience” without characters.

---

## Signal

### E1-007 · Firmware for Firewalls

**Protocol — Attachment** · Cost **S** · Rare


Attach to Wall<br>
Attached Wall can attack as though it didn't have Firewall.

**Flavor:** *Firmware for Firewalls. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Wall” without characters.

---

### E1-008 · Grid Reset

**Operation** · Cost **3S** · Rare


Decommission all Resources.

**Flavor:** *Grid Reset. Big move. Open rails.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A coordinated network-wide event visualizes “Decommission all Resources” without characters.

---

### E1-009 · Fair State

**Operation** · Cost **1S** · Rare


Each player chooses a number of Resources they control equal to the number of Resources controlled by the player who controls the fewest, then archives the rest. Players discard cards and archive Avatars the same way.

**Flavor:** *Fair State. Good vibes ship on schedule.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** A coordinated network-wide event visualizes “Each player chooses a number of Resources they control equal to the number of Resources controlled by the player who controls the fewest, then archives the rest. Players discard cards and archive Avatars the same way” without characters.

---

### E1-010 · Cuddy, Signal Organizer

**Avatar — Operator** · Cost **S** · Common · **1/1**

**Character:** Cuddy

Mesh.

**Flavor:** *Signal Organizer. Culture is a protocol too.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** Cuddy turns “Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-011 · Keys Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Keys. This effect doesn't remove this Attachment.

**Flavor:** *Keys Shield. The good path stays inspectable.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-012 · Last Broadcast

**Zap** · Cost **S** · Rare


Play this card on the Queue only during clash before blockers are declared.<br>
Target Avatar defending player controls can block any number of Avatars this turn. It blocks each attacking Avatar this turn if able.

**Flavor:** *Last Broadcast. One clean move. Zero committees.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during clash before blockers are declared” without characters.

---

### E1-013 · Shared Uptime

**Protocol — Attachment** · Cost **SS** · Rare


Attach to Avatar<br>
S: attached Avatar gets +1 Action and +1 Resilience until end of turn.

**Flavor:** *Shared Uptime. Verify the rails. Then ride.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-014 · Timelock Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Timelock. This effect doesn't remove this Attachment.

**Flavor:** *Timelock Shield. Consensus looks good on us.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-015 · Local Citadel

**Protocol** · Cost **3S** · Uncommon


Unlocked Avatars you control get +0 Action and +2 Resilience.

**Flavor:** *Local Citadel. Trust less. Coordinate more.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Unlocked Avatars you control get +0 Action and +2 Resilience” without characters.

---

### E1-016 · Timelock Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Timelock source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *Timelock Protection Circuit. The good path stays inspectable.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Timelock source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-017 · Bitcoin Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Bitcoin source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *Bitcoin Protection Circuit. Open rules. Strong network.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Bitcoin source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-018 · Power Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Power source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *Power Protection Circuit. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Power source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-019 · Signal Protection Circuit

**Protocol** · Cost **1S** · Common


1: The next time a Signal source of your choice would deal damage to you this turn, prevent that damage.

**Flavor:** *Signal Protection Circuit. Consensus looks good on us.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “1: The next time a Signal source of your choice would deal damage to you this turn, prevent that damage” without characters.

---

### E1-020 · Hardened Resource

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Resource<br>
Attached Resource has indestructible and can't be attached by other Attachments.

**Flavor:** *Hardened Resource. Trust less. Coordinate more.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-021 · Grid Conversion

**Protocol** · Cost **2SS** · Uncommon


At the beginning of your Maintenance, archive this Protocol unless you pay SS.<br>
All Power Resources are Signal Resource.

**Flavor:** *Grid Conversion. The good path stays inspectable.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of your Maintenance, archive this Protocol unless you pay SS” without characters.

---

### E1-022 · Public Goods Drive

**Protocol** · Cost **SS** · Rare


Signal Avatars get +1 Action and +1 Resilience.

**Flavor:** *Public Goods Drive. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Signal Avatars get +1 Action and +1 Resilience” without characters.

---

### E1-023 · Emergency Reboot

**Zap** · Cost **S** · Common


Reboot target Avatar.

**Flavor:** *Emergency Reboot. Fast signal. Final energy.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A precise burst of network action visualizes “Reboot target Avatar” without characters.

---

### E1-024 · Protocol Cleanup

**Zap** · Cost **1S** · Common


Decommission target Hardware or Protocol.

**Flavor:** *Protocol Cleanup. Send it. The network knows.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** A precise burst of network action visualizes “Decommission target Hardware or Protocol” without characters.

---

### E1-025 · Home Miner

**Protocol — Attachment** · Cost **SSS** · Rare


Attach to Resource<br>
Attached Resource has "At the beginning of your Maintenance, you may pay SS. If you do, you gain 1 Uptime."

**Flavor:** *Home Miner. Trust less. Coordinate more.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-026 · Bitcoin Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Bitcoin. This effect doesn't remove this Attachment.

**Flavor:** *Bitcoin Shield. The good path stays inspectable.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-027 · Guardian Signal

**Zap** · Cost **XS** · Common


Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay 1 any time you could play an Zap. If you do, prevent the next 1 damage that would be dealt to that Network card or player this turn.

**Flavor:** *Guardian Signal. One clean move. Zero committees.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** A precise burst of network action visualizes “Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay 1 any time you could play an Zap. If you do, prevent the next 1 damage that would be dealt to that Network card or player this turn” without characters.

---

### E1-028 · Repair Packet

**Zap** · Cost **S** · Common


Choose one —<br>
• Target player gains 3 Uptime.<br>
• Prevent the next 3 damage that would be dealt to any target this turn.

**Flavor:** *Repair Packet. Fast signal. Final energy.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-029 · Hardened Identity

**Protocol — Attachment** · Cost **S** · Common


Attach to Avatar<br>
Attached Avatar gets +0 Action and +2 Resilience.<br>
S: attached Avatar gets +0 Action and +1 Resilience until end of turn.

**Flavor:** *Hardened Identity. Consensus looks good on us.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-030 · Community Strength

**Protocol — Attachment** · Cost **S** · Common


Attach to Avatar<br>
Attached Avatar gets +1 Action and +2 Resilience.

**Flavor:** *Community Strength. Trust less. Coordinate more.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-031 · Offline Sanctuary

**Protocol** · Cost **1S** · Rare


If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by Avatars with Broadcast and/or Backchannel—Timelock.

**Flavor:** *Offline Sanctuary. The good path stays inspectable.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by Avatars with Broadcast and/or Backchannel—Timelock” without characters.

---

### E1-032 · Consequence Ledger

**Protocol** · Cost **2SS** · Uncommon


At the beginning of each player's Maintenance, this Protocol deals damage to that player equal to the number of Keys Resources they control.

**Flavor:** *Consequence Ledger. Open rules. Strong network.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of each player's Maintenance, this Protocol deals damage to that player equal to the number of Keys Resources they control” without characters.

---

### E1-033 · Fast Path

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has First Strike.

**Flavor:** *Fast Path. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-034 · Sat, Relay Rider

**Avatar — Broadcaster** · Cost **1S** · Common · **1/1**

**Character:** Sat

Broadcast; Mesh.

**Flavor:** *Relay Rider. Make it real. Keep it open.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** Sat turns “Broadcast; Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-035 · MHB, Keys Auditor

**Avatar — Signer** · Cost **2SS** · Rare · **3/3**

**Character:** MHB

SS, Commit: decommission target Keys Network card.

**Flavor:** *Keys Auditor. Culture is a protocol too.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** MHB turns “SS, Commit: decommission target Keys Network card” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-036 · Morgs, Friendly Fork

**Avatar — Operator** · Cost **2S** · Common · **2/2**

**Character:** Morgs

No special ability.

**Flavor:** *Friendly Fork. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** Morgs turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-037 · AJ, Uptime Anchor

**Avatar — Operator** · Cost **3SSS** · Rare · **6/6**

**Character:** AJ

0: The next 1 damage that would be dealt to this Avatar this turn is dealt to its owner instead. Only this Avatar's owner may activate this ability.<br>
When this Avatar is decommissioned, its owner loses half their Uptime, rounded up.

**Flavor:** *Uptime Anchor. Bullish on builders.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** AJ turns “0: The next 1 damage that would be dealt to this Avatar this turn is dealt to its owner instead. Only this Avatar's owner may activate this ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-038 · Signal Rewrite

**Zap** · Cost **S** · Rare


Target card on the Queue or Network card becomes Signal. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *Signal Rewrite. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Signal. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-039 · Power Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Power. This effect doesn't remove this Attachment.

**Flavor:** *Power Shield. Consensus looks good on us.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-040 · Archive Restore

**Operation** · Cost **2SS** · Uncommon


Return target Avatar card from your Archive to the Network.

**Flavor:** *Archive Restore. Turn the plan into a signal.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** A coordinated network-wide event visualizes “Return target Avatar card from your Archive to the Network” without characters.

---

### E1-041 · Damage Refund

**Zap** · Cost **1SS** · Rare


The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain Uptime equal to the damage prevented this way.

**Flavor:** *Damage Refund. YOLO, but verify.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A precise burst of network action visualizes “The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain Uptime equal to the damage prevented this way” without characters.

---

### E1-042 · Courage Under Load

**Zap** · Cost **S** · Rare


Target blocking Avatar gets +7 Action and +7 Resilience until end of turn.

**Flavor:** *Courage Under Load. One clean move. Zero committees.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** A precise burst of network action visualizes “Target blocking Avatar gets +7 Action and +7 Resilience until end of turn” without characters.

---

### E1-043 · AJ, First Responder

**Avatar — Operator** · Cost **1S** · Common · **1/1**

**Character:** AJ

Commit: Prevent the next 1 damage that would be dealt to any target this turn.

**Flavor:** *First Responder. Good signal. Strong hands.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** AJ turns “Commit: Prevent the next 1 damage that would be dealt to any target this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-044 · Cuddy, Fast Starter

**Avatar — Operator** · Cost **S** · Rare · **2/1**

**Character:** Cuddy

No special ability.

**Flavor:** *Fast Starter. Make it real. Keep it open.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** Cuddy turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-045 · Peaceful Exit

**Zap** · Cost **S** · Uncommon


Cold Storage target Avatar. Its controller gains Uptime equal to its Action.

**Flavor:** *Peaceful Exit. YOLO, but verify.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** A precise burst of network action visualizes “Cold Storage target Avatar. Its controller gains Uptime equal to its Action” without characters.

---

### E1-046 · MHB, Community Shield

**Avatar — Guardian** · Cost **3SS** · Rare · **2/5**

**Character:** MHB

As long as this Avatar is unlocked, all damage that would be dealt to you by unblocked Avatars is dealt to this Avatar instead.

**Flavor:** *Community Shield. Bullish on builders.*

**Simple Guide · metadata:** Deals or redirects damage. Lets a committed card become usable again.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** MHB turns “As long as this Avatar is unlocked, all damage that would be dealt to you by unblocked Avatars is dealt to this Avatar instead” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-047 · Sat, Blade Firewall

**Avatar — Firewall** · Cost **3S** · Uncommon · **3/5**

**Character:** Sat

Firewall (This Avatar can't attack.)<br>
Broadcast

**Flavor:** *Blade Firewall. Good signal. Strong hands.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** NIP-25 expresses reactions as portable signed events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/25.md

**Art direction:** Sat turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-048 · Morgs, Signal Knight

**Avatar — Guardian** · Cost **SS** · Uncommon · **2/2**

**Character:** Morgs

First Strike (This Avatar deals clash damage before Avatars without First Strike.)<br>
Shielded from Keys (This Avatar can't be blocked, targeted, dealt damage, or attached by anything Keys.)

**Flavor:** *Signal Knight. Make it real. Keep it open.*

**Simple Guide · metadata:** Deals or redirects damage. Resists the named affinity.

**Protocol Note · metadata:** Nostr events are signed data; relays distribute them without owning identity.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** Morgs turns “First Strike (This Avatar deals clash damage before Avatars without First Strike.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-049 · Signal Shield

**Protocol — Attachment** · Cost **S** · Uncommon


Attach to Avatar<br>
Attached Avatar has Shielded from Signal. This effect doesn't remove this Attachment.

**Flavor:** *Signal Shield. Trust less. Coordinate more.*

**Simple Guide · metadata:** Resists the named affinity.

**Protocol Note · metadata:** A Nostr public key identifies an account across compatible clients.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-050 · Clean Slate

**Operation** · Cost **2SS** · Rare


Decommission all Avatars. They can't be regenerated.

**Flavor:** *Clean Slate. We came to build the future.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** NIP-05 links a human-readable internet identifier to a Nostr public key.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/05.md

**Art direction:** A coordinated network-wide event visualizes “Decommission all Avatars. They can't be regenerated” without characters.

---

## Timelock

### E1-051 · Michael1011, Packet Shaper

**Avatar — Operator** · Cost **3TT** · Uncommon · **4/4**

**Character:** Michael1011

Broadcast

**Flavor:** *Packet Shaper. Bullish on builders.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** Michael1011 turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-052 · First Memory

**Zap** · Cost **T** · Rare


Target player moves the top three cards of their Stack into their Wallet.

**Flavor:** *First Memory. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A precise burst of network action visualizes “Target player moves the top three cards of their Stack into their Wallet” without characters.

---

### E1-053 · Boot Hardware

**Protocol — Attachment** · Cost **3T** · Uncommon


Attach to Hardware<br>
As long as attached Hardware isn't an Avatar, it's an Hardware Avatar with Action and Resilience each equal to its total resource cost.

**Flavor:** *Boot Hardware. Consensus looks good on us.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-054 · Power Invalidation

**Zap** · Cost **T** · Common


Choose one —<br>
• marker target Power card on the Queue.<br>
• decommission target Power Network card.

**Flavor:** *Power Invalidation. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-055 · Query Burst

**Operation** · Cost **XTT** · Rare


Target player moves the top X cards of their Stack into their Wallet.

**Flavor:** *Query Burst. We came to build the future.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Target player moves the top X cards of their Stack into their Wallet” without characters.

---

### E1-056 · Benarc, Mirror Client

**Avatar — Client** · Cost **3T** · Uncommon · **0/0**

**Character:** Benarc

You may have this Avatar enter as a copy of any Avatar on the Network.

**Flavor:** *Mirror Client. Bullish on builders.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** Benarc turns “You may have this Avatar enter as a copy of any Avatar on the Network” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-057 · Remote Control

**Protocol — Attachment** · Cost **2TT** · Uncommon


Attach to Avatar<br>
You control attached Avatar.

**Flavor:** *Remote Control. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-058 · Hardware Clone

**Protocol** · Cost **1T** · Rare


You may have this Protocol enter as a copy of any Hardware on the Network, except it's a Protocol in addition to its other types.

**Flavor:** *Hardware Clone. Consensus looks good on us.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “You may have this Protocol enter as a copy of any Hardware on the Network, except it's a Protocol in addition to its other types” without characters.

---

### E1-059 · Invalid Signature

**Zap** · Cost **TT** · Uncommon


Invalidate target card on the Queue.

**Flavor:** *Invalid Signature. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue” without characters.

---

### E1-060 · Exit Fee

**Protocol — Attachment** · Cost **1T** · Common


Attach to Avatar<br>
When attached Avatar is decommissioned, this Attachment deals damage equal to that Avatar's Resilience to the Avatar's controller.

**Flavor:** *Exit Fee. The good path stays inspectable.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-061 · Buffer Drain

**Operation** · Cost **TT** · Rare


Target player activates a Resource ability of each Resource they control. Then that player loses all unspent Resource and you put the lost Resources into your Buffer.

**Flavor:** *Buffer Drain. The next block belongs to builders.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Target player activates a Resource ability of each Resource they control. Then that player loses all unspent Resource and you put the lost Resources into your Buffer” without characters.

---

### E1-062 · Relay Feedback

**Protocol — Attachment** · Cost **2T** · Uncommon


Attach to Protocol<br>
At the beginning of the Maintenance of attached Protocol's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Relay Feedback. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Protocol” without characters.

---

### E1-063 · Broadcast Upgrade

**Protocol — Attachment** · Cost **T** · Common


Attach to Avatar<br>
Attached Avatar has Broadcast.

**Flavor:** *Broadcast Upgrade. Consensus looks good on us.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-064 · Hidden Route

**Protocol — Attachment** · Cost **TT** · Common


Attach to Avatar<br>
Attached Avatar can't be blocked except by Walls.

**Flavor:** *Hidden Route. Trust less. Coordinate more.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-065 · Quick Uplink

**Zap** · Cost **T** · Common


Target Avatar gains Broadcast until end of turn.

**Flavor:** *Quick Uplink. YOLO, but verify.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Target Avatar gains Broadcast until end of turn” without characters.

---

### E1-066 · Resource Tap

**Protocol** · Cost **TT** · Uncommon


Whenever a Bitcoin Resource an opponent controls becomes committed, you gain 1 Uptime.

**Flavor:** *Resource Tap. Open rules. Strong network.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a Bitcoin Resource an opponent controls becomes committed, you gain 1 Uptime” without characters.

---

### E1-067 · Tal, Relay Captain

**Avatar — Broadcaster** · Cost **TT** · Rare · **2/2**

**Character:** Tal

Other Merfolk get +1 Action and +1 Resilience and have Backchannel—Timelock. (They can't be blocked as long as defending player controls an Timelock Resource.)

**Flavor:** *Relay Captain. Good signal. Strong hands.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** Tal turns “Other Merfolk get +1 Action and +1 Resilience and have Backchannel—Timelock. (They can't be blocked as long as defending player controls an Timelock Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-068 · Resource Rewrite

**Zap** · Cost **T** · Rare


Change the text of target card on the Queue or Network card by replacing all instances of one basic Resource type with another. (For example, you may change "Backchannel—Keys" to "Backchannel—Signal." This effect lasts indefinitely.)

**Flavor:** *Resource Rewrite. Send it. The network knows.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** A precise burst of network action visualizes “Change the text of target card on the Queue or Network card by replacing all instances of one basic Resource type with another. (For example, you may change "Backchannel—Keys" to "Backchannel—Signal." This effect lasts indefinitely.)” without characters.

---

### E1-069 · Jedai, Protocol Architect

**Avatar — Operator** · Cost **4TT** · Rare · **5/6**

**Character:** Jedai

Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)

**Flavor:** *Protocol Architect. Culture is a protocol too.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** Jedai turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-070 · Buffer Lock

**Zap** · Cost **2T** · Rare


Commit all Resources target player controls and that player loses all unspent Resource.

**Flavor:** *Buffer Lock. YOLO, but verify.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A precise burst of network action visualizes “Commit all Resources target player controls and that player loses all unspent Resource” without characters.

---

### E1-071 · Darren, Channel Operator

**Avatar — Broadcaster** · Cost **T** · Common · **1/1**

**Character:** Darren

No special ability.

**Flavor:** *Channel Operator. Bullish on builders.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Darren turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-072 · Snick, Phantom Process

**Avatar — Client** · Cost **3T** · Uncommon · **4/1**

**Character:** Snick

Broadcast<br>
At the beginning of your Maintenance, archive this Avatar unless you pay T.

**Flavor:** *Phantom Process. Good signal. Strong hands.*

**Simple Guide · metadata:** Moves a card into an Archive. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** Snick turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-073 · Resource Reclassification

**Protocol — Attachment** · Cost **TT** · Common


Attach to Resource<br>
As this Attachment enters, choose a basic Resource type.<br>
Attached Resource is the chosen type.

**Flavor:** *Resource Reclassification. Consensus looks good on us.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-074 · Tal, Ghost Router

**Avatar — Client** · Cost **3T** · Uncommon · **3/3**

**Character:** Tal

Broadcast

**Flavor:** *Ghost Router. Culture is a protocol too.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** Tal turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-075 · Darren, Channel Raider

**Avatar — Broadcaster** · Cost **4T** · Rare · **4/3**

**Character:** Darren

This Avatar can't attack unless defending player controls an Timelock Resource.<br>
Commit: This Avatar deals 1 damage to any target.<br>
When you control no Timelock Resources, archive this Avatar.

**Flavor:** *Channel Raider. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** Darren turns “This Avatar can't attack unless defending player controls an Timelock Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-076 · Maintenance Leak

**Protocol — Attachment** · Cost **1T** · Common


Attach to a Protocol.<br>
At its controller's Maintenance, this deals 2 damage to them. They may pay X Resources to prevent X of it.

**Flavor:** *Maintenance Leak. Open rules. Strong network.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Protocol” without characters.

---

### E1-077 · Fee Spike

**Zap** · Cost **XT** · Common


Invalidate target card on the Queue unless its controller pays X. If that player doesn't, they commit all Resources with Resource abilities they control and lose all unspent Resource.

**Flavor:** *Fee Spike. Fast signal. Final energy.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue unless its controller pays X. If that player doesn't, they commit all Resources with Resource abilities they control and lose all unspent Resource” without characters.

---

### E1-078 · Michael1011, Debugger

**Avatar — Operator** · Cost **2T** · Common · **1/1**

**Character:** Michael1011

Commit: This Avatar deals 1 damage to any target.

**Flavor:** *Debugger. Make it real. Keep it open.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** Michael1011 turns “Commit: This Avatar deals 1 damage to any target” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-079 · Cognitive Surge

**Zap** · Cost **2T** · Uncommon


Cognitive Surge deals 4 damage to any target and 2 damage to you.

**Flavor:** *Cognitive Surge. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A precise burst of network action visualizes “Cognitive Surge deals 4 damage to any target and 2 damage to you” without characters.

---

### E1-080 · Hot Resource

**Protocol — Attachment** · Cost **1T** · Common


Attach to Resource<br>
Whenever attached Resource becomes committed, this Attachment deals 2 damage to that Resource's controller.

**Flavor:** *Hot Resource. The good path stays inspectable.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-081 · Benarc, Deep Channel

**Avatar — Broadcaster** · Cost **5T** · Common · **5/5**

**Character:** Benarc

This Avatar can't attack unless defending player controls an Timelock Resource.<br>
When you control no Timelock Resources, archive this Avatar.

**Flavor:** *Deep Channel. Bullish on builders.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** Benarc turns “This Avatar can't attack unless defending player controls an Timelock Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-082 · Call to Relay

**Zap** · Cost **T** · Uncommon


Play only during an opponent's turn before attackers.<br>
Their Avatars attack if able. At end step, decommission non-Walls that didn't attack unless they entered or changed control this turn.

**Flavor:** *Call to Relay. Fast signal. Final energy.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during an opponent's turn, before attackers are declared” without characters.

---

### E1-083 · Affinity Rewrite

**Zap** · Cost **T** · Rare


Change the text of target card on the Queue or Network card by replacing all instances of one affinity word with another. (For example, you may change "target Keys card on the Queue" to "target Timelock card on the Queue." This effect lasts indefinitely.)

**Flavor:** *Affinity Rewrite. Send it. The network knows.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Change the text of target card on the Queue or Network card by replacing all instances of one affinity word with another. (For example, you may change "target Keys card on the Queue" to "target Timelock card on the Queue." This effect lasts indefinitely.)” without characters.

---

### E1-084 · Queue Filter

**Zap** · Cost **XT** · Common


Invalidate target card on the Queue with total resource cost X. (For example, if that card on the Queue's Resource cost is 3TT, X is 5.)

**Flavor:** *Queue Filter. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Stops a card on the Queue before it resolves.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A precise burst of network action visualizes “Invalidate target card on the Queue with total resource cost X. (For example, if that card on the Queue's Resource cost is 3TT, X is 5.)” without characters.

---

### E1-085 · Consensus Pause

**Protocol** · Cost **1T** · Rare


Players skip their unlock steps.<br>
At the beginning of your Maintenance, archive this Protocol unless you pay T.

**Flavor:** *Consensus Pause. The good path stays inspectable.*

**Simple Guide · metadata:** Moves a card into an Archive. Lets a committed card become usable again.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Players skip their unlock steps” without characters.

---

### E1-086 · Remote Hardware Control

**Protocol — Attachment** · Cost **2TT** · Uncommon


Attach to Hardware<br>
You control attached Hardware.

**Flavor:** *Remote Hardware Control. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-087 · Timelock Rewrite

**Zap** · Cost **T** · Rare


Target card on the Queue or Network card becomes Timelock. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *Timelock Rewrite. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Timelock. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-088 · State Reset

**Operation** · Cost **2T** · Rare


Each player shuffles their Wallet and Archive into their Stack, then draws seven cards. (Then put State Reset into its owner's Archive.)

**Flavor:** *State Reset. Turn the plan into a signal.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A coordinated network-wide event visualizes “Each player shuffles their Wallet and Archive into their Stack, then draws seven cards. (Then put State Reset into its owner's Archive.)” without characters.

---

### E1-089 · Toggle State

**Zap** · Cost **T** · Common


You may commit or unlock target Hardware, Avatar, or Resource.

**Flavor:** *Toggle State. YOLO, but verify.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A precise burst of network action visualizes “You may commit or unlock target Hardware, Avatar, or Resource” without characters.

---

### E1-090 · Return to Wallet

**Zap** · Cost **T** · Common


Return target Avatar to its owner's Wallet.

**Flavor:** *Return to Wallet. One clean move. Zero committees.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** A precise burst of network action visualizes “Return target Avatar to its owner's Wallet” without characters.

---

### E1-091 · Jedai, Adaptive Client

**Avatar — Client** · Cost **3TT** · Rare · **0/0**

**Character:** Jedai

You may have this Avatar enter as a copy of any Avatar on the Network, except it doesn't copy that Avatar's affinity and it has "At the beginning of your Maintenance, you may have this Avatar become a copy of target Avatar, except it doesn't copy that Avatar's affinity and it has this ability."

**Flavor:** *Adaptive Client. Good signal. Strong hands.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki

**Art direction:** Jedai turns “You may have this Avatar enter as a copy of any Avatar on the Network, except it doesn't copy that Avatar's affinity and it has "At the beginning of your Maintenance, you may have this Avatar become a copy of target Avatar, except it doesn't copy that Avatar's affinity and it has this ability."” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-092 · Grid Eruption

**Operation** · Cost **XTTT** · Rare


Decommission X target Power Resources. Grid Eruption deals damage to each Avatar and each player equal to the number of Power Resources put into an Archive this way.

**Flavor:** *Grid Eruption. Good vibes ship on schedule.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Median past time gives Bitcoin scripts a network-derived time reference.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission X target Power Resources. Grid Eruption deals damage to each Avatar and each player equal to the number of Power Resources put into an Archive this way” without characters.

---

### E1-093 · Snick, Airgap Firewall

**Avatar — Firewall** · Cost **1TT** · Uncommon · **1/5**

**Character:** Snick

Firewall, Broadcast (This Avatar can't attack, and it can block Avatars with Broadcast.)

**Flavor:** *Airgap Firewall. Culture is a protocol too.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Lightning uses timelocks so outdated channel states can be challenged.
**Primary source:** https://github.com/lightning/bolts/blob/master/03-transactions.md

**Art direction:** Snick turns “Firewall, Broadcast (This Avatar can't attack, and it can block Avatars with Broadcast.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-094 · Tal, Liquid Firewall

**Avatar — Firewall** · Cost **1TT** · Uncommon · **0/5**

**Character:** Tal

Firewall (This Avatar can't attack.)<br>
T: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Liquid Firewall. Stay sovereign. Send it.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Tal turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-095 · Darren, Flow Controller

**Avatar — Operator** · Cost **3TT** · Uncommon · **5/4**

**Character:** Darren

No special ability.

**Flavor:** *Flow Controller. Bullish on builders.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** Darren turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Keys

### E1-096 · Archive Boot

**Protocol — Attachment** · Cost **1K** · Uncommon


Attach to an Avatar card in an Archive.<br>
Return it under your control and attach Archive Boot. It gets -1 Action. When Archive Boot leaves, archive that Avatar.

**Flavor:** *Archive Boot. Verify the rails. Then ride.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar card in an Archive” without characters.

---

### E1-097 · DNI, Sovereign Knight

**Avatar — Guardian** · Cost **KK** · Uncommon · **2/2**

**Character:** DNI

First Strike (This Avatar deals clash damage before Avatars without First Strike.)<br>
Shielded from Signal (This Avatar can't be blocked, targeted, dealt damage, or attached by anything Signal.)

**Flavor:** *Sovereign Knight. Culture is a protocol too.*

**Simple Guide · metadata:** Deals or redirects damage. Resists the named affinity.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** DNI turns “First Strike (This Avatar deals clash damage before Avatars without First Strike.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-098 · Nind, Backchannel Walker

**Avatar — Broadcaster** · Cost **3K** · Uncommon · **3/3**

**Character:** Nind

Backchannel—Keys (This Avatar can't be blocked as long as defending player controls a Keys Resource.)

**Flavor:** *Backchannel Walker. Stay sovereign. Send it.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** Nind turns “Backchannel—Keys (This Avatar can't be blocked as long as defending player controls a Keys Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-099 · Stake Contract

**Operation** · Cost **K** · Rare


Stake module — Add the top card of your Stack to the Stake. Discard your Wallet, then draw seven cards.

**Flavor:** *Stake Contract. The next block belongs to builders.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A coordinated network-wide event visualizes “Stake module — Add the top card of your Stack to the Stake. Discard your Wallet, then draw seven cards” without characters.

---

### E1-100 · Leaking Key Vault

**Protocol — Attachment** · Cost **2KK** · Uncommon


Attach to Resource<br>
At the beginning of the Maintenance of attached Resource's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Leaking Key Vault. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-101 · Proof of Work

**Zap** · Cost **K** · Common


Generate 3 Keys Resources.

**Flavor:** *Proof of Work. Send it. The network knows.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A precise burst of network action visualizes “Generate 3 Keys Resources” without characters.

---

### E1-102 · Stake Swap

**Operation** · Cost **KKK** · Rare


Stake module — Exchange ownership of the top card of your Stake with one random card from your opponent's Stake.

**Flavor:** *Stake Swap. Turn the plan into a signal.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Stake module — Exchange ownership of the top card of your Stake with one random card from your opponent's Stake” without characters.

---

### E1-103 · Bitcoin Gatekeeper

**Protocol** · Cost **KK** · Uncommon


KK: marker target Bitcoin card on the Queue.

**Flavor:** *Bitcoin Gatekeeper. The good path stays inspectable.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “KK: marker target Bitcoin card on the Queue” without characters.

---

### E1-104 · Keys Rewrite

**Zap** · Cost **K** · Rare


Target card on the Queue or Network card becomes Keys. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *Keys Rewrite. One clean move. Zero committees.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Keys. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-105 · Stake Arbitration

**Operation** · Cost **1KK** · Rare


Stake module — Each player may add the top card of their Stack to the Stake. If your opponent declines, you may play this again without paying its cost.

**Flavor:** *Stake Arbitration. Big move. Open rails.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** A coordinated network-wide event visualizes “Stake module — Each player may add the top card of their Stack to the Stake. If your opponent declines, you may play this again without paying its cost” without characters.

---

### E1-106 · NC, Resource Reclaimer

**Avatar — Operator** · Cost **3KKK** · Rare · **5/5**

**Character:** NC

Commit: decommission target Resource.<br>
At the beginning of your Maintenance, unless you pay KKK, commit this Avatar and archive a Resource of an opponent's choice.

**Flavor:** *Resource Reclaimer. Make it real. Keep it open.*

**Simple Guide · metadata:** Removes a card from the Network. Moves a card into an Archive.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** NC turns “Commit: decommission target Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-107 · Deep Search

**Operation** · Cost **1K** · Uncommon


Search your Stack for a card, put that card into your Wallet, then shuffle.

**Flavor:** *Deep Search. Turn the plan into a signal.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Search your Stack for a card, put that card into your Wallet, then shuffle” without characters.

---

### E1-108 · Uptime Channel

**Operation** · Cost **X1K** · Common


Spend only Keys Resources to pay X. Uptime Channel deals X damage to any target. You gain Uptime equal to the damage dealt, up to that target's Uptime or Resilience before the damage.

**Flavor:** *Uptime Channel. We came to build the future.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Spend only Keys Resources to pay X. Uptime Channel deals X damage to any target. You gain Uptime equal to the damage dealt, up to that target's Uptime or Resilience before the damage” without characters.

---

### E1-109 · BlackCoffee, Reboot Crew

**Avatar — Operator** · Cost **1K** · Common · **1/1**

**Character:** BlackCoffee

K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *Reboot Crew. Bullish on builders.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** BlackCoffee turns “K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-110 · Resource Corruption

**Protocol — Attachment** · Cost **K** · Uncommon


Attach to Resource<br>
Attached Resource is a Keys Resource.

**Flavor:** *Resource Corruption. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-111 · Onion Route

**Protocol — Attachment** · Cost **KK** · Common


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
Attached Avatar has fear. (It can't be blocked except by Hardware Avatars and/or Keys Avatars.)

**Flavor:** *Onion Route. Consensus looks good on us.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-112 · Proton, Cold Signer

**Avatar — Signer** · Cost **2K** · Common · **0/1**

**Character:** Proton

K: This Avatar gets +1 Action and +1 Resilience until end of turn.

**Flavor:** *Cold Signer. Culture is a protocol too.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** Proton turns “K: This Avatar gets +1 Action and +1 Resilience until end of turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-113 · Signal Tax

**Protocol** · Cost **2K** · Uncommon


Signal cards on the Queue cost 3 more to play.<br>
Activated abilities of Signal Protocols cost 3 more to activate.

**Flavor:** *Signal Tax. The good path stays inspectable.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Signal cards on the Queue cost 3 more to play” without characters.

---

### E1-114 · Burst Signature

**Zap** · Cost **XK** · Common


Target Avatar gets +X/+0 until end of turn.

**Flavor:** *Burst Signature. One clean move. Zero committees.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A precise burst of network action visualizes “Target Avatar gets +X/+0 until end of turn” without characters.

---

### E1-115 · Gadaj, Wallet Whisperer

**Avatar — Signer** · Cost **1KK** · Uncommon · **2/2**

**Character:** Gadaj

Broadcast<br>
Whenever this Avatar deals damage to an opponent, that player discards a card at random.

**Flavor:** *Wallet Whisperer. Good signal. Strong hands.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Deals or redirects damage.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** Gadaj turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-116 · Sovereign Mode

**Protocol** · Cost **KKKK** · Rare


On deploy, set your Uptime to 0. You survive at 0; Uptime gains draw cards instead. Damage archives that many non-proxy cards or you lose. If this leaves, you lose.

**Flavor:** *Sovereign Mode. Consensus looks good on us.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Deals or redirects damage.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “As this Protocol enters, you lose Uptime equal to your Uptime” without characters.

---

### E1-117 · DNI, Self-Custody Giant

**Avatar — Operator** · Cost **4KKK** · Rare · **7/7**

**Character:** DNI

Broadcast, Overflow<br>
At the beginning of your Maintenance, archive an Avatar other than this Avatar. If you can't, this Avatar deals 7 damage to you.

**Flavor:** *Self-Custody Giant. Culture is a protocol too.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** DNI turns “Broadcast, Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-118 · Wallet Scramble

**Operation** · Cost **XK** · Rare


Randomly choose X cards from target player's Wallet; that player discards them.

**Flavor:** *Wallet Scramble. We came to build the future.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** A coordinated network-wide event visualizes “Randomly choose X cards from target player's Wallet; that player discards them” without characters.

---

### E1-119 · Nind, Archive Returner

**Avatar — Operator** · Cost **KK** · Rare · **1/1**

**Character:** Nind

Haste<br>
At the beginning of your Maintenance, if this card is in your Archive with three or more Avatar cards above it, you may put this card onto the Network.

**Flavor:** *Archive Returner. Bullish on builders.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** Nind turns “Haste” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-120 · NC, Forced Signal

**Avatar — Operator** · Cost **2K** · Uncommon · **1/1**

**Character:** NC

Commit — During an opponent's pre-attack step, target non-Wall Avatar they've controlled all turn attacks if able. Decommission it at end step if it didn't.

**Flavor:** *Forced Signal. Good signal. Strong hands.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** NC turns “Commit: Choose target non-Wall Avatar the active player has controlled continuously since the beginning of the turn. That Avatar attacks this turn if able. decommission it at the beginning of the next end step if it didn't attack this turn. Activate only during an opponent's turn, before attackers are declared” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-121 · Proton, Keyed Nightmare

**Avatar — Signer** · Cost **5K** · Rare · ***/***

**Character:** Proton

Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)<br>
Proton, Keyed Nightmare's Action and Resilience are each equal to the number of Keys Resources you control.

**Flavor:** *Keyed Nightmare. Make it real. Keep it open.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** Proton turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-122 · Locked Process

**Protocol — Attachment** · Cost **K** · Common


Attach to an Avatar and commit it. It doesn't unlock normally. At its controller's Maintenance, they may pay 4 to unlock it.

**Flavor:** *Locked Process. Trust less. Coordinate more.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-123 · Broadcast Storm

**Protocol** · Cost **2KK** · Common


At the beginning of the end step, if no Avatars are on the Network, archive this Protocol.<br>
K: This Protocol deals 1 damage to each Avatar and each player.

**Flavor:** *Broadcast Storm. The good path stays inspectable.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of the end step, if no Avatars are on the Network, archive this Protocol” without characters.

---

### E1-124 · BlackCoffee, Shared Secret Swarm

**Avatar — Operator** · Cost **2K** · Common · ***/***

**Character:** BlackCoffee

BlackCoffee, Shared Secret Swarm's Action and Resilience are each equal to the number of Avatars named BlackCoffee, Shared Secret Swarm on the Network.

**Flavor:** *Shared Secret Swarm. Bullish on builders.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** BlackCoffee turns “BlackCoffee, Shared Secret Swarm's Action and Resilience are each equal to the number of Avatars named BlackCoffee, Shared Secret Swarm on the Network” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-125 · Restore Backup

**Operation** · Cost **K** · Common


Return target Avatar card from your Archive to your Wallet.

**Flavor:** *Restore Backup. Big move. Open rails.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Return target Avatar card from your Archive to your Wallet” without characters.

---

### E1-126 · Gadaj, Commit Auditor

**Avatar — Signer** · Cost **1KK** · Rare · **1/1**

**Character:** Gadaj

Commit: decommission target committed Avatar.

**Flavor:** *Commit Auditor. Make it real. Keep it open.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** Gadaj turns “Commit: decommission target committed Avatar” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-127 · Convert Uptime

**Zap** · Cost **K** · Uncommon


As an additional cost to play this card on the Queue, archive an Avatar.<br>
Generate that many Keys Resources, equal to the archived Avatar's total resource cost.

**Flavor:** *Convert Uptime. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Moves a card into an Archive. Generates extra Resources for larger plays.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** A precise burst of network action visualizes “As an additional cost to play this card on the Queue, archive an Avatar” without characters.

---

### E1-128 · NC, Offline Operator

**Avatar — Operator** · Cost **2K** · Common · **2/2**

**Character:** NC

No special ability.

**Flavor:** *Offline Operator. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** NC turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-129 · Nind, Archive Collector

**Avatar — Operator** · Cost **3K** · Uncommon · **2/2**

**Character:** Nind

At the beginning of each end step, put a corpse marker on this Avatar for each Avatar that died this turn.<br>
Remove a corpse marker from this Avatar: Reboot this Avatar.

**Flavor:** *Archive Collector. Bullish on builders.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** Nind turns “At the beginning of each end step, put a corpse marker on this Avatar for each Avatar that died this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-130 · DNI, Sovereign Accumulator

**Avatar — Operator** · Cost **3KK** · Uncommon · **4/4**

**Character:** DNI

Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)<br>
Whenever an Avatar dealt damage by this Avatar this turn is decommissioned, put a +1/+1 marker on this Avatar.

**Flavor:** *Sovereign Accumulator. Good signal. Strong hands.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** DNI turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-131 · State Mirror

**Zap** · Cost **1K** · Uncommon


You gain Uptime equal to the damage dealt to you this turn. State Mirror deals damage to target Avatar you control equal to the damage dealt to you this turn.

**Flavor:** *State Mirror. Send it. The network knows.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** A precise burst of network action visualizes “You gain Uptime equal to the damage dealt to you this turn. State Mirror deals damage to target Avatar you control equal to the damage dealt to you this turn” without characters.

---

### E1-132 · Resource Sink

**Operation** · Cost **KK** · Common


Decommission target Resource.

**Flavor:** *Resource Sink. Turn the plan into a signal.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-133 · Hard Shutdown

**Zap** · Cost **1K** · Common


Decommission target nonartifact, nonblack Avatar. It can't be regenerated.

**Flavor:** *Hard Shutdown. YOLO, but verify.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** A precise burst of network action visualizes “Decommission target nonartifact, nonblack Avatar. It can't be regenerated” without characters.

---

### E1-134 · Sovereign Strength

**Protocol — Attachment** · Cost **K** · Common


Attach to Avatar<br>
Attached Avatar gets +2 Action and +1 Resilience.

**Flavor:** *Sovereign Strength. Open rules. Strong network.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-135 · BlackCoffee, Backup Firewall

**Avatar — Firewall** · Cost **2K** · Uncommon · **1/4**

**Character:** BlackCoffee

Firewall (This Avatar can't attack.)<br>
K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *Backup Firewall. Good signal. Strong hands.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Nostr users can move between clients because identity lives in key pairs.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** BlackCoffee turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-136 · Hardware Leak

**Protocol — Attachment** · Cost **KK** · Rare


Attach to Hardware<br>
At the beginning of the Maintenance of attached Hardware's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Hardware Leak. Consensus looks good on us.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Control of private keys authorizes spending; a wallet helps manage them.
**Primary source:** https://developer.bitcoin.org/devguide/wallets.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-137 · Reduced Permissions

**Protocol — Attachment** · Cost **K** · Common


Attach to Avatar<br>
Attached Avatar gets -2 Action and -1 Resilience.

**Flavor:** *Reduced Permissions. Trust less. Coordinate more.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-138 · Proton, Ephemeral Signer

**Avatar — Signer** · Cost **K** · Rare · **0/1**

**Character:** Proton

Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)<br>
K: Reboot this Avatar. (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *Ephemeral Signer. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** Proton turns “Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-139 · Remote Command

**Zap** · Cost **KK** · Rare


Look at an opponent's Wallet and choose a card they can play. You control that player while they play the chosen card. Resources from their Buffer may be spent only for that card.

**Flavor:** *Remote Command. One clean move. Zero committees.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Schnorr signatures support simple, precise verification rules in Bitcoin.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Art direction:** A precise burst of network action visualizes “Look at an opponent's Wallet and choose a card they can play. You control that player while they play the chosen card. Resources from their Buffer may be spent only for that card” without characters.

---

### E1-140 · Gadaj, Archive Maintainer

**Avatar — Operator** · Cost **1KK** · Rare · **2/3**

**Character:** Gadaj

Other Zombie Avatars have Backchannel—Keys. (They can't be blocked as long as defending player controls a Keys Resource.)<br>
Other Zombies have "K: Reboot this Network card."

**Flavor:** *Archive Maintainer. Good signal. Strong hands.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage. Can slip past players using the named Resource.

**Protocol Note · metadata:** Multisignature policies can require several independent approvals.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#multisig

**Art direction:** Gadaj turns “Other Zombie Avatars have Backchannel—Keys. (They can't be blocked as long as defending player controls a Keys Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

## Power

### E1-141 · Tunneling Patch

**Protocol — Attachment** · Cost **P** · Uncommon


Attach to Avatar<br>
Attached Avatar has Backchannel—Action. (It can't be blocked as long as defending player controls a Power Resource.)

**Flavor:** *Tunneling Patch. Consensus looks good on us.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-142 · Power Rewrite

**Zap** · Cost **P** · Rare


Target card on the Queue or Network card becomes Power. (Its Resource symbols remain unchanged.)

**Flavor:** *Power Rewrite. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Power. (Its Resource symbols remain unchanged.)” without characters.

---

### E1-143 · Final Settlement

**Operation** · Cost **XP** · Common


Final Settlement deals X damage to any target. If it's an Avatar, it can't be regenerated this turn, and if it would be decommissioned this turn, Cold Storage it instead.

**Flavor:** *Final Settlement. We came to build the future.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** A coordinated network-wide event visualizes “Final Settlement deals X damage to any target. If it's an Avatar, it can't be regenerated this turn, and if it would be decommissioned this turn, Cold Storage it instead” without characters.

---

### E1-144 · MadMunky, Young Overclocker

**Avatar — Miner** · Cost **2PP** · Uncommon · **2/3**

**Character:** MadMunky

Broadcast<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn. If this ability has been activated four or more times this turn, archive this Avatar at the beginning of the next end step.

**Flavor:** *Young Overclocker. Bullish on builders.*

**Simple Guide · metadata:** Moves a card into an Archive. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** MadMunky turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-145 · Rootzoll, Hardware Breaker

**Avatar — Operator** · Cost **2P** · Uncommon · **1/1**

**Character:** Rootzoll

Commit: decommission target Wall.

**Flavor:** *Hardware Breaker. Good signal. Strong hands.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** Rootzoll turns “Commit: decommission target Wall” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-146 · Bam, Tunnel Builder

**Avatar — Builder** · Cost **2P** · Common · **1/1**

**Character:** Bam

Commit: Target Avatar with Action 2 or less can't be blocked this turn.

**Flavor:** *Tunnel Builder. Make it real. Keep it open.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** Bam turns “Commit: Target Avatar with Action 2 or less can't be blocked this turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-147 · Leon, Grid Stabilizer

**Avatar — Operator** · Cost **3PP** · Uncommon · **4/5**

**Character:** Leon

No special ability.

**Flavor:** *Grid Stabilizer. Culture is a protocol too.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Leon turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-148 · Grounded Signal

**Protocol — Attachment** · Cost **P** · Common


Attach to Avatar<br>
When this Attachment enters, if attached Avatar has Broadcast, this Attachment deals 2 damage to that Avatar and this Attachment gains "attached Avatar loses Broadcast."

**Flavor:** *Grounded Signal. The good path stays inspectable.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-149 · Hashquake

**Operation** · Cost **XP** · Rare


Hashquake deals X damage to each Avatar without Broadcast and each player.

**Flavor:** *Hashquake. The next block belongs to builders.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** A coordinated network-wide event visualizes “Hashquake deals X damage to each Avatar without Broadcast and each player” without characters.

---

### E1-150 · Route Misdirection

**Zap** · Cost **P** · Common


Play only during blockers. Remove one defending Avatar from clash; anything it alone blocked becomes unblocked. It may block another attacker.

**Flavor:** *Route Misdirection. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only during the declare blockers step” without characters.

---

### E1-151 · Essex, Thermal Operator

**Avatar — Operator** · Cost **3PP** · Uncommon · **5/4**

**Character:** Essex

No special ability.

**Flavor:** *Thermal Operator. Make it real. Keep it open.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** Essex turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-152 · Power Burst

**Operation** · Cost **XP** · Common


This card on the Queue costs 1 more to play for each target beyond the first.<br>
Power Burst deals X damage divided evenly, rounded down, among any number of targets.

**Flavor:** *Power Burst. Turn the plan into a signal.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** A coordinated network-wide event visualizes “This card on the Queue costs 1 more to play for each target beyond the first” without characters.

---

### E1-153 · Overclock

**Protocol — Attachment** · Cost **P** · Common


Attach to Avatar<br>
P: attached Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Overclock. The good path stays inspectable.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-154 · Signal Outage

**Operation** · Cost **3P** · Uncommon


Decommission all Signal Resource.

**Flavor:** *Signal Outage. The next block belongs to builders.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A coordinated network-wide event visualizes “Decommission all Signal Resource” without characters.

---

### E1-155 · Process Fork

**Zap** · Cost **PP** · Rare


Copy target Zap or Operation card on the Queue, except that the copy is Power. You may choose new targets for the copy.

**Flavor:** *Process Fork. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** A precise burst of network action visualizes “Copy target Zap or Operation card on the Queue, except that the copy is Power. You may choose new targets for the copy” without characters.

---

### E1-156 · Toni China, Hot-Air Relay

**Avatar — Broadcaster** · Cost **P** · Uncommon · **1/1**

**Character:** Toni China

P: This Avatar gains Broadcast until end of turn.

**Flavor:** *Hot-Air Relay. Make it real. Keep it open.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Toni China turns “P: This Avatar gains Broadcast until end of turn” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-157 · MadMunky, Chaos Coordinator

**Avatar — Operator** · Cost **1PP** · Rare · **2/2**

**Character:** MadMunky

Other Goblins get +1 Action and +1 Resilience and have Backchannel—Action.

**Flavor:** *Chaos Coordinator. Culture is a protocol too.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** MadMunky turns “Other Goblins get +1 Action and +1 Resilience and have Backchannel—Action” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-158 · Rootzoll, Stone Sentinel

**Avatar — Guardian** · Cost **2P** · Rare · **2/2**

**Character:** Rootzoll

Broadcast<br>
P: This Avatar gets +0 Action and +1 Resilience until end of turn.

**Flavor:** *Stone Sentinel. Stay sovereign. Send it.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** Rootzoll turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-159 · Leon, Shift Worker

**Avatar — Operator** · Cost **2P** · Common · **2/2**

**Character:** Leon

No special ability.

**Flavor:** *Shift Worker. Bullish on builders.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Leon turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-160 · Bam, Heavy Lifter

**Avatar — Operator** · Cost **3P** · Common · **3/3**

**Character:** Bam

No special ability.

**Flavor:** *Heavy Lifter. Good signal. Strong hands.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Bam turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-161 · Essex, Bull Runner

**Avatar — Operator** · Cost **1PP** · Common · **2/3**

**Character:** Essex

No special ability.

**Flavor:** *Bull Runner. Make it real. Keep it open.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Essex turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-162 · Toni China, Rough Miner

**Avatar — Miner** · Cost **1P** · Common · **2/2**

**Character:** Toni China

This Avatar can't block Avatars with Action 2 or greater.

**Flavor:** *Rough Miner. Culture is a protocol too.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Toni China turns “This Avatar can't block Avatars with Action 2 or greater” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-163 · Rootzoll, Crew Multiplier

**Avatar — Operator** · Cost **2PP** · Uncommon · ***/***

**Character:** Rootzoll

Rootzoll, Crew Multiplier's Action and Resilience are each equal to the number of non-Wall Avatars you control.

**Flavor:** *Crew Multiplier. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** Rootzoll turns “Rootzoll, Crew Multiplier's Action and Resilience are each equal to the number of non-Wall Avatars you control” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-164 · Grid Amplifier

**Protocol** · Cost **2P** · Rare


Whenever a player commits a Resource for Resource, that player generates 1 additional Resource of an affinity that Resource produced.

**Flavor:** *Grid Amplifier. Verify the rails. Then ride.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a player commits a Resource for Resource, that player generates 1 additional Resource of an affinity that Resource produced” without characters.

---

### E1-165 · Hot Grid

**Protocol** · Cost **3P** · Rare


Whenever a player commits a Resource for Resource, this Protocol deals 1 damage to that player.

**Flavor:** *Hot Grid. Consensus looks good on us.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever a player commits a Resource for Resource, this Protocol deals 1 damage to that player” without characters.

---

### E1-166 · MadMunky, Meme Raider

**Avatar — Operator** · Cost **P** · Common · **1/1**

**Character:** MadMunky

No special ability.

**Flavor:** *Meme Raider. Culture is a protocol too.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** MadMunky turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-167 · Bam, Power Artillery

**Avatar — Operator** · Cost **1PP** · Uncommon · **1/3**

**Character:** Bam

Commit: This Avatar deals 2 damage to any target and 3 damage to you.

**Flavor:** *Power Artillery. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Bam turns “Commit: This Avatar deals 2 damage to any target and 3 damage to you” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-168 · Miner Rally

**Protocol** · Cost **3P** · Uncommon


Attacking Avatars you control get +1 Action and +0 Resilience.

**Flavor:** *Miner Rally. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attacking Avatars you control get +1 Action and +0 Resilience” without characters.

---

### E1-169 · Idle Grid Penalty

**Protocol** · Cost **PP** · Rare


At the beginning of each player's Maintenance, this Protocol deals X damage to that player, where X is the number of unlocked Resources they controlled at the beginning of this turn.

**Flavor:** *Idle Grid Penalty. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deals or redirects damage. Lets a committed card become usable again.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “At the beginning of each player's Maintenance, this Protocol deals X damage to that player, where X is the number of unlocked Resources they controlled at the beginning of this turn” without characters.

---

### E1-170 · Split Route

**Protocol** · Cost **PP** · Rare


On attack, each defender splits their non-Broadcast Avatars into left and right piles. Each attacker chooses a pile and can be blocked only by it or Broadcast.

**Flavor:** *Split Route. Consensus looks good on us.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Whenever one or more Avatars you control attack, each defending player divides all Avatars without Broadcast they control into a "left" pile and a "right" pile. Then, for each attacking Avatar you control, choose "left" or "right." That Avatar can't be blocked this clash except by Avatars with Broadcast and Avatars in a pile with the chosen label” without characters.

---

### E1-171 · Timelock Invalidation

**Zap** · Cost **P** · Common


Choose one —<br>
• marker target Timelock card on the Queue.<br>
• decommission target Timelock Network card.

**Flavor:** *Timelock Invalidation. Tiny packet. Huge mood.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Choose one —” without characters.

---

### E1-172 · Leon, High Relay Rider

**Avatar — Broadcaster** · Cost **3P** · Rare · **3/3**

**Character:** Leon

Broadcast

**Flavor:** *High Relay Rider. Stay sovereign. Send it.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Leon turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-173 · Toni China, Multihead Miner

**Avatar — Miner** · Cost **XPP** · Rare · **0/0**

**Character:** Toni China

Enters with X +1/+1 markers. Remove one to prevent 1 damage.<br>
P: prevent 1 damage this turn. PPP — Maintenance: add a +1/+1 marker.

**Flavor:** *Multihead Miner. Bullish on builders.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Toni China turns “This Avatar enters with X +1/+1 markers on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-174 · Essex, Grid Rebooter

**Avatar — Operator** · Cost **2P** · Rare · **2/2**

**Character:** Essex

This Avatar gets +1 Action and +1 Resilience as long as you control a Keys Resource.<br>
K: Reboot this Avatar.

**Flavor:** *Grid Rebooter. Good signal. Strong hands.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage. Makes an Avatar stronger.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** Essex turns “This Avatar gets +1 Action and +1 Resilience as long as you control a Keys Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-175 · Hardware Shatter

**Zap** · Cost **1P** · Common


Decommission target Hardware.

**Flavor:** *Hardware Shatter. Send it. The network knows.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** A precise burst of network action visualizes “Decommission target Hardware” without characters.

---

### E1-176 · MadMunky, Hashrate Dragon

**Avatar — Miner** · Cost **4PP** · Rare · **5/5**

**Character:** MadMunky

Broadcast<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Hashrate Dragon. Culture is a protocol too.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** MadMunky turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-177 · Thermal Throttle

**Protocol** · Cost **PP** · Rare


Players can't unlock more than one Avatar during their unlock steps.

**Flavor:** *Thermal Throttle. The good path stays inspectable.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Players can't unlock more than one Avatar during their unlock steps” without characters.

---

### E1-178 · Bam, Launch Engineer

**Avatar — Builder** · Cost **2PP** · Uncommon · **3/4**

**Character:** Bam

Commit: Target Avatar you control with Resilience less than this Avatar's Action gains Broadcast until end of turn. decommission that Avatar at the beginning of the next end step.

**Flavor:** *Launch Engineer. Bullish on builders.*

**Simple Guide · metadata:** Removes a card from the Network. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Bam turns “Commit: Target Avatar you control with Resilience less than this Avatar's Action gains Broadcast until end of turn. decommission that Avatar at the beginning of the next end step” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-179 · Resource Cut

**Operation** · Cost **2P** · Common


Decommission target Resource.

**Flavor:** *Resource Cut. Big move. Open rails.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-180 · Firewall Tunnel

**Zap** · Cost **P** · Uncommon


Decommission target Wall. It can't be regenerated.

**Flavor:** *Firewall Tunnel. Send it. The network knows.*

**Simple Guide · metadata:** Removes a card from the Network. Generates extra Resources for larger plays.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** A precise burst of network action visualizes “Decommission target Wall. It can't be regenerated” without characters.

---

### E1-181 · Rootzoll & Leon, Dual Operator

**Avatar — Operator** · Cost **4P** · Rare · **4/4**

**Character:** Rootzoll, Leon

Overflow<br>
This Avatar can block an additional Avatar each clash.

**Flavor:** *Dual Operator. Culture is a protocol too.*

**Simple Guide · metadata:** Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** Rootzoll and Leon turns “Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-182 · Essex, Resilient Operator

**Avatar — Operator** · Cost **2P** · Uncommon · **2/2**

**Character:** Essex

P: Reboot this Avatar.

**Flavor:** *Resilient Operator. Stay sovereign. Send it.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** Mining rewards combine newly issued bitcoin with transaction fees.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** Essex turns “P: Reboot this Avatar” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-183 · Toni China, Thermal Firewall

**Avatar — Firewall** · Cost **1PP** · Uncommon · **0/5**

**Character:** Toni China

Firewall (This Avatar can't attack.)<br>
P: This Avatar gets +1 Action and +0 Resilience until end of turn.

**Flavor:** *Thermal Firewall. Bullish on builders.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Proof of work makes proposing Bitcoin blocks computationally costly.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Toni China turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-184 · Rootzoll, Stone Firewall

**Avatar — Firewall** · Cost **1PP** · Uncommon · **0/8**

**Character:** Rootzoll

Firewall (This Avatar can't attack.)

**Flavor:** *Stone Firewall. Good signal. Strong hands.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin adjusts mining difficulty to target a stable block interval.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work

**Art direction:** Rootzoll turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-185 · Freedom Market

**Operation** · Cost **2P** · Rare


Each player discards their Wallet, then draws seven cards.

**Flavor:** *Freedom Market. Good vibes ship on schedule.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** Miners assemble candidate blocks while full nodes verify every rule.
**Primary source:** https://developer.bitcoin.org/devguide/mining.html

**Art direction:** A coordinated network-wide event visualizes “Each player discards their Wallet, then draws seven cards” without characters.

---

## Bitcoin

### E1-186 · Hashrate Aura

**Protocol — Attachment** · Cost **1B** · Rare


Attach to Avatar<br>
Attached Avatar gets +X/+Y, where X is half the number of Bitcoin Resources you control, rounded down, and Y is half the number of Bitcoin Resources you control, rounded up.

**Flavor:** *Hashrate Aura. Trust less. Coordinate more.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-187 · Committed Growth

**Zap** · Cost **B** · Uncommon


Play this card on the Queue only before the clash damage step.<br>
Target Avatar gains Overflow and gets +X/+0 until end of turn, where X is its Action. At the beginning of the next end step, decommission that Avatar if it attacked this turn.

**Flavor:** *Committed Growth. YOLO, but verify.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A precise burst of network action visualizes “Play this card on the Queue only before the clash damage step” without characters.

---

### E1-188 · Shillie, Multisource Scout

**Avatar — Operator** · Cost **B** · Rare · **0/1**

**Character:** Shillie

Broadcast<br>
Commit: generate 1 Resource of any affinity.

**Flavor:** *Multisource Scout. Bullish on builders.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Generates extra Resources for larger plays.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Shillie turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-189 · Obfuscated Formation

**Zap** · Cost **B** · Uncommon


Play only before blockers are declared. You split your attacking Avatars into piles. The defending player chooses which pile each blocker can block.

**Flavor:** *Obfuscated Formation. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A precise burst of network action visualizes “Play only before blockers are declared. You split your attacking Avatars into piles. The defending player chooses which pile each blocker can block” without characters.

---

### E1-190 · Human Hashrate

**Operation** · Cost **BB** · Uncommon


Until end of turn, any time you could activate a Resource ability, you may pay 1 Uptime. If you do, generate 1 neutral Resource.

**Flavor:** *Human Hashrate. Good vibes ship on schedule.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** A coordinated network-wide event visualizes “Until end of turn, any time you could activate a Resource ability, you may pay 1 Uptime. If you do, generate 1 neutral Resource” without characters.

---

### E1-191 · Mtoshi, Deathtouch Courier

**Avatar — Operator** · Cost **3BB** · Rare · **2/4**

**Character:** Mtoshi

Broadcast<br>
Whenever this Avatar blocks or becomes blocked by a non-Wall Avatar, decommission that Avatar at end of clash.

**Flavor:** *Deathtouch Courier. Culture is a protocol too.*

**Simple Guide · metadata:** Removes a card from the Network. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Mtoshi turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-192 · Longy, Deep Node

**Avatar — Node** · Cost **4BB** · Common · **6/4**

**Character:** Longy

No special ability.

**Flavor:** *Deep Node. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** Longy turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-193 · Tobo, First-Strike Archer

**Avatar — Operator** · Cost **1B** · Rare · **2/1**

**Character:** Tobo

First Strike — deals clash damage before Avatars without First Strike.

**Flavor:** *First-Strike Archer. Bullish on builders.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** Tobo turns “First Strike — deals clash damage before Avatars without First Strike” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-194 · Fast Channel

**Protocol** · Cost **B** · Rare


You may play any number of Resources on each of your turns.<br>
Whenever you play a Resource, if it wasn't the first Resource you played this turn, this Protocol deals 1 damage to you.

**Flavor:** *Fast Channel. Verify the rails. Then ride.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “You may play any number of Resources on each of your turns” without characters.

---

### E1-195 · Quiet Block

**Zap** · Cost **B** · Common


Prevent all clash damage that would be dealt this turn.

**Flavor:** *Quiet Block. Send it. The network knows.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A precise burst of network action visualizes “Prevent all clash damage that would be dealt this turn” without characters.

---

### E1-196 · Arbadacarba, Natural Hashrate

**Avatar — Miner** · Cost **2BBBB** · Rare · **8/8**

**Character:** Arbadacarba

Overflow (This Avatar can deal excess clash damage to the player it's attacking.)<br>
At the beginning of your Maintenance, this Avatar deals 8 damage to you unless you pay BBBB.

**Flavor:** *Natural Hashrate. Culture is a protocol too.*

**Simple Guide · metadata:** Deals or redirects damage. Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** Arbadacarba turns “Overflow (This Avatar can deal excess clash damage to the player it's attacking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-197 · BK, Feedback Grower

**Avatar — Operator** · Cost **3B** · Rare · **2/2**

**Character:** BK

Whenever this Avatar is dealt damage, put a +1/+1 marker on it.

**Flavor:** *Feedback Grower. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** BK turns “Whenever this Avatar is dealt damage, put a +1/+1 marker on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-198 · Longy, Resource Sovereign

**Avatar — Operator** · Cost **3BBB** · Rare · ***/***

**Character:** Longy

While idle, Action/Resilience equal your Bitcoin Resources; while attacking, they equal the defender's. Commit: target Resource is Bitcoin while Longy remains.

**Flavor:** *Resource Sovereign. Bullish on builders.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** Longy turns “As long as Longy, Resource Sovereign isn't attacking, its Action and Resilience are each equal to the number of Bitcoin Resources you control. As long as Longy, Resource Sovereign is attacking, its Action and Resilience are each equal to the number of Bitcoin Resources defending player controls” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-199 · Number Go Up

**Zap** · Cost **B** · Common


Target Avatar gets +3 Action and +3 Resilience until end of turn.

**Flavor:** *Number Go Up. Fast signal. Final energy.*

**Simple Guide · metadata:** Makes an Avatar stronger.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A precise burst of network action visualizes “Target Avatar gets +3 Action and +3 Resilience until end of turn” without characters.

---

### E1-200 · Shillie, Mesh Sentinel

**Avatar — Guardian** · Cost **3B** · Common · **2/4**

**Character:** Shillie

Broadcast Guard (This Avatar can block Avatars with Broadcast.)

**Flavor:** *Mesh Sentinel. Make it real. Keep it open.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Shillie turns “Broadcast Guard (This Avatar can block Avatars with Broadcast.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-201 · BK, Bear Market Builder

**Avatar — Builder** · Cost **1B** · Common · **2/2**

**Character:** BK

No special ability.

**Flavor:** *Bear Market Builder. Culture is a protocol too.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** BK turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-202 · Network Storm

**Operation** · Cost **XB** · Uncommon


Network Storm deals X damage to each Avatar with Broadcast and each player.

**Flavor:** *Network Storm. We came to build the future.*

**Simple Guide · metadata:** Deals or redirects damage. Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** A coordinated network-wide event visualizes “Network Storm deals X damage to each Avatar with Broadcast and each player” without characters.

---

### E1-203 · Resource Freeze

**Operation** · Cost **2B** · Uncommon


Decommission target Resource.

**Flavor:** *Resource Freeze. The next block belongs to builders.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A coordinated network-wide event visualizes “Decommission target Resource” without characters.

---

### E1-204 · Instant Boot

**Protocol — Attachment** · Cost **B** · Uncommon


Attach to Avatar<br>
Attached Avatar can attack as though it had haste.<br>
0: unlock attached Avatar. Activate only during your turn and only once each turn.

**Flavor:** *Instant Boot. Verify the rails. Then ride.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-205 · Mtoshi, Rooted Node

**Avatar — Node** · Cost **4B** · Common · **3/5**

**Character:** Mtoshi

No special ability.

**Flavor:** *Rooted Node. Make it real. Keep it open.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** Mtoshi turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-206 · Migrating Workload

**Protocol — Attachment** · Cost **1BB** · Rare


Attach to Resource<br>
When attached Resource becomes committed, decommission it. That Resource's controller may attach this Attachment to a Resource of their choice.

**Flavor:** *Migrating Workload. Trust less. Coordinate more.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

### E1-207 · Tobo, Resource Unlocker

**Avatar — Operator** · Cost **2B** · Uncommon · **1/1**

**Character:** Tobo

Commit: unlock target Resource.

**Flavor:** *Resource Unlocker. Stay sovereign. Send it.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** Tobo turns “Commit: unlock target Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-208 · Keys Invalidation

**Protocol** · Cost **BB** · Uncommon


BB: marker target Keys card on the Queue.

**Flavor:** *Keys Invalidation. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “BB: marker target Keys card on the Queue” without characters.

---

### E1-209 · Bitcoin Rewrite

**Zap** · Cost **B** · Rare


Target card on the Queue or Network card becomes Bitcoin. (Resource symbols on that Network card remain unchanged.)

**Flavor:** *Bitcoin Rewrite. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** A precise burst of network action visualizes “Target card on the Queue or Network card becomes Bitcoin. (Resource symbols on that Network card remain unchanged.)” without characters.

---

### E1-210 · Living Hardware

**Protocol — Attachment** · Cost **B** · Rare


Attach to Hardware. Damage to you adds that many vitality markers. At Maintenance, remove one to gain 1 Uptime.

**Flavor:** *Living Hardware. Consensus looks good on us.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Hardware” without characters.

---

### E1-211 · Resource Awakening

**Protocol** · Cost **3B** · Rare


All Bitcoin Resources are 1/1 Avatars that are still Resources.

**Flavor:** *Resource Awakening. Trust less. Coordinate more.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “All Bitcoin Resources are 1/1 Avatars that are still Resources” without characters.

---

### E1-212 · Arbadacarba, Grid Steward

**Avatar — Builder** · Cost **B** · Common · **1/1**

**Character:** Arbadacarba

Commit: generate 1 Bitcoin Resource.

**Flavor:** *Grid Steward. Stay sovereign. Send it.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Arbadacarba turns “Commit: generate 1 Bitcoin Resource” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-213 · Attention Market

**Protocol — Attachment** · Cost **1BB** · Uncommon


Attach to Avatar<br>
All Avatars able to block attached Avatar do so.

**Flavor:** *Attention Market. Open rules. Strong network.*

**Simple Guide · metadata:** Deploy this Protocol to change how the Network behaves over time.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-214 · Topology Scan

**Zap** · Cost **B** · Rare


Look at the top three cards of target player's Stack, then put them back in any order. You may have that player shuffle.

**Flavor:** *Topology Scan. Fast signal. Final energy.*

**Simple Guide · metadata:** Play this while other cards wait on the Queue to make a timely response.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** A precise burst of network action visualizes “Look at the top three cards of target player's Stack, then put them back in any order. You may have that player shuffle” without characters.

---

### E1-215 · Reboot Protocol

**Protocol — Attachment** · Cost **1B** · Common


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
B: Reboot attached Avatar. (The next time that Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.)

**Flavor:** *Reboot Protocol. Consensus looks good on us.*

**Simple Guide · metadata:** Deals or redirects damage. Removes a card from the Network.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-216 · Recovery Phrase

**Operation** · Cost **1B** · Uncommon


Return target card from your Archive to your Wallet.

**Flavor:** *Recovery Phrase. Turn the plan into a signal.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** A coordinated network-wide event visualizes “Return target card from your Archive to your Wallet” without characters.

---

### E1-217 · Shillie, Tiny Broadcaster

**Avatar — Broadcaster** · Cost **B** · Common · **1/1**

**Character:** Shillie

Broadcast

**Flavor:** *Tiny Broadcaster. Stay sovereign. Send it.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** Shillie turns “Broadcast” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-218 · Tobo, Bitcoin Backchanneler

**Avatar — Broadcaster** · Cost **B** · Common · **1/1**

**Character:** Tobo

Backchannel—Bitcoin (This Avatar can't be blocked as long as defending player controls a Bitcoin Resource.)

**Flavor:** *Bitcoin Backchanneler. Bullish on builders.*

**Simple Guide · metadata:** Can slip past players using the named Resource.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Tobo turns “Backchannel—Bitcoin (This Avatar can't be blocked as long as defending player controls a Bitcoin Resource.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-219 · Uptime Stream

**Operation** · Cost **XB** · Common


Target player gains X Uptime.

**Flavor:** *Uptime Stream. Big move. Open rails.*

**Simple Guide · metadata:** Play this during your main phase for a one-time strategic effect.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A coordinated network-wide event visualizes “Target player gains X Uptime” without characters.

---

### E1-220 · Mtoshi, Finality Keeper

**Avatar — Guardian** · Cost **3BB** · Uncommon · **2/4**

**Character:** Mtoshi

Whenever this Avatar blocks or becomes blocked by a non-Wall Avatar, decommission that Avatar at end of clash.

**Flavor:** *Finality Keeper. Make it real. Keep it open.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** Mtoshi turns “Whenever this Avatar blocks or becomes blocked by a non-Wall Avatar, decommission that Avatar at end of clash” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-221 · BK, Mesh Pack

**Avatar — Operator** · Cost **B** · Rare · **1/1**

**Character:** BK

Mesh.

**Flavor:** *Mesh Pack. Culture is a protocol too.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** BK turns “Mesh (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh you control are blocking or being blocked by an Avatar, you divide that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-222 · Protocol Reset

**Operation** · Cost **2B** · Common


Decommission all Protocols.

**Flavor:** *Protocol Reset. We came to build the future.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** A coordinated network-wide event visualizes “Decommission all Protocols” without characters.

---

### E1-223 · Timelock Outage

**Operation** · Cost **3B** · Uncommon


Decommission all Timelock Resources.

**Flavor:** *Timelock Outage. The next block belongs to builders.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** A coordinated network-wide event visualizes “Decommission all Timelock Resources” without characters.

---

### E1-224 · Arbadacarba, Protocol Gardener

**Avatar — Operator** · Cost **1BB** · Rare · **0/2**

**Character:** Arbadacarba

Whenever you play a Protocol card on the Queue, you may draw a card.

**Flavor:** *Protocol Gardener. Good signal. Strong hands.*

**Simple Guide · metadata:** Puts more cards in your Wallet.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** Arbadacarba turns “Whenever you play a Protocol card on the Queue, you may draw a card” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-225 · Longy, Thorn Firewall

**Avatar — Firewall** · Cost **2B** · Uncommon · **2/3**

**Character:** Longy

Firewall (This Avatar can't attack.)<br>
B: Reboot this Avatar.

**Flavor:** *Thorn Firewall. Make it real. Keep it open.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** Longy turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-226 · Shillie, Cold Firewall

**Avatar — Firewall** · Cost **2B** · Uncommon · **0/7**

**Character:** Shillie

Firewall (This Avatar can't attack.)

**Flavor:** *Cold Firewall. Culture is a protocol too.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** A UTXO is an unspent transaction output that can fund a later transaction.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html

**Art direction:** Shillie turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-227 · Tobo, Wooden Firewall

**Avatar — Firewall** · Cost **B** · Common · **0/3**

**Character:** Tobo

Firewall (This Avatar can't attack.)

**Flavor:** *Wooden Firewall. Stay sovereign. Send it.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Bitcoin issuance is bounded by consensus and declines through halvings.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** Tobo turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-228 · Restless Client

**Protocol — Attachment** · Cost **2B** · Uncommon


Attach to Avatar<br>
At the beginning of the Maintenance of attached Avatar's controller, this Attachment deals 1 damage to that player.

**Flavor:** *Restless Client. Open rules. Strong network.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Transaction fees express demand for scarce block space.
**Primary source:** https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar” without characters.

---

### E1-229 · BK, Heavy Settler

**Avatar — Operator** · Cost **3B** · Common · **3/3**

**Character:** BK

Overflow

**Flavor:** *Heavy Settler. Good signal. Strong hands.*

**Simple Guide · metadata:** Can push excess clash damage through to Uptime.

**Protocol Note · metadata:** A full node checks rules locally instead of trusting a remote verdict.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** BK turns “Overflow” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-230 · Mesh Upgrade

**Protocol — Attachment** · Cost **B** · Rare


Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)<br>
Attached Avatar gets +0 Action and +2 Resilience and has Broadcast Guard. (It can block Avatars with Broadcast.)

**Flavor:** *Mesh Upgrade. Consensus looks good on us.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster. Makes an Avatar stronger.

**Protocol Note · metadata:** Taproot combines Schnorr signatures with flexible spending conditions.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Avatar (Target an Avatar as you play this. This card enters attached to that Avatar.)” without characters.

---

### E1-231 · Yield Router

**Protocol — Attachment** · Cost **B** · Common


Attach to Resource<br>
Whenever attached Resource is committed for Resource, its controller generates 1 additional Bitcoin Resource.

**Flavor:** *Yield Router. Trust less. Coordinate more.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** An abstract but understandable protocol diagram made physical visualizes “Attach to Resource” without characters.

---

## Neutral / Multi-affinity

### E1-232 · Entry Fee Device

**Hardware** · Cost **2** · Rare


Whenever a Resource enters, this Hardware deals 2 damage to that Resource's controller.

**Flavor:** *Entry Fee Device. Built to work when hype does not.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “Whenever a Resource enters, this Hardware deals 2 damage to that Resource's controller” without characters.

---

### E1-233 · Basalt Battery

**Hardware** · Cost **3** · Uncommon


This Hardware doesn't unlock during your unlock step.<br>
Commit: generate 3 neutral Resources.<br>
3: unlock this Hardware.

**Flavor:** *Basalt Battery. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Generates extra Resources for larger plays. Lets a committed card become usable again.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “This Hardware doesn't unlock during your unlock step” without characters.

---

### E1-234 · Wallet Pressure

**Hardware** · Cost **1** · Uncommon


As this Hardware enters, choose an opponent.<br>
At the beginning of the chosen player's Maintenance, this Hardware deals X damage to that player, where X is the number of cards in their Wallet minus 4.

**Flavor:** *Wallet Pressure. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “As this Hardware enters, choose an opponent” without characters.

---

### E1-235 · Resource Prism

**Hardware** · Cost **3** · Uncommon


2, Commit: generate 1 Resource of any affinity.

**Flavor:** *Resource Prism. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “2, Commit: generate 1 Resource of any affinity” without characters.

---

### E1-236 · Chaos Kernel

**Hardware** · Cost **2** · Rare


Toss module — Commit: toss Chaos Kernel from at least one card-height above the Network. Archive each non-proxy card it touches, then archive Chaos Kernel.

**Flavor:** *Chaos Kernel. Built to work when hype does not.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “Toss module — Commit: toss Chaos Kernel from at least one card-height above the Network. Archive each non-proxy card it touches, then archive Chaos Kernel” without characters.

---

### E1-237 · Cuddy, Clockwork Node

**Hardware Avatar — Node** · Cost **6** · Rare · **0/4**

**Character:** Cuddy

Enters with seven +1/+0 markers; remove one after it attacks or blocks.<br>
X, Commit — Maintenance: refill up to X markers, to a maximum of seven.

**Flavor:** *Clockwork Node. The machine joined the crew.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** Cuddy turns “This Avatar enters with seven +1/+0 markers on it” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-238 · Damage Limiter

**Hardware** · Cost **4** · Uncommon


3, Commit: Prevent the next 2 damage that would be dealt to you this turn.

**Flavor:** *Damage Limiter. No permission. Just builders.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “3, Commit: Prevent the next 2 damage that would be dealt to you this turn” without characters.

---

### E1-239 · Uptime Clock

**Hardware** · Cost **2** · Uncommon


At the beginning of each player's Maintenance, this Hardware deals 1 damage to that player.

**Flavor:** *Uptime Clock. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “At the beginning of each player's Maintenance, this Hardware deals 1 damage to that player” without characters.

---

### E1-240 · Timelock Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Timelock card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Timelock Receiver. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “Whenever a player play a Timelock card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-241 · Resource Tombstone

**Hardware** · Cost **4** · Rare


2, Commit — Maintenance: mark target non-Keys Resource; it becomes Keys. If this is archived, at each future Maintenance remove all its marks from one marked Resource.

**Flavor:** *Resource Tombstone. Built to work when hype does not.*

**Simple Guide · metadata:** Moves a card into an Archive.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “2, Commit: put a mire marker on target non-Keys Resource. It is a Keys Resource while it has a mire marker. Use only during your Maintenance” without characters.

---

### E1-242 · Resource Exit Sensor

**Hardware** · Cost **4** · Rare


Whenever a Resource is put into an Archive from the Network, this Hardware deals 2 damage to that Resource's controller.

**Flavor:** *Resource Exit Sensor. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deals or redirects damage. Moves a card into an Archive.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “Whenever a Resource is put into an Archive from the Network, this Hardware deals 2 damage to that Resource's controller” without characters.

---

### E1-243 · Wallet Scrubber

**Hardware** · Cost **3** · Rare


3, Commit: Target player discards a card. Activate only during your turn.

**Flavor:** *Wallet Scrubber. No permission. Just builders.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “3, Commit: Target player discards a card. Activate only during your turn” without characters.

---

### E1-244 · Damage Firewall

**Hardware** · Cost **3** · Rare


1: The next time an unblocked Avatar of your choice would deal clash damage to you this turn, prevent all but 1 of that damage.

**Flavor:** *Damage Firewall. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “1: The next time an unblocked Avatar of your choice would deal clash damage to you this turn, prevent all but 1 of that damage” without characters.

---

### E1-245 · Hashrate Gauntlet

**Hardware** · Cost **4** · Rare


Power Avatars get +1 Action and +1 Resilience.<br>
Whenever a Power Resource is committed for Resource, its controller generates 1 additional Power Resource.

**Flavor:** *Hashrate Gauntlet. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Power Avatars get +1 Action and +1 Resilience” without characters.

---

### E1-246 · Public Wallet Viewer

**Hardware** · Cost **1** · Uncommon


Commit: Look at target player's Wallet.

**Flavor:** *Public Wallet Viewer. Built to work when hype does not.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “Commit: Look at target player's Wallet” without characters.

---

### E1-247 · Mesh Router

**Hardware** · Cost **1** · Rare


1, Commit: target Avatar gains Mesh this turn.

**Flavor:** *Mesh Router. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deals or redirects damage. Can coordinate with other Mesh Avatars during clashes.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “1, Commit: Target Avatar gains Mesh until end of turn. (Any Avatars with Mesh, and up to one without, can attack in a band. Bands are blocked as a group. If any Avatars with Mesh a player controls are blocking or being blocked by an Avatar, that player divides that Avatar's clash damage, not its controller, among any of the Avatars it's being blocked by or is blocking.)” without characters.

---

### E1-248 · Open Feed

**Hardware** · Cost **2** · Rare


At the beginning of each player's draw step, if this Hardware is unlocked, that player draws an additional card.

**Flavor:** *Open Feed. No permission. Just builders.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Lets a committed card become usable again.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “At the beginning of each player's draw step, if this Hardware is unlocked, that player draws an additional card” without characters.

---

### E1-249 · Cold Storage Controller

**Hardware** · Cost **4** · Uncommon


1, Commit: commit target Hardware, Avatar, or Resource.

**Flavor:** *Cold Storage Controller. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Uses committing as the cost for a repeatable effect.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “1, Commit: commit target Hardware, Avatar, or Resource” without characters.

---

### E1-250 · Identity Mask

**Hardware** · Cost **2** · Rare


X: deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar. Turn it face up when it would deal or receive damage, or become committed. X must cover its deploy cost.

**Flavor:** *Identity Mask. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “X: deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar. Turn it face up when it would deal or receive damage, or become committed. X must cover its deploy cost” without characters.

---

### E1-251 · Power Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Power card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Power Receiver. Built to work when hype does not.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Whenever a player play a Power card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-252 · Signal Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Signal card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Signal Receiver. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “Whenever a player play a Signal card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-253 · Damage Router

**Hardware** · Cost **4** · Rare


1: The next time a source of your choice would deal damage to target Avatar this turn, that source deals that damage to you instead.

**Flavor:** *Damage Router. No permission. Just builders.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “1: The next time a source of your choice would deal damage to target Avatar this turn, that source deals that damage to you instead” without characters.

---

### E1-254 · Hot Wallet Statue

**Hardware** · Cost **4** · Uncommon


2: This Hardware becomes a 3/6 Golem Hardware Avatar until end of clash. Activate only during clash.

**Flavor:** *Hot Wallet Statue. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “2: This Hardware becomes a 3/6 Golem Hardware Avatar until end of clash. Activate only during clash” without characters.

---

### E1-255 · Genesis Archive

**Hardware — Archive** · Cost **4** · Rare


4, Commit: Draw a card.

**Flavor:** *Genesis Archive. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Puts more cards in your Wallet.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “4, Commit: Draw a card” without characters.

---

### E1-256 · FLX, Unstoppable Rig

**Hardware Avatar — Node** · Cost **4** · Uncommon · **5/3**

**Character:** FLX

This Avatar attacks each clash if able.<br>
This Avatar can't be blocked by Walls.

**Flavor:** *Unstoppable Rig. Good hardware has a heartbeat.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** FLX turns “This Avatar attacks each clash if able” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-257 · Keyed Resource Bell

**Hardware** · Cost **4** · Rare


All Keys Resources are 1/1 Keys Avatars that are still Resources.

**Flavor:** *Keyed Resource Bell. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “All Keys Resources are 1/1 Keys Avatars that are still Resources” without characters.

---

### E1-258 · Memory Palace

**Hardware** · Cost **1** · Uncommon


You have no maximum Wallet size.<br>
If an effect causes you to discard a card, discard it, but you may put it on top of your Stack instead of into your Archive.

**Flavor:** *Memory Palace. No permission. Just builders.*

**Simple Guide · metadata:** Reduces the options in an opponent's Wallet. Moves a card into an Archive.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “You have no maximum Wallet size” without characters.

---

### E1-259 · MHB, Living Firewall

**Hardware Avatar — Firewall** · Cost **4** · Uncommon · **0/6**

**Character:** MHB

Firewall (This Avatar can't attack.)<br>
1: Reboot this Avatar.

**Flavor:** *Living Firewall. Good hardware has a heartbeat.*

**Simple Guide · metadata:** Can keep an Avatar in the Network after damage.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** MHB turns “Firewall (This Avatar can't attack.)” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-260 · Boost Converter

**Hardware** · Cost **1** · Rare


Doesn't unlock normally. At Maintenance, pay 4 to unlock it. If committed at draw, it deals 1 damage to you. Commit: generate 3 neutral Resources.

**Flavor:** *Boost Converter. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Puts more cards in your Wallet. Deals or redirects damage.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “This Hardware doesn't unlock during your unlock step” without characters.

---

### E1-261 · Low-Power Mode

**Hardware** · Cost **1** · Rare


Avatars with Action 3 or greater don't unlock during their controllers' unlock steps.

**Flavor:** *Low-Power Mode. Built to work when hype does not.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “Avatars with Action 3 or greater don't unlock during their controllers' unlock steps” without characters.

---

### E1-262 · Bitcoin Seed

**Hardware** · Cost **0** · Rare


Commit: generate 1 Bitcoin Resource.

**Flavor:** *Bitcoin Seed. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Bitcoin Resource” without characters.

---

### E1-263 · Keys Shard

**Hardware** · Cost **0** · Rare


Commit: generate 1 Keys Resource.

**Flavor:** *Keys Shard. No permission. Just builders.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Keys Resource” without characters.

---

### E1-264 · Signal Beacon

**Hardware** · Cost **0** · Rare


Commit: generate 1 Signal Resource.

**Flavor:** *Signal Beacon. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Signal Resource” without characters.

---

### E1-265 · Power Cell

**Hardware** · Cost **0** · Rare


Commit: generate 1 Power Resource.

**Flavor:** *Power Cell. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Power Resource” without characters.

---

### E1-266 · Timelock Crystal

**Hardware** · Cost **0** · Rare


Commit: generate 1 Timelock Resource.

**Flavor:** *Timelock Crystal. Built to work when hype does not.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “Commit: generate 1 Timelock Resource” without characters.

---

### E1-267 · Network Reset Disk

**Hardware** · Cost **4** · Rare


This Hardware enters committed.<br>
1, Commit: decommission all Hardware, Avatars, and Protocols.

**Flavor:** *Network Reset Disk. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “This Hardware enters committed” without characters.

---

### E1-268 · Michael1011, Obsidian Node

**Hardware Avatar — Node** · Cost **6** · Uncommon · **4/6**

**Character:** Michael1011

No special ability.

**Flavor:** *Obsidian Node. Good hardware has a heartbeat.*

**Simple Guide · metadata:** Deploy this Avatar to defend your Uptime or pressure an opponent.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** Michael1011 turns “No special ability” into a constructive cypherpunk scene; official silhouette and wardrobe stay recognizable.

---

### E1-269 · Fault Injector

**Hardware** · Cost **4** · Uncommon


3, Commit: This Hardware deals 1 damage to any target.

**Flavor:** *Fault Injector. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deals or redirects damage.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “3, Commit: This Hardware deals 1 damage to any target” without characters.

---

### E1-270 · Genesis Ring

**Hardware** · Cost **1** · Uncommon


Commit: generate 2 neutral Resources.

**Flavor:** *Genesis Ring. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Generates extra Resources for larger plays.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “Commit: generate 2 neutral Resources” without characters.

---

### E1-271 · Archive Listener

**Hardware** · Cost **1** · Uncommon


Whenever an Avatar is decommissioned, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Archive Listener. Built to work when hype does not.*

**Simple Guide · metadata:** Removes a card from the Network.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “Whenever an Avatar is decommissioned, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-272 · Resource Converter

**Hardware** · Cost **3** · Rare


You may spend Signal Resource as though it were Power Resource.

**Flavor:** *Resource Converter. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** A practical open-source device visualizes “You may spend Signal Resource as though it were Power Resource” without characters.

---

### E1-273 · Swarm Node

**Hardware** · Cost **5** · Rare


5, Commit: create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast. Name it Swarm Drone.

**Flavor:** *Swarm Node. No permission. Just builders.*

**Simple Guide · metadata:** Can usually be blocked only by another Broadcaster.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** A practical open-source device visualizes “5, Commit: create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast. Name it Swarm Drone” without characters.

---

### E1-274 · Keys Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Keys card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Keys Receiver. Useful beats flashy. Every block.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** A practical open-source device visualizes “Whenever a player play a Keys card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-275 · Timelock Vault

**Hardware** · Cost **2** · Rare


Timelock Vault enters committed. It does not unlock normally. You may skip a turn to unlock it. Commit: after this turn, take one additional turn.

**Flavor:** *Timelock Vault. Plug in. Verify. Send it.*

**Simple Guide · metadata:** Gives you another full turn after this one. Lets a committed card become usable again.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** A practical open-source device visualizes “Timelock Vault enters committed. It does not unlock normally. You may skip a turn to unlock it. Commit: after this turn, take one additional turn” without characters.

---

### E1-276 · Difficulty Winter

**Hardware** · Cost **2** · Rare


As long as this Hardware is unlocked, players can't unlock more than one Resource during their unlock steps.

**Flavor:** *Difficulty Winter. Built to work when hype does not.*

**Simple Guide · metadata:** Lets a committed card become usable again.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** A practical open-source device visualizes “As long as this Hardware is unlocked, players can't unlock more than one Resource during their unlock steps” without characters.

---

### E1-277 · Bitcoin Receiver

**Hardware** · Cost **1** · Uncommon


Whenever a player play a Bitcoin card on the Queue, you may pay 1. If you do, you gain 1 Uptime.

**Flavor:** *Bitcoin Receiver. Ship it open. Run it sovereign.*

**Simple Guide · metadata:** Deploy this Hardware for a lasting tool you can build around.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** A practical open-source device visualizes “Whenever a player play a Bitcoin card on the Queue, you may pay 1. If you do, you gain 1 Uptime” without characters.

---

### E1-278 · Power–Keys Junction

**Resource — Keys / Power** · Cost **—** · Rare


Commit: generate 1 Keys or 1 Power.

**Flavor:** *Power–Keys Junction. Local first. Global by protocol.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys or 1 Power” without characters.

---

### E1-279 · Keys–Bitcoin Junction

**Resource — Keys / Bitcoin** · Cost **—** · Rare


Commit: generate 1 Keys or 1 Bitcoin.

**Flavor:** *Keys–Bitcoin Junction. Real capacity. Shared freely.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys or 1 Bitcoin” without characters.

---

### E1-280 · Power–Signal Junction

**Resource — Power / Signal** · Cost **—** · Rare


Commit: generate 1 Power or 1 Signal.

**Flavor:** *Power–Signal Junction. Stack the work. Grow the commons.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power or 1 Signal” without characters.

---

### E1-281 · Bitcoin–Signal Junction

**Resource — Bitcoin / Signal** · Cost **—** · Rare


Commit: generate 1 Bitcoin or 1 Signal.

**Flavor:** *Bitcoin–Signal Junction. Abundance starts at the edge.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Lightning payments use onion routing to limit who learns the full path.
**Primary source:** https://github.com/lightning/bolts/blob/master/04-onion-routing.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin or 1 Signal” without characters.

---

### E1-282 · Signal–Keys Junction

**Resource — Signal / Keys** · Cost **—** · Rare


Commit: generate 1 Signal or 1 Keys.

**Flavor:** *Signal–Keys Junction. Local first. Global by protocol.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** NIP-19 gives Nostr identifiers human-friendly bech32 encodings.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/19.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal or 1 Keys” without characters.

---

### E1-283 · Power–Bitcoin Junction

**Resource — Power / Bitcoin** · Cost **—** · Rare


Commit: generate 1 Power or 1 Bitcoin.

**Flavor:** *Power–Bitcoin Junction. Real capacity. Shared freely.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Open specifications make protocol behavior reviewable and reusable.
**Primary source:** https://github.com/nostr-protocol/nips

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power or 1 Bitcoin” without characters.

---

### E1-284 · Bitcoin–Timelock Junction

**Resource — Bitcoin / Timelock** · Cost **—** · Rare


Commit: generate 1 Bitcoin or 1 Timelock.

**Flavor:** *Bitcoin–Timelock Junction. Stack the work. Grow the commons.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Open protocols let independent implementations interoperate.
**Primary source:** https://github.com/bitcoin/bips

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin or 1 Timelock” without characters.

---

### E1-285 · Signal–Timelock Junction

**Resource — Signal / Timelock** · Cost **—** · Rare


Commit: generate 1 Signal or 1 Timelock.

**Flavor:** *Signal–Timelock Junction. Abundance starts at the edge.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** PSBT lets multiple tools coordinate signing without sharing private keys.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal or 1 Timelock” without characters.

---

### E1-286 · Timelock–Keys Junction

**Resource — Timelock / Keys** · Cost **—** · Rare


Commit: generate 1 Timelock or 1 Keys.

**Flavor:** *Timelock–Keys Junction. Local first. Global by protocol.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to pay in either affinity.

**Protocol Note · metadata:** Compact block filters support private, bandwidth-efficient wallet queries.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock or 1 Keys” without characters.

---

## Signal

### E1-287 · Signal Commons — Sunrise

**Basic Resource — Signal** · Cost **—** · Common


Commit: generate 1 Signal.

**Flavor:** *Signal Commons — Sunrise. Real capacity. Shared freely.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Signal.

**Protocol Note · metadata:** NIP-57 defines Lightning zaps as signed value signals around Nostr events.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/57.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal” without characters.

---

### E1-288 · Signal Commons — Rooftop

**Basic Resource — Signal** · Cost **—** · Common


Commit: generate 1 Signal.

**Flavor:** *Signal Commons — Rooftop. Stack the work. Grow the commons.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Signal.

**Protocol Note · metadata:** Nostr clients can use many relays, reducing dependence on one operator.
**Primary source:** https://github.com/nostr-protocol/nips/blob/master/01.md

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Signal” without characters.

---

## Timelock

### E1-289 · Timelock Channel — Dawn

**Basic Resource — Timelock** · Cost **—** · Common


Commit: generate 1 Timelock.

**Flavor:** *Timelock Channel — Dawn. Abundance starts at the edge.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Timelock.

**Protocol Note · metadata:** Block headers link to prior blocks, making history expensive to rewrite.
**Primary source:** https://bitcoin.org/bitcoin.pdf

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock” without characters.

---

### E1-290 · Timelock Channel — Midnight

**Basic Resource — Timelock** · Cost **—** · Common


Commit: generate 1 Timelock.

**Flavor:** *Timelock Channel — Midnight. Local first. Global by protocol.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Timelock.

**Protocol Note · metadata:** Bitcoin timelocks can delay when a transaction output becomes spendable.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Timelock” without characters.

---

## Keys

### E1-291 · Key Vault — Workshop

**Basic Resource — Keys** · Cost **—** · Common


Commit: generate 1 Keys.

**Flavor:** *Key Vault — Workshop. Real capacity. Shared freely.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Keys.

**Protocol Note · metadata:** BIP-32 derives many wallet keys from one hierarchical root.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys” without characters.

---

### E1-292 · Key Vault — Cold Room

**Basic Resource — Keys** · Cost **—** · Common


Commit: generate 1 Keys.

**Flavor:** *Key Vault — Cold Room. Stack the work. Grow the commons.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Keys.

**Protocol Note · metadata:** BIP-39 encodes wallet backup entropy as a mnemonic sentence.
**Primary source:** https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Keys” without characters.

---

## Power

### E1-293 · Power Plant — Solar

**Basic Resource — Power** · Cost **—** · Common


Commit: generate 1 Power.

**Flavor:** *Power Plant — Solar. Abundance starts at the edge.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Power.

**Protocol Note · metadata:** Hashing turns variable input into a fixed-size result used in proof of work.
**Primary source:** https://developer.bitcoin.org/reference/block_chain.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power” without characters.

---

### E1-294 · Power Plant — Hydro

**Basic Resource — Power** · Cost **—** · Common


Commit: generate 1 Power.

**Flavor:** *Power Plant — Hydro. Local first. Global by protocol.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Power.

**Protocol Note · metadata:** A valid block must satisfy both proof-of-work and consensus rules.
**Primary source:** https://developer.bitcoin.org/devguide/block_chain.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Power” without characters.

---

## Bitcoin

### E1-295 · Satoshi Orchard — Commons

**Basic Resource — Bitcoin** · Cost **—** · Common


Commit: generate 1 Bitcoin.

**Flavor:** *Satoshi Orchard — Commons. Stack the work. Grow the commons.*

**Simple Guide · metadata:** Play this as your Resource for the turn. Commit it to generate Bitcoin.

**Protocol Note · metadata:** Bitcoin nodes independently validate transactions and blocks.
**Primary source:** https://developer.bitcoin.org/devguide/p2p_network.html

**Art direction:** An open community infrastructure site visualizes “Commit: generate 1 Bitcoin” without characters.

---
