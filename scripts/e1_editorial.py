"""Deterministic Edition One editorial copy and consistency fixes."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

NIPS = "https://github.com/nostr-protocol/nips/blob/master"
BIPS = "https://github.com/bitcoin/bips/blob/master"
BOLTS = "https://github.com/lightning/bolts/blob/master"
CORE = "https://github.com/bitcoin/bitcoin/blob/master"

BROADCAST_REMINDER = (
    "Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)"
)
FIREWALL_REMINDER = "Firewall (This Avatar can't attack.)"
REBOOT_REMINDER = (
    "The next time this Avatar would be decommissioned this turn, instead commit it, "
    "remove it from clash, and heal all damage on it."
)

RULES_BY_ID = {
    "E1-001": "Commit and archive Genesis Lotus: generate 3 Resources of one affinity.",
    "E1-007": (
        "Attach to Firewall\nAttached Firewall can attack as though it didn't have Firewall."
    ),
    "E1-048": (
        "First Strike (This Avatar deals clash damage before Avatars without First Strike.)\n"
        "Shielded from Keys "
        "(It can't be targeted, attached, blocked or dealt damage by Keys sources.)"
    ),
    "E1-050": "Decommission all Avatars. They can't be Rebooted.",
    "E1-064": "Attach to Avatar\nAttached Avatar can't be blocked except by Firewalls.",
    "E1-067": (
        "Other Merfolk get +1 Action and +1 Resilience and have Backchannel — Timelock. "
        "(Those Avatars can't be blocked while the defending player controls a "
        "Timelock Resource.)"
    ),
    "E1-069": BROADCAST_REMINDER,
    "E1-082": (
        "Play only during an opponent's turn before attackers.\n"
        "Their Avatars attack if able. At end step, decommission non-Firewalls that "
        "didn't attack unless they entered or changed control this turn."
    ),
    "E1-093": f"{FIREWALL_REMINDER}\n{BROADCAST_REMINDER}",
    "E1-097": (
        "First Strike (This Avatar deals clash damage before Avatars without First Strike.)\n"
        "Shielded from Signal "
        "(It can't be targeted, attached, blocked or dealt damage by Signal sources.)"
    ),
    "E1-098": (
        "Backchannel — Keys "
        "(This Avatar can't be blocked while the defending player controls a Keys Resource.)"
    ),
    "E1-119": (
        "This Avatar may attack as though it did not have Boot Delay.\n"
        "At the beginning of your Maintenance, if this card is in your Archive with "
        "three or more Avatar cards above it, you may put this card onto the Network."
    ),
    "E1-120": (
        "Commit — During an opponent's pre-attack step, target non-Firewall Avatar "
        "they've controlled all turn attacks if able. Decommission it at end step if it didn't."
    ),
    "E1-121": (
        f"{BROADCAST_REMINDER}\n"
        "Proton, Keyed Nightmare's Action and Resilience are each equal to the number "
        "of Keys Resources you control."
    ),
    "E1-130": (
        f"{BROADCAST_REMINDER}\n"
        "Whenever an Avatar dealt damage by this Avatar this turn is decommissioned, "
        "put a +1/+1 marker on this Avatar."
    ),
    "E1-133": ("Decommission target non-Hardware, non-Keys Avatar. It can't be Rebooted."),
    "E1-135": (f"{FIREWALL_REMINDER}\nK: Reboot this Avatar. ({REBOOT_REMINDER})"),
    "E1-138": (f"{BROADCAST_REMINDER}\nK: Reboot this Avatar. ({REBOOT_REMINDER})"),
    "E1-140": (
        "Other Zombie Avatars have Backchannel — Keys. "
        "(Those Avatars can't be blocked while the defending player controls a Keys Resource.)\n"
        'Other Zombies have "K: Reboot this Network card."'
    ),
    "E1-141": (
        "Attach to Avatar\n"
        "Attached Avatar has Backchannel — Power. "
        "(That Avatar can't be blocked while the defending player controls a Power Resource.)"
    ),
    "E1-143": (
        "Final Settlement deals X damage to any target. If it's an Avatar, it can't be "
        "Rebooted this turn, and if it would be decommissioned this turn, Cold Storage "
        "it instead."
    ),
    "E1-145": "Commit: decommission target Firewall.",
    "E1-163": (
        "Rootzoll, Crew Multiplier's Action and Resilience are each equal to the number "
        "of non-Firewall Avatars you control."
    ),
    "E1-170": (
        "Whenever one or more Avatars you control attack, each defender splits their "
        "non-Broadcast Avatars into left and right piles. Each attacker chooses a pile "
        "and can be blocked only by it or Broadcast."
    ),
    "E1-180": "Decommission target Firewall. It can't be Rebooted.",
    "E1-191": (
        "Broadcast\n"
        "Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar, "
        "decommission that Avatar at end of clash."
    ),
    "E1-204": (
        "Attach to Avatar\n"
        "Attached Avatar may attack as though it did not have Boot Delay.\n"
        "0: unlock attached Avatar. Activate only during your turn and only once each turn."
    ),
    "E1-218": (
        "Backchannel — Bitcoin "
        "(This Avatar can't be blocked while the defending player controls a Bitcoin Resource.)"
    ),
    "E1-220": (
        "Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar, "
        "decommission that Avatar at end of clash."
    ),
    "E1-256": "This Avatar attacks each clash if able.\nThis Avatar can't be blocked by Firewalls.",
}

NAME_BY_ID = {"E1-191": "Mtoshi, Lethal Courier"}

FLAVOR_TEMPLATES = {
    "Avatar": (
        "The status page calmed down as soon as {subject} picked up a wrench.",
        "Nobody assigned the incident; it simply looked nervous around {subject}.",
        "A second opinion arrived wearing {subject}'s tool belt.",
        "The runbook says stay calm, and {subject} added label your cables.",
        "Even the fallback plan has a fallback when {subject} joins the call.",
        "The Network asked for a hero; {subject} submitted a tested patch.",
        "Every antenna found its horizon when {subject} climbed the roof.",
        "The coffee went cold, but the relay stayed warm for {subject}.",
        "The Queue behaved all afternoon under {subject}'s suspiciously polite stare.",
        "Someone said impossible; {subject} heard needs one more adapter.",
        "The outage brought drama, while {subject} brought a multimeter.",
        "Trust arrived late, so {subject} verified without it.",
        "The dashboard blinked red until it met {subject}.",
        "No cape was required, though {subject} did bring spare batteries.",
        "The bug filed a retreat notice when {subject} opened the logs.",
        "Consensus took minutes; {subject}'s cable labels took seconds.",
        "The edge feels like home when {subject} has the keys.",
        "Even the air gap makes small talk with {subject}.",
        "The packet took the scenic route and still saluted {subject}.",
        "Uptime is a team sport, according to {subject} and the patched router.",
    ),
    "Protocol": (
        "The fine print became infrastructure when {subject} entered the Network.",
        "Every rule has an edge case; {subject} packed it a lunch.",
        "The whiteboard stopped arguing after {subject} drew the final arrow.",
        "A handshake became a habit wherever {subject} was deployed.",
        "No committee survived contact with the clarity of {subject}.",
        "The Network called it policy; {subject} called it Tuesday.",
        "One tidy invariant followed {subject} into every messy room.",
        "The loophole closed itself after reading {subject}.",
        "A thousand opinions became one testable rule inside {subject}.",
        "The boring path became the reliable path under {subject}.",
        "Everyone brought assumptions, but {subject} brought a specification.",
        "The exception asked for permission before approaching {subject}.",
        "A sticky note achieved consensus and grew into {subject}.",
        "Nothing says romance like deterministic behavior from {subject}.",
        "The meeting ended early because {subject} had executable minutes.",
        "The Network slept better once {subject} checked the locks.",
    ),
    "Zap": (
        "Latency rehearsed an excuse, but {subject} had already resolved.",
        "The Queue blinked once and found {subject} at the front.",
        "A tiny packet made a very large entrance as {subject}.",
        "The response window was brief and exactly long enough for {subject}.",
        "No one heard the starter pistol; they only saw {subject}.",
        "The bug requested more time, which {subject} politely denied.",
        "One clean interrupt later, the logs credited {subject}.",
        "The fast path keeps a reserved seat for {subject}.",
        "The packet wore sensible shoes because it was carrying {subject}.",
        "A deadline became a punchline the moment {subject} landed.",
        "The Network said now, and {subject} did not ask which timezone.",
        "Every millisecond filed paperwork after meeting {subject}.",
        "The shortest meeting on record had one agenda item: {subject}.",
        "The incident channel gained one emoji and one decisive {subject}.",
    ),
    "Operation": (
        "The plan left the whiteboard and returned wearing {subject}.",
        "Every checklist box stood a little straighter for {subject}.",
        "The long route became the useful route after {subject}.",
        "A coordinated morning begins with coffee and {subject}.",
        "The Network moved as one, mostly because {subject} brought labels.",
        "Tomorrow arrived early carrying the paperwork for {subject}.",
        "A dozen small steps agreed to call themselves {subject}.",
        "The maintenance window finally found its purpose in {subject}.",
        "The big red button was replaced with a tested runbook named {subject}.",
        "Nothing was improvised except the celebratory snack after {subject}.",
        "The rollout had a rollback and both approved {subject}.",
        "Every moving part received an introduction during {subject}.",
        "The schedule feared drift until it encountered {subject}.",
        "The Network practiced once, then performed {subject} without a soloist.",
    ),
    "Hardware": (
        "The manual had three pages, and {subject} used all of them as coasters.",
        "A blinking light found meaningful employment inside {subject}.",
        "The spare cable finally met its destiny beside {subject}.",
        "Nothing rattles in {subject} except one very confident screw.",
        "The workbench made room before {subject} even arrived.",
        "A tiny fan applauds every successful cycle inside {subject}.",
        "The warranty says robust; the dents on {subject} say field-tested.",
        "The rubber duck approved the wiring diagram for {subject}.",
        "One port remains unused so {subject} can claim mysterious potential.",
        "The rack gained both capacity and personality from {subject}.",
        "A screwdriver took a victory lap around {subject}.",
        "The uptime graph sent a thank-you note to {subject}.",
        "Dust asked for access and was denied by {subject}.",
        "The useful machine in the corner finally got a name: {subject}.",
        "The status LED on {subject} only blinks in complete sentences.",
        "Every connector clicked on the first try around {subject}, allegedly.",
        "A quiet hum is how {subject} tells jokes.",
        "The breaker panel keeps a respectful distance from {subject}.",
        "No cloud was consulted during the assembly of {subject}.",
        "The toolbox calls {subject} its most successful side project.",
    ),
    "Resource": (
        "Useful capacity grows wherever {subject} gets a clean connection.",
        "The edge became a neighborhood after {subject} switched on.",
        "A local cable found global purpose through {subject}.",
        "The commons keeps the kettle warm beside {subject}.",
        "No permission slip was harmed while building {subject}.",
        "The shortest route to abundance runs through {subject}.",
        "The lights stayed on and credited {subject}, plus sensible maintenance.",
        "A spare watt found honest work inside {subject}.",
        "The Network planted one seed and labeled it {subject}.",
        "Every route needs a junction, and this one answers to {subject}.",
        "The neighborhood gained one more useful sunrise from {subject}.",
        "Capacity became a shared verb around {subject}.",
    ),
}

PROTOCOL_FACTS = {
    "Signal": (
        (
            "NIP-01 events carry an id, pubkey, timestamp, kind, tags, content and signature.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-01 hashes a canonical event serialization to produce its event id.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-01 signs an event id so clients can verify the publisher.",
            f"{NIPS}/01.md",
        ),
        (
            "A NIP-01 REQ message opens a filtered relay subscription.",
            f"{NIPS}/01.md",
        ),
        (
            "A NIP-01 CLOSE message ends a relay subscription.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-01 EOSE tells a client that stored events for a subscription were sent.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-01 uses kind 0 for replaceable user metadata.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-01 uses kind 1 for short text notes.",
            f"{NIPS}/01.md",
        ),
        (
            "NIP-02 stores a follow list in a signed kind 3 event.",
            f"{NIPS}/02.md",
        ),
        (
            "NIP-05 resolves an internet identifier through .well-known/nostr.json.",
            f"{NIPS}/05.md",
        ),
        (
            "NIP-09 uses a signed kind 5 event to request deletion of earlier events.",
            f"{NIPS}/09.md",
        ),
        (
            "NIP-10 uses event and pubkey tags to describe note threads.",
            f"{NIPS}/10.md",
        ),
        (
            "NIP-11 lets a relay publish an informational JSON document over HTTP.",
            f"{NIPS}/11.md",
        ),
        (
            "NIP-13 places a nonce and target difficulty in an event tag for proof of work.",
            f"{NIPS}/13.md",
        ),
        (
            "NIP-19 gives Nostr keys and event references bech32 encodings.",
            f"{NIPS}/19.md",
        ),
        (
            "NIP-21 defines the nostr: URI scheme for NIP-19 identifiers.",
            f"{NIPS}/21.md",
        ),
        (
            "NIP-25 represents reactions as signed kind 7 events.",
            f"{NIPS}/25.md",
        ),
        (
            "NIP-42 authenticates a client by signing a relay-provided challenge.",
            f"{NIPS}/42.md",
        ),
        (
            "NIP-44 defines a versioned encrypted-payload format.",
            f"{NIPS}/44.md",
        ),
        (
            "NIP-46 lets a client request signing from a remote Nostr signer.",
            f"{NIPS}/46.md",
        ),
        (
            "NIP-47 carries wallet requests and responses through Nostr events.",
            f"{NIPS}/47.md",
        ),
        (
            "NIP-50 adds a search field to relay filters that choose to support it.",
            f"{NIPS}/50.md",
        ),
        (
            "NIP-57 defines signed zap receipts as kind 9735 events.",
            f"{NIPS}/57.md",
        ),
        (
            "NIP-65 stores preferred relay lists in kind 10002 events.",
            f"{NIPS}/65.md",
        ),
    ),
    "Timelock": (
        (
            "BIP-65 makes CHECKLOCKTIMEVERIFY enforce an absolute locktime.",
            f"{BIPS}/bip-0065.mediawiki",
        ),
        (
            "BIP-112 makes CHECKSEQUENCEVERIFY enforce relative locktime.",
            f"{BIPS}/bip-0112.mediawiki",
        ),
        (
            "BIP-113 evaluates transaction locktime against median past time.",
            f"{BIPS}/bip-0113.mediawiki",
        ),
        (
            "BIP-68 encodes relative locktime semantics in transaction sequence numbers.",
            f"{BIPS}/bip-0068.mediawiki",
        ),
        (
            "BOLT 2 defines the messages peers use to manage Lightning channels.",
            f"{BOLTS}/02-peer-protocol.md",
        ),
        (
            "BOLT 3 defines commitment transactions that enforce a channel state.",
            f"{BOLTS}/03-transactions.md",
        ),
        (
            "BOLT 3 obscures the commitment number stored in transaction fields.",
            f"{BOLTS}/03-transactions.md",
        ),
        (
            "BOLT 3 defines separate timeout and success paths for offered HTLCs.",
            f"{BOLTS}/03-transactions.md",
        ),
        (
            "BOLT 4 wraps a payment route in one encrypted onion packet.",
            f"{BOLTS}/04-onion-routing.md",
        ),
        (
            "BOLT 4 derives a separate shared secret for each hop.",
            f"{BOLTS}/04-onion-routing.md",
        ),
        (
            "BOLT 4 encrypts failure messages as they travel back toward the sender.",
            f"{BOLTS}/04-onion-routing.md",
        ),
        (
            "BOLT 5 tells a node how to react when channel transactions reach the chain.",
            f"{BOLTS}/05-onchain.md",
        ),
        (
            "BOLT 7 channel announcements prove that a funding output exists.",
            f"{BOLTS}/07-routing-gossip.md",
        ),
        (
            "BOLT 7 node announcements carry public routing-node metadata.",
            f"{BOLTS}/07-routing-gossip.md",
        ),
        (
            "BOLT 7 channel updates advertise direction-specific routing policy.",
            f"{BOLTS}/07-routing-gossip.md",
        ),
        (
            "BOLT 8 encrypts and authenticates Lightning's peer transport.",
            f"{BOLTS}/08-transport.md",
        ),
        (
            "BOLT 9 uses even feature bits for required features and odd bits for optional ones.",
            f"{BOLTS}/09-features.md",
        ),
        (
            "BOLT 10 defines DNS records that help a new node discover peers.",
            f"{BOLTS}/10-dns-bootstrap.md",
        ),
        (
            "BOLT 1 uses BigSize integers for compact variable-length values.",
            f"{BOLTS}/01-messaging.md",
        ),
        (
            "BOLT 1 requires readers to ignore unknown odd TLV types.",
            f"{BOLTS}/01-messaging.md",
        ),
        (
            "BOLT 11 invoices commit to a payment hash.",
            f"{BOLTS}/11-payment-encoding.md",
        ),
        (
            "BOLT 11 uses a human-readable prefix to identify network and optional amount.",
            f"{BOLTS}/11-payment-encoding.md",
        ),
        (
            "BOLT 12 offers are reusable descriptions from which invoices can be requested.",
            f"{BOLTS}/12-offer-encoding.md",
        ),
        (
            "Lightning moves bitcoin off-chain by cooperation while retaining "
            "on-chain enforcement.",
            f"{BOLTS}/00-introduction.md",
        ),
    ),
    "Keys": (
        (
            "BIP-32 extended keys combine key material with a 32-byte chain code.",
            f"{BIPS}/bip-0032.mediawiki",
        ),
        (
            "BIP-32 marks hardened child indexes at 2³¹ and above.",
            f"{BIPS}/bip-0032.mediawiki",
        ),
        (
            "BIP-32 can derive non-hardened public children from an extended public key.",
            f"{BIPS}/bip-0032.mediawiki",
        ),
        (
            "BIP-39 appends a checksum before mapping entropy to mnemonic words.",
            f"{BIPS}/bip-0039.mediawiki",
        ),
        (
            "BIP-39 uses PBKDF2-HMAC-SHA512 to turn a mnemonic into a seed.",
            f"{BIPS}/bip-0039.mediawiki",
        ),
        (
            "BIP-44 defines purpose, coin, account, change and address path levels.",
            f"{BIPS}/bip-0044.mediawiki",
        ),
        (
            "BIP-49 assigns a derivation scheme for SegWit nested inside P2SH.",
            f"{BIPS}/bip-0049.mediawiki",
        ),
        (
            "BIP-84 assigns a derivation scheme for native SegWit wallets.",
            f"{BIPS}/bip-0084.mediawiki",
        ),
        (
            "BIP-86 assigns a derivation scheme for single-key Taproot outputs.",
            f"{BIPS}/bip-0086.mediawiki",
        ),
        (
            "BIP-340 Schnorr signatures serialize to 64 bytes.",
            f"{BIPS}/bip-0340.mediawiki",
        ),
        (
            "BIP-340 uses 32-byte x-only public keys.",
            f"{BIPS}/bip-0340.mediawiki",
        ),
        (
            "BIP-340 tagged hashes separate one hashing context from another.",
            f"{BIPS}/bip-0340.mediawiki",
        ),
        (
            "BIP-341 Taproot outputs can be spent through a key path or script path.",
            f"{BIPS}/bip-0341.mediawiki",
        ),
        (
            "BIP-342 validates Taproot scripts with Schnorr signatures.",
            f"{BIPS}/bip-0342.mediawiki",
        ),
        (
            "BIP-174 lets multiple tools coordinate an unsigned transaction without sharing keys.",
            f"{BIPS}/bip-0174.mediawiki",
        ),
        (
            "BIP-370 defines version 2 of the PSBT format.",
            f"{BIPS}/bip-0370.mediawiki",
        ),
        (
            "BIP-371 adds Taproot input and output fields to PSBT.",
            f"{BIPS}/bip-0371.mediawiki",
        ),
        (
            "BIP-380 defines descriptors as strings that describe output scripts.",
            f"{BIPS}/bip-0380.mediawiki",
        ),
        (
            "BIP-381 defines sh() and wsh() descriptor expressions.",
            f"{BIPS}/bip-0381.mediawiki",
        ),
        (
            "BIP-382 defines the tr() descriptor expression for Taproot outputs.",
            f"{BIPS}/bip-0382.mediawiki",
        ),
        (
            "Bitcoin Core descriptors may end with an eight-character checksum.",
            f"{CORE}/doc/descriptors.md",
        ),
        (
            "Bitcoin Core descriptor wallets track script templates instead of isolated addresses.",
            f"{CORE}/doc/descriptors.md",
        ),
        (
            "BIP-85 derives deterministic entropy streams from an HD wallet root.",
            f"{BIPS}/bip-0085.mediawiki",
        ),
        (
            "BIP-129 gives multisig wallets a common setup-file format.",
            f"{BIPS}/bip-0129.mediawiki",
        ),
    ),
    "Power": (
        (
            "Bitcoin proof of work searches for a block-header hash below a target.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Each Bitcoin block header commits to the previous block header's hash.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "A Bitcoin block header commits to its transactions through a Merkle root.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Bitcoin retargets proof-of-work difficulty every 2,016 blocks.",
            "https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work",
        ),
        (
            "Bitcoin's proof-of-work target aims for a roughly ten-minute block interval.",
            "https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work",
        ),
        (
            "The block-header nonce field is 32 bits wide.",
            "https://developer.bitcoin.org/reference/block_chain.html#block-headers",
        ),
        (
            "The coinbase transaction is the first transaction in a Bitcoin block.",
            "https://developer.bitcoin.org/reference/block_chain.html#serialized-blocks",
        ),
        (
            "A coinbase transaction can collect both block subsidy and transaction fees.",
            "https://developer.bitcoin.org/devguide/mining.html",
        ),
        (
            "Bitcoin's block subsidy halves every 210,000 blocks.",
            "https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking",
        ),
        (
            "Full nodes independently reject blocks that violate consensus rules.",
            "https://developer.bitcoin.org/devguide/block_chain.html",
        ),
        (
            "Bitcoin compares valid branches by cumulative proof of work.",
            "https://developer.bitcoin.org/devguide/block_chain.html#block-height-and-forking",
        ),
        (
            "Mining pools issue members easier share targets to measure contributed work.",
            "https://developer.bitcoin.org/devguide/mining.html#pool-mining",
        ),
        (
            "BIP-152 compact blocks use short transaction identifiers to reduce relay data.",
            f"{BIPS}/bip-0152.mediawiki",
        ),
        (
            "Headers-first sync validates a header chain before requesting every block.",
            "https://developer.bitcoin.org/devguide/p2p_network.html#headers-first",
        ),
        (
            "Bitcoin Core's assumevalid option can skip old script checks before a known block.",
            f"{CORE}/doc/assumeutxo.md",
        ),
        (
            "AssumeUTXO loads a serialized UTXO snapshot before background validation finishes.",
            f"{CORE}/doc/assumeutxo.md",
        ),
        (
            "Pruned Bitcoin nodes validate the chain before deleting old block files.",
            f"{CORE}/doc/reduce-memory.md",
        ),
        (
            "Signet blocks require a solution to the network's configured challenge.",
            f"{BIPS}/bip-0325.mediawiki",
        ),
        (
            "Bitcoin Core regtest mode creates blocks on demand for local tests.",
            f"{CORE}/doc/developer-notes.md",
        ),
        (
            "Bitcoin peers exchange network addresses to aid peer discovery.",
            "https://developer.bitcoin.org/devguide/p2p_network.html#peer-discovery",
        ),
        (
            "BIP-155 addr v2 messages can carry Tor v3 and I2P addresses.",
            f"{BIPS}/bip-0155.mediawiki",
        ),
        (
            "BIP-324 defines an encrypted version 2 Bitcoin peer transport.",
            f"{BIPS}/bip-0324.mediawiki",
        ),
        (
            "A miner builds a candidate block from validated transactions.",
            "https://developer.bitcoin.org/devguide/mining.html",
        ),
        (
            "Block templates expose the target a miner must satisfy.",
            "https://developer.bitcoin.org/reference/rpc/getblocktemplate.html",
        ),
    ),
    "Bitcoin": (
        (
            "A UTXO is an unspent transaction output available to a later input.",
            "https://developer.bitcoin.org/devguide/transactions.html",
        ),
        (
            "A transaction input identifies a previous output by transaction id and index.",
            "https://developer.bitcoin.org/reference/transactions.html#txin-a-transaction-input-non-coinbase",
        ),
        (
            "A transaction output pairs a bitcoin value with a locking script.",
            "https://developer.bitcoin.org/reference/transactions.html#txout-a-transaction-output",
        ),
        (
            "A Bitcoin transaction fee equals total input value minus total output value.",
            "https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change",
        ),
        (
            "A coinbase output must mature for 100 blocks before it can be spent.",
            "https://developer.bitcoin.org/devguide/transactions.html#coinbase-input-the-input-of-the-first-transaction-in-a-block",
        ),
        (
            "BIP-16 P2SH commits to a redeem script by its hash.",
            f"{BIPS}/bip-0016.mediawiki",
        ),
        (
            "BIP-141 separates witness data from legacy transaction serialization.",
            f"{BIPS}/bip-0141.mediawiki",
        ),
        (
            "SegWit prevents witness changes from altering the legacy transaction id.",
            f"{BIPS}/bip-0141.mediawiki",
        ),
        (
            "A SegWit block commits to witness data through its coinbase transaction.",
            f"{BIPS}/bip-0141.mediawiki",
        ),
        (
            "BIP-173 Bech32 strings use a human-readable prefix and checksum.",
            f"{BIPS}/bip-0173.mediawiki",
        ),
        (
            "BIP-350 assigns Bech32m to witness versions 1 through 16.",
            f"{BIPS}/bip-0350.mediawiki",
        ),
        (
            "BIP-21 defines bitcoin: URIs for payment requests.",
            f"{BIPS}/bip-0021.mediawiki",
        ),
        (
            "BIP-22 defines the getblocktemplate mining RPC.",
            f"{BIPS}/bip-0022.mediawiki",
        ),
        (
            "BIP-34 places the block height in the coinbase transaction.",
            f"{BIPS}/bip-0034.mediawiki",
        ),
        (
            "BIP-66 requires strict DER encoding for ECDSA signatures.",
            f"{BIPS}/bip-0066.mediawiki",
        ),
        (
            "BIP-125 signals replaceability with an input sequence below 0xfffffffe.",
            f"{BIPS}/bip-0125.mediawiki",
        ),
        (
            "BIP-152 reconstructs compact blocks from a receiver's known transactions.",
            f"{BIPS}/bip-0152.mediawiki",
        ),
        (
            "BIP-157 lets clients fetch compact filters instead of every transaction.",
            f"{BIPS}/bip-0157.mediawiki",
        ),
        (
            "BIP-158 encodes basic compact filters with Golomb-coded sets.",
            f"{BIPS}/bip-0158.mediawiki",
        ),
        (
            "BIP-133 feefilter messages announce a peer's minimum transaction feerate.",
            f"{BIPS}/bip-0133.mediawiki",
        ),
        (
            "BIP-130 sendheaders asks peers to announce new blocks by header.",
            f"{BIPS}/bip-0130.mediawiki",
        ),
        (
            "BIP-159 defines NODE_NETWORK_LIMITED for nodes serving recent blocks.",
            f"{BIPS}/bip-0159.mediawiki",
        ),
        (
            "BIP-339 negotiates transaction relay using witness transaction ids.",
            f"{BIPS}/bip-0339.mediawiki",
        ),
        (
            "Bitcoin Core's mempool holds valid unconfirmed transactions.",
            "https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change",
        ),
    ),
    "Neutral / Multi": (
        (
            "The Bitcoin whitepaper describes peer-to-peer electronic cash without "
            "a trusted third party.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Bitcoin's timestamp server hashes each new record together with the "
            "previous timestamp.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Simplified payment verification checks headers and a Merkle branch.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "The Bitcoin whitepaper recommends a new key pair for each transaction for privacy.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Hashcash prices an email stamp as a partial hash collision.",
            "https://www.hashcash.org/papers/hashcash.pdf",
        ),
        (
            "Wei Dai's b-money described money using a collective ledger of account balances.",
            "https://nakamotoinstitute.org/library/b-money/",
        ),
        (
            "Nick Szabo's bit gold proposal chained proof-of-work strings by timestamp.",
            "https://nakamotoinstitute.org/library/bit-gold/",
        ),
        (
            "A Cypherpunk's Manifesto frames privacy as selective revelation.",
            "https://www.activism.net/cypherpunk/manifesto.html",
        ),
        (
            "Chaum's blind-signature scheme lets a signer sign without seeing the message.",
            "https://chaum.com/wp-content/uploads/2022/01/Chaum-blind-signatures.PDF",
        ),
        (
            "Haber and Stornetta linked document timestamps to reveal later tampering.",
            "https://doi.org/10.1007/3-540-38424-3_32",
        ),
        (
            "OpenPGP packets can carry encrypted data, signatures and public keys.",
            "https://www.rfc-editor.org/rfc/rfc4880.html",
        ),
        (
            "Tor onion services let clients connect without learning a service's network location.",
            "https://spec.torproject.org/rend-spec/introduction.html",
        ),
        (
            "BIP-174 PSBT separates transaction coordination from private-key custody.",
            f"{BIPS}/bip-0174.mediawiki",
        ),
        (
            "BIP-157 compact filters support client-side transaction matching.",
            f"{BIPS}/bip-0157.mediawiki",
        ),
        (
            "NIP-19 encodes Nostr entities in human-readable bech32 strings.",
            f"{NIPS}/19.md",
        ),
        (
            "BOLT 4 reveals only the next routing instruction to each forwarding hop.",
            f"{BOLTS}/04-onion-routing.md",
        ),
        (
            "Bitcoin Core descriptors describe whole families of wallet scripts.",
            f"{CORE}/doc/descriptors.md",
        ),
        (
            "Bitcoin Core signet is a test network with a configurable block-signing challenge.",
            f"{CORE}/doc/developer-notes.md",
        ),
        (
            "Bitcoin Core regtest gives local tests complete control over block production.",
            f"{CORE}/doc/developer-notes.md",
        ),
        (
            "AssumeUTXO can make a node usable while historical validation continues.",
            f"{CORE}/doc/assumeutxo.md",
        ),
        (
            "BIP-39 mnemonic words encode entropy plus a checksum.",
            f"{BIPS}/bip-0039.mediawiki",
        ),
        (
            "BIP-32 extended public keys derive watch-only address branches.",
            f"{BIPS}/bip-0032.mediawiki",
        ),
        (
            "BIP-85 derives repeatable child entropy without storing extra random seeds.",
            f"{BIPS}/bip-0085.mediawiki",
        ),
        (
            "NIP-11 relay documents can advertise software, policy and supported NIPs.",
            f"{NIPS}/11.md",
        ),
        (
            "NIP-78 stores application-specific data in replaceable events.",
            f"{NIPS}/78.md",
        ),
        (
            "BOLT 8 derives fresh transport keys during its authenticated handshake.",
            f"{BOLTS}/08-transport.md",
        ),
        (
            "BIP-152 compact blocks save bandwidth by sending short transaction identifiers.",
            f"{BIPS}/bip-0152.mediawiki",
        ),
        (
            "A reproducible build lets independent builders compare resulting binaries.",
            f"{CORE}/contrib/guix/README.md",
        ),
    ),
}

FORBIDDEN_PUBLIC_PATTERNS = (
    r"\bWalls?\b",
    r"\bregenerat\w*\b",
    r"\bhaste\b",
    r"\bnonblack\b",
    r"\bnonartifact\b",
    r"\bDeathtouch\b",
    r"\bBullish\b",
    r"\bWeb5\b",
)


def flavor_subject(card: dict[str, Any]) -> str:
    """Return the recognizable subject used inside one flavor sentence."""
    if "Avatar" in card["card_type"] and "," in card["name"]:
        return card["name"].partition(",")[2].strip()
    return card["name"]


def flavor_category(card_type: str) -> str:
    """Map compound public types to one editorial flavor pool."""
    if "Avatar" in card_type:
        return "Avatar"
    if "Resource" in card_type:
        return "Resource"
    return card_type


def apply_editorial_copy(cards: list[dict[str, Any]]) -> None:
    """Apply approved names, rules, flavor and sourced notes in place."""
    flavor_offsets: Counter[str] = Counter()
    note_offsets: Counter[str] = Counter()
    for card in cards:
        card_id = card["id"]
        if card_id in NAME_BY_ID:
            old_name = card["name"]
            new_name = NAME_BY_ID[card_id]
            card["name"] = new_name
            for field in ("art_direction", "art_prompt"):
                card[field] = card[field].replace(old_name, new_name)
        if card_id in RULES_BY_ID:
            card["rules_text"] = RULES_BY_ID[card_id]

        category = flavor_category(card["card_type"])
        templates = FLAVOR_TEMPLATES[category]
        template_index = flavor_offsets[category] % len(templates)
        flavor_offsets[category] += 1
        card["flavor_text"] = templates[template_index].format(subject=flavor_subject(card))

        note_category = card["affinity"][0] if len(card["affinity"]) == 1 else "Neutral / Multi"
        note_pool = PROTOCOL_FACTS[note_category]
        note_index = note_offsets[note_category] // 2
        note_offsets[note_category] += 1
        card["protocol_note"], card["protocol_source"] = note_pool[note_index]

        for field in ("art_direction", "art_prompt"):
            text = card[field]
            text = re.sub(r"\bWall(s?)\b", r"Firewall\1", text)
            text = re.sub(r"\bregenerated\b", "Rebooted", text, flags=re.IGNORECASE)
            text = re.sub(r"\bDeathtouch\b", "Lethal", text)
            text = re.sub(
                r"\bhaste\b",
                "the ability to attack without Boot Delay",
                text,
                flags=re.IGNORECASE,
            )
            text = re.sub(r"\bnonartifact\b", "non-Hardware", text, flags=re.IGNORECASE)
            text = re.sub(r"\bnonblack\b", "non-Keys", text, flags=re.IGNORECASE)
            card[field] = text


def validate_editorial_copy(cards: list[dict[str, Any]]) -> list[str]:
    """Return actionable findings for the E1 editorial lock."""
    findings: list[str] = []
    if len(cards) != 295:
        findings.append(f"expected 295 cards, found {len(cards)}")
        return findings

    flavor_counts = Counter(card["flavor_text"] for card in cards)
    note_counts = Counter(card["protocol_note"] for card in cards)
    if max(flavor_counts.values(), default=0) > 1:
        findings.append("flavor text must be unique set-wide")
    if max(note_counts.values(), default=0) > 2:
        findings.append("a Protocol Note appears more than twice")
    if any(len(card["flavor_text"]) > 110 for card in cards):
        findings.append("a flavor line exceeds 110 characters")
    if any(len(card["protocol_note"]) > 120 for card in cards):
        findings.append("a Protocol Note exceeds 120 characters")

    tails: defaultdict[str, list[str]] = defaultdict(list)
    for card in cards:
        tail = re.split(r"[;.!?]\s+", card["flavor_text"])[-1].casefold()
        tails[tail].append(card["id"])
    repeated_tails = {tail: ids for tail, ids in tails.items() if len(ids) > 2}
    if repeated_tails:
        findings.append(f"flavor tail appears more than twice: {repeated_tails}")

    for card in cards:
        public_text = "\n".join(
            (
                card["name"],
                card["rules_text"],
                card["flavor_text"],
                card["protocol_note"],
                card["art_direction"],
                card["art_prompt"],
            )
        )
        for pattern in FORBIDDEN_PUBLIC_PATTERNS:
            if re.search(pattern, public_text, flags=re.IGNORECASE):
                findings.append(f"{card['id']}: forbidden term matches {pattern}")
    return findings


def validate_catalog_shape() -> list[str]:
    """Check that every affinity pool can cover its cards with at most two uses."""
    expected = {
        "Signal": 24,
        "Timelock": 24,
        "Keys": 24,
        "Power": 24,
        "Bitcoin": 24,
        "Neutral / Multi": 28,
    }
    return [
        f"{category}: expected {count} facts, found {len(PROTOCOL_FACTS[category])}"
        for category, count in expected.items()
        if len(PROTOCOL_FACTS[category]) != count
    ]
