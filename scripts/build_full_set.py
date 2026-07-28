"""Build and validate the complete 600B Timelock TCG Edition One text lock.

The historical reference file is read-only and is never copied into the repository.
Before any authored output is written, an ignored SQLite audit database records the
source mechanic fingerprint and the resulting 600B card identity.

Usage:
    python scripts/build_full_set.py --reference PATH/TO/lea-reference.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import re
import sqlite3
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("build_full_set")

SET_NAME = "600B Timelock TCG — Edition One"
SET_CODE = "600B-E1"
TEXT_VERSION = "E1.0-text-lock"

SOURCE_TO_AFFINITY = {
    "W": ("S", "Signal"),
    "U": ("T", "Timelock"),
    "B": ("K", "Keys"),
    "R": ("P", "Power"),
    "G": ("B", "Bitcoin"),
}

RESOURCE_SUBTYPES = {
    "Plains": "Signal",
    "Island": "Timelock",
    "Swamp": "Keys",
    "Mountain": "Power",
    "Forest": "Bitcoin",
}

CHARACTER_ASSETS = {
    "AJ": "aj_concept.png",
    "Arbadacarba": "arbadacarba_concept.png",
    "Bam": "bam_concept.png",
    "Benarc": "benarc_concept.png",
    "BK": "BK_concept.png",
    "BlackCoffee": "blackcoffee_concept.png",
    "Cuddy": "cuddy_concept.png",
    "Darren": "darren_concept.png",
    "DNI": "dni_concept.png",
    "Essex": "essex_concept.png",
    "FLX": "flx_concept.png",
    "Gadaj": "gadaj_concept.png",
    "Jedai": "jedai_concept.png",
    "Leon": "leon.png",
    "Longy": "longy_concept.png",
    "MadMunky": "madmunkey_concept.png",
    "MHB": "mhb_comcept.png",
    "Michael1011": "michael1011_concept.png",
    "Morgs": "morgs_concept.png",
    "Mtoshi": "mtoshi.png",
    "NC": "nc_concept.png",
    "Nind": "nind_concept.png",
    "Proton": "proton_concept.png",
    "Rootzoll": "rootzoll_concept.png",
    "Sat": "sat_concept.png",
    "Shillie": "shillie_concept.png",
    "Snick": "snick_concept.png",
    "Tal": "tal_concept.png",
    "Tobo": "tobo_concept.png",
    "Toni China": "tonichina_concept.png",
}

# Original public-facing names, in the historical mechanic-slot order 1–295.
# The source names are intentionally not stored here.
CARD_NAMES = tuple(
    line.strip()
    for line in """
Firmware for Firewalls
Grid Reset
Fair State
Cuddy, Signal Organizer
Keys Shield
Last Broadcast
Shared Uptime
Timelock Shield
Local Citadel
Timelock Protection Circuit
Bitcoin Protection Circuit
Power Protection Circuit
Signal Protection Circuit
Hardened Resource
Grid Conversion
Public Goods Drive
Emergency Reboot
Protocol Cleanup
Home Miner
Bitcoin Shield
Guardian Signal
Repair Packet
Hardened Identity
Community Strength
Offline Sanctuary
Consequence Ledger
Fast Path
Sat, Relay Rider
MHB, Keys Auditor
Morgs, Friendly Fork
AJ, Uptime Anchor
Signal Rewrite
Power Shield
Archive Restore
Damage Refund
Courage Under Load
AJ, First Responder
Cuddy, Fast Starter
FLX, Culture Curator
Peaceful Exit
MHB, Community Shield
Sat, Blade Firewall
Morgs, Signal Knight
Signal Shield
Clean Slate
Michael1011, Packet Shaper
First Memory
Boot Hardware
Power Invalidation
Query Burst
Benarc, Mirror Client
Remote Control
Hardware Clone
Invalid Signature
Exit Fee
Buffer Drain
Relay Feedback
Broadcast Upgrade
Hidden Route
Quick Uplink
Resource Tap
Tal, Relay Captain
Resource Rewrite
Jedai, Protocol Architect
Buffer Lock
Darren, Channel Operator
Snick, Phantom Process
Resource Reclassification
Tal, Ghost Router
Darren, Channel Raider
Maintenance Leak
Fee Spike
Michael1011, Debugger
Cognitive Surge
Hot Resource
Benarc, Deep Channel
Call to Relay
Affinity Rewrite
Queue Filter
Consensus Pause
Remote Hardware Control
Timelock Rewrite
Next Block
State Reset
Toggle State
Return to Wallet
Jedai, Adaptive Client
Grid Eruption
Snick, Airgap Firewall
Tal, Liquid Firewall
Darren, Flow Controller
Archive Boot
Multisig Quorum
DNI, Sovereign Knight
Nind, Backchannel Walker
Stake Contract
Leaking Key Vault
Proof of Work
Stake Swap
Bitcoin Gatekeeper
Keys Rewrite
Stake Arbitration
NC, Resource Reclaimer
Deep Search
Uptime Channel
BlackCoffee, Reboot Crew
Resource Corruption
Onion Route
Proton, Cold Signer
Signal Tax
Burst Signature
Gadaj, Wallet Whisperer
Sovereign Mode
DNI, Self-Custody Giant
Wallet Scramble
Nind, Archive Returner
NC, Forced Signal
Proton, Keyed Nightmare
Locked Process
Broadcast Storm
BlackCoffee, Shared Secret Swarm
Restore Backup
Gadaj, Commit Auditor
Convert Uptime
NC, Offline Operator
Nind, Archive Collector
DNI, Sovereign Accumulator
State Mirror
Resource Sink
Hard Shutdown
Sovereign Strength
BlackCoffee, Backup Firewall
Hardware Leak
Reduced Permissions
Proton, Ephemeral Signer
Remote Command
Gadaj, Archive Maintainer
Tunneling Patch
Power Rewrite
Final Settlement
MadMunky, Young Overclocker
Rootzoll, Hardware Breaker
Bam, Tunnel Builder
Leon, Grid Stabilizer
Grounded Signal
Hashquake
Route Misdirection
Essex, Thermal Operator
Power Burst
Overclock
Signal Outage
Process Fork
Toni China, Hot-Air Relay
MadMunky, Chaos Coordinator
Rootzoll, Stone Sentinel
Leon, Shift Worker
Bam, Heavy Lifter
Essex, Bull Runner
Toni China, Rough Miner
Rootzoll, Crew Multiplier
Zap
Grid Amplifier
Hot Grid
MadMunky, Meme Raider
Bam, Power Artillery
Miner Rally
Idle Grid Penalty
Split Route
Timelock Invalidation
Leon, High Relay Rider
Toni China, Multihead Miner
Essex, Grid Rebooter
Hardware Shatter
MadMunky, Hashrate Dragon
Thermal Throttle
Bam, Launch Engineer
Resource Cut
Firewall Tunnel
Rootzoll & Leon, Dual Operator
Essex, Resilient Operator
Toni China, Thermal Firewall
Rootzoll, Stone Firewall
Freedom Market
Hashrate Aura
Committed Growth
Shillie, Multisource Scout
Obfuscated Formation
Human Hashrate
Mtoshi, Deathtouch Courier
Longy, Deep Node
Tobo, First-Strike Archer
Fast Channel
Quiet Block
Arbadacarba, Natural Hashrate
BK, Feedback Grower
Longy, Resource Sovereign
Number Go Up
Shillie, Mesh Sentinel
BK, Bear Market Builder
Network Storm
Resource Freeze
Instant Boot
Mtoshi, Rooted Node
Migrating Workload
Tobo, Resource Unlocker
Keys Invalidation
Bitcoin Rewrite
Living Hardware
Resource Awakening
Arbadacarba, Grid Steward
Attention Market
Topology Scan
Reboot Protocol
Recovery Phrase
Shillie, Tiny Broadcaster
Tobo, Bitcoin Backchanneler
Uptime Stream
Mtoshi, Finality Keeper
BK, Mesh Pack
Protocol Reset
Timelock Outage
Arbadacarba, Protocol Gardener
Longy, Thorn Firewall
Shillie, Cold Firewall
Tobo, Wooden Firewall
Restless Client
BK, Heavy Settler
Mesh Upgrade
Yield Router
Entry Fee Device
Basalt Battery
Genesis Lotus
Wallet Pressure
Resource Prism
Chaos Kernel
Cuddy, Clockwork Node
Damage Limiter
Uptime Clock
Timelock Receiver
Resource Tombstone
Resource Exit Sensor
Wallet Scrubber
Damage Firewall
Hashrate Gauntlet
Public Wallet Viewer
Mesh Router
Open Feed
Cold Storage Controller
Identity Mask
Power Receiver
Signal Receiver
Damage Router
Hot Wallet Statue
Genesis Archive
FLX, Unstoppable Rig
Keyed Resource Bell
Memory Palace
MHB, Living Firewall
Boost Converter
Low-Power Mode
Bitcoin Seed
Keys Shard
Signal Beacon
Power Cell
Timelock Crystal
Network Reset Disk
Michael1011, Obsidian Node
Fault Injector
Genesis Ring
Archive Listener
Resource Converter
Swarm Node
Keys Receiver
Timelock Vault
Difficulty Winter
Bitcoin Receiver
Power–Keys Junction
Keys–Bitcoin Junction
Power–Signal Junction
Bitcoin–Signal Junction
Signal–Keys Junction
Power–Bitcoin Junction
Bitcoin–Timelock Junction
Signal–Timelock Junction
Timelock–Keys Junction
Signal Commons — Sunrise
Signal Commons — Rooftop
Timelock Channel — Dawn
Timelock Channel — Midnight
Key Vault — Workshop
Key Vault — Cold Room
Power Plant — Solar
Power Plant — Hydro
Satoshi Orchard
Satoshi Orchard — Commons
""".strip().splitlines()
)

LOCKED_IDS = {
    232: "E1-001",
    294: "E1-002",
    39: "E1-003",
    161: "E1-004",
    83: "E1-005",
    93: "E1-006",
}

RULE_OVERRIDES = {
    39: "Broadcast\nFLX stays unlocked after attacking.",
    83: "After this turn, take one additional turn.",
    93: "Keys Avatars get +1 Action and +1 Resilience.",
    96: (
        "Stake module — Add the top card of your Stack to the Stake. Discard your "
        "Wallet, then draw seven cards."
    ),
    99: (
        "Stake module — Exchange ownership of the top card of your Stake with one "
        "random card from your opponent's Stake."
    ),
    102: (
        "Stake module — Each player may add the top card of their Stack to the Stake. "
        "If your opponent declines, you may play this again without paying its cost."
    ),
    105: (
        "Spend only Keys Resources to pay X. Uptime Channel deals X damage to any "
        "target. You gain Uptime equal to the damage dealt, up to that target's "
        "Uptime or Resilience before the damage."
    ),
    136: (
        "Look at an opponent's Wallet and choose a card they can play. You control "
        "that player while they play the chosen card. Resources from their Buffer "
        "may be spent only for that card."
    ),
    161: "Zap deals 3 damage to any target.",
    187: (
        "Play only before blockers are declared. You split your attacking Avatars "
        "into piles. The defending player chooses which pile each blocker can block."
    ),
    232: (
        "Commit and archive Genesis Lotus: generate three Resources of one affinity."
    ),
    235: (
        "Toss module — Commit: toss Chaos Kernel from at least one card-height above "
        "the Network. Archive each non-proxy card it touches, then archive Chaos Kernel."
    ),
    240: (
        "2, Commit: put a mire marker on target non-Keys Resource. It is a Keys "
        "Resource while it has a mire marker. Use only during your Maintenance.\n"
        "If Resource Tombstone moves from the Network to an Archive, then at the "
        "beginning of each of your Maintenance steps for the rest of the game, choose "
        "a Resource that still has a mire marker placed by Resource Tombstone and "
        "remove all those markers from it."
    ),
    249: (
        "X: deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar. "
        "Turn it face up when it would deal or receive damage, or become committed. "
        "X must cover its deploy cost."
    ),
    272: (
        "5, Commit: create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast. "
        "Name it Swarm Drone."
    ),
    274: (
        "Timelock Vault enters committed. It does not unlock normally. You may skip a "
        "turn to unlock it. Commit: after this turn, take one additional turn."
    ),
}

PROTOCOL_NOTES = {
    "Signal": (
        (
            "Nostr events are signed data; relays distribute them without owning identity.",
            "https://github.com/nostr-protocol/nips/blob/master/01.md",
        ),
        (
            "A Nostr public key identifies an account across compatible clients.",
            "https://github.com/nostr-protocol/nips/blob/master/01.md",
        ),
        (
            "NIP-05 links a human-readable internet identifier to a Nostr public key.",
            "https://github.com/nostr-protocol/nips/blob/master/05.md",
        ),
        (
            "NIP-57 defines Lightning zaps as signed value signals around Nostr events.",
            "https://github.com/nostr-protocol/nips/blob/master/57.md",
        ),
        (
            "Nostr clients can use many relays, reducing dependence on one operator.",
            "https://github.com/nostr-protocol/nips/blob/master/01.md",
        ),
        (
            "NIP-25 expresses reactions as portable signed events.",
            "https://github.com/nostr-protocol/nips/blob/master/25.md",
        ),
    ),
    "Timelock": (
        (
            "Bitcoin timelocks can delay when a transaction output becomes spendable.",
            "https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki",
        ),
        (
            "CHECKLOCKTIMEVERIFY enforces an absolute time or block-height condition.",
            "https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki",
        ),
        (
            "CHECKSEQUENCEVERIFY enables relative timelocks measured from confirmation.",
            "https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki",
        ),
        (
            "Median past time gives Bitcoin scripts a network-derived time reference.",
            "https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki",
        ),
        (
            "Lightning uses timelocks so outdated channel states can be challenged.",
            "https://github.com/lightning/bolts/blob/master/03-transactions.md",
        ),
        (
            "Block headers link to prior blocks, making history expensive to rewrite.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
    ),
    "Keys": (
        (
            "Control of private keys authorizes spending; a wallet helps manage them.",
            "https://developer.bitcoin.org/devguide/wallets.html",
        ),
        (
            "BIP-32 derives many wallet keys from one hierarchical root.",
            "https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki",
        ),
        (
            "BIP-39 encodes wallet backup entropy as a mnemonic sentence.",
            "https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki",
        ),
        (
            "Schnorr signatures support simple, precise verification rules in Bitcoin.",
            "https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki",
        ),
        (
            "Multisignature policies can require several independent approvals.",
            "https://developer.bitcoin.org/devguide/transactions.html#multisig",
        ),
        (
            "Nostr users can move between clients because identity lives in key pairs.",
            "https://github.com/nostr-protocol/nips/blob/master/01.md",
        ),
    ),
    "Power": (
        (
            "Proof of work makes proposing Bitcoin blocks computationally costly.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Bitcoin adjusts mining difficulty to target a stable block interval.",
            "https://developer.bitcoin.org/devguide/block_chain.html#proof-of-work",
        ),
        (
            "Miners assemble candidate blocks while full nodes verify every rule.",
            "https://developer.bitcoin.org/devguide/mining.html",
        ),
        (
            "Hashing turns variable input into a fixed-size result used in proof of work.",
            "https://developer.bitcoin.org/reference/block_chain.html",
        ),
        (
            "A valid block must satisfy both proof-of-work and consensus rules.",
            "https://developer.bitcoin.org/devguide/block_chain.html",
        ),
        (
            "Mining rewards combine newly issued bitcoin with transaction fees.",
            "https://developer.bitcoin.org/devguide/mining.html",
        ),
    ),
    "Bitcoin": (
        (
            "Bitcoin nodes independently validate transactions and blocks.",
            "https://developer.bitcoin.org/devguide/p2p_network.html",
        ),
        (
            "A UTXO is an unspent transaction output that can fund a later transaction.",
            "https://developer.bitcoin.org/devguide/transactions.html",
        ),
        (
            "Bitcoin issuance is bounded by consensus and declines through halvings.",
            "https://bitcoin.org/bitcoin.pdf",
        ),
        (
            "Transaction fees express demand for scarce block space.",
            "https://developer.bitcoin.org/devguide/transactions.html#transaction-fees-and-change",
        ),
        (
            "A full node checks rules locally instead of trusting a remote verdict.",
            "https://developer.bitcoin.org/devguide/p2p_network.html",
        ),
        (
            "Taproot combines Schnorr signatures with flexible spending conditions.",
            "https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki",
        ),
    ),
    "Neutral": (
        (
            "Open protocols let independent implementations interoperate.",
            "https://github.com/bitcoin/bips",
        ),
        (
            "PSBT lets multiple tools coordinate signing without sharing private keys.",
            "https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki",
        ),
        (
            "Compact block filters support private, bandwidth-efficient wallet queries.",
            "https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki",
        ),
        (
            "Lightning payments use onion routing to limit who learns the full path.",
            "https://github.com/lightning/bolts/blob/master/04-onion-routing.md",
        ),
        (
            "NIP-19 gives Nostr identifiers human-friendly bech32 encodings.",
            "https://github.com/nostr-protocol/nips/blob/master/19.md",
        ),
        (
            "Open specifications make protocol behavior reviewable and reusable.",
            "https://github.com/nostr-protocol/nips",
        ),
    ),
}

FORBIDDEN_RULE_TERMS = (
    r"\bcreatures?\b",
    r"\blands?\b",
    r"\bartifacts?\b",
    r"\benchantments?\b",
    r"\bsorcer(?:y|ies)\b",
    r"\binstants?\b",
    r"\bplaneswalker\b",
    r"\bbattlefield\b",
    r"\bgraveyard\b",
    r"\blibrary\b",
    r"\bexile\b",
    r"\bmana\b",
    r"\buntap(?:ped|s|ping)?\b",
    r"\btap(?:ped|s|ping)?\b",
    r"\bflying\b",
    r"\btrample\b",
    r"\bbanding\b",
    r"\bregenerate\b",
    r"\bprotection from\b",
    r"\b(?:forest|island|swamp|mountain|plains)s?\b",
    r"\bauras?\b",
    r"\benchanted\b",
    r"\bnontoken\b",
    r"\btokens?\b",
    r"\bsacrific(?:e|es|ed|ing)\b",
    r"\bdestroy(?:s|ed|ing)?\b",
    r"\breach\b",
)


@dataclass(frozen=True)
class CharacterRef:
    """One or more official 600B characters used by an Avatar card."""

    source: str
    names: list[str]
    assets: list[str]


@dataclass(frozen=True)
class CardRecord:
    """One complete authored Edition One card."""

    id: str
    source_slot: int
    mechanic_fingerprint: str
    name: str
    card_type: str
    subtype: str
    affinity: list[str]
    cost: str
    action_resilience: str
    rarity: str
    rules_text: str
    help_text: str
    protocol_note: str
    protocol_source: str
    character: CharacterRef | None
    art_direction: str
    art_prompt: str
    status: str

    @property
    def type_line(self) -> str:
        """Return the public card type line."""
        return f"{self.card_type} — {self.subtype}" if self.subtype else self.card_type


def mechanic_hash(source: dict[str, Any]) -> str:
    """Hash only the mechanic-bearing source fields used by the adapter."""
    fields = {
        "slot": int(source["collector_number"]),
        "cost": source.get("mana_cost", ""),
        "type": source.get("type_line", ""),
        "text": source.get("oracle_text", ""),
        "power": source.get("power", ""),
        "toughness": source.get("toughness", ""),
    }
    payload = json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(payload).hexdigest()


def assigned_ids() -> dict[int, str]:
    """Assign the six iconic cards first, then preserve source-slot order."""
    result = dict(LOCKED_IDS)
    next_number = 7
    for slot in range(1, 296):
        if slot in result:
            continue
        result[slot] = f"E1-{next_number:03d}"
        next_number += 1
    return result


def convert_cost(source_cost: str) -> str:
    """Convert a reference cost to compact 600B resource notation."""
    tokens = re.findall(r"\{([^}]+)\}", source_cost)
    converted: list[str] = []
    for token in tokens:
        converted.append(SOURCE_TO_AFFINITY.get(token, (token, token))[0])
    return "".join(converted)


def convert_symbol_runs(text: str) -> str:
    """Convert inline symbol runs to compact 600B notation."""

    def replace_run(match: re.Match[str]) -> str:
        tokens = re.findall(r"\{([^}]+)\}", match.group(0))
        converted: list[str] = []
        for token in tokens:
            if token == "T":
                converted.append("Commit")
            elif token == "Q":
                converted.append("Unlock")
            elif token == "C":
                converted.append("N")
            else:
                converted.append(SOURCE_TO_AFFINITY.get(token, (token, token))[0])
        return "".join(converted)

    return re.sub(r"(?:\{[^}]+\})+", replace_run, text)


def replace_words(text: str) -> str:
    """Apply the public 600B rules vocabulary to reference prose."""
    phrases = (
        (r"\bfirst strike\b", "First Strike"),
        (r"\bdouble strike\b", "Double Strike"),
        (r"\bprotection from\b", "Shielded from"),
        (r"\bforestwalk\b", "Backchannel—Bitcoin"),
        (r"\bislandwalk\b", "Backchannel—Timelock"),
        (r"\bmountainwalk\b", "Backchannel—Power"),
        (r"\bplainswalk\b", "Backchannel—Signal"),
        (r"\bswampwalk\b", "Backchannel—Keys"),
        (r"\bsummoning sickness\b", "Boot Delay"),
        (r"\bconverted mana cost\b", "total resource cost"),
        (r"\bmana value\b", "total resource cost"),
        (r"\bmana pool\b", "Buffer"),
        (r"\btarget spell\b", "target card on the Queue"),
        (r"\bspell(s?)\b", r"card\1 on the Queue"),
        (r"\bpermanent(s?)\b", r"Network card\1"),
        (r"\bbattlefield\b", "Network"),
        (r"\bgraveyard\b", "Archive"),
        (r"\blibrary\b", "Stack"),
        (r"\bhand\b", "Wallet"),
        (r"\bexile(?:d)?\b", "Cold Storage"),
        (r"\bcreature(s?)\b", r"Avatar\1"),
        (r"\bartifact(s?)\b", r"Hardware\1"),
        (r"\benchantment(s?)\b", r"Protocol\1"),
        (r"\binstant(s?)\b", r"Zap\1"),
        (r"\bsorcer(?:y|ies)\b", "Operation"),
        (r"\bland(s?)\b", r"Resource\1"),
        (r"\bpower\b", "Action"),
        (r"\btoughness\b", "Resilience"),
        (r"\bPlains\b", "Signal Resource"),
        (r"\bIslands\b", "Timelock Resources"),
        (r"\bIsland\b", "Timelock Resource"),
        (r"\bSwamps\b", "Keys Resources"),
        (r"\bSwamp\b", "Keys Resource"),
        (r"\bMountains\b", "Power Resources"),
        (r"\bMountain\b", "Power Resource"),
        (r"\bForests\b", "Bitcoin Resources"),
        (r"\bForest\b", "Bitcoin Resource"),
        (r"\bwhite\b", "Signal"),
        (r"\bblue\b", "Timelock"),
        (r"\bblack\b", "Keys"),
        (r"\bred\b", "Power"),
        (r"\bgreen\b", "Bitcoin"),
        (r"\bcolorless\b", "neutral"),
        (r"\bcolors\b", "affinities"),
        (r"\bcolor\b", "affinity"),
        (r"\bmana\b", "Resource"),
        (r"\buntapping\b", "unlocking"),
        (r"\buntaps\b", "unlocks"),
        (r"\buntapped\b", "unlocked"),
        (r"\buntap\b", "unlock"),
        (r"\btapping\b", "committing"),
        (r"\btaps\b", "commits"),
        (r"\btapped\b", "committed"),
        (r"\btap\b", "commit"),
        (r"\bflying\b", "Broadcast"),
        (r"\btrample\b", "Overflow"),
        (r"\bbanding\b", "Mesh"),
        (r"\bdefender\b", "Firewall"),
        (r"\bregenerate\b", "Reboot"),
        (r"\bregeneration\b", "Reboot"),
        (r"\bdestroying\b", "decommissioning"),
        (r"\bdestroys\b", "decommissions"),
        (r"\bdestroyed\b", "decommissioned"),
        (r"\bdestroy\b", "decommission"),
        (r"\bdies\b", "is decommissioned"),
        (r"\bdie\b", "be decommissioned"),
        (r"\bsacrifices\b", "archives"),
        (r"\bsacrificed\b", "archived"),
        (r"\bsacrificing\b", "archiving"),
        (r"\bsacrifice\b", "archive"),
        (r"\bnontoken\b", "non-proxy"),
        (r"\btoken(s?)\b", r"proxy\1"),
        (r"\bAuras\b", "Attachments"),
        (r"\bAura\b", "Attachment"),
        (r"\benchanted\b", "attached"),
        (r"\bcast(?:ing|s)?\b", "play"),
        (r"\bupkeep\b", "Maintenance"),
        (r"\bcombat\b", "clash"),
        (r"\blife total\b", "Uptime"),
        (r"\blife\b", "Uptime"),
        (r"\bante\b", "Stake"),
        (r"\bplayer or planeswalker\b", "player"),
        (r"\bplaneswalker's\b", "player's"),
        (r"\bplaneswalker\b", "player"),
    )
    for pattern, replacement in phrases:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    text = re.sub(
        r"get(s?) ([+-]\d+)/([+-]\d+)",
        r"get\1 \2 Action and \3 Resilience",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"base Action and Resilience ([^.\n]+)",
        r"base Action/Resilience \1",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bcounter target card on the Queue\b",
        "Invalidate target card on the Queue",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bcountered\b", "invalidated", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcounters\b", "markers", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcounter\b", "marker", text, flags=re.IGNORECASE)
    text = re.sub(
        r"Target player draws (X|\d+|one|two|three|four|five|six|seven) cards?\.",
        r"Target player moves the top \1 cards of their Stack into their Wallet.",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"Target player discards ([X\d]+) cards at random\.",
        r"Randomly choose \1 cards from target player's Wallet; that player discards them.",
        text,
        flags=re.IGNORECASE,
    )
    if text.casefold() == "first strike":
        text = "First Strike — deals clash damage before Avatars without First Strike."
    text = re.sub(r"\bAdd ([STKPB]+)\b", _replace_add_affinity, text, flags=re.IGNORECASE)
    text = re.sub(r"\bAdd (N+)\b", _replace_add_neutral, text, flags=re.IGNORECASE)
    text = re.sub(
        r"\badds? one Resource of any affinity\b",
        "generate 1 Resource of any affinity",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\badds? one Resource of any type that Resource produced\b",
        "generates 1 additional Resource of an affinity that Resource produced",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\badds? an additional ([STKPB])\b",
        _replace_additional_affinity,
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bAdd an amount of ([STKPB]) equal to\b",
        _replace_variable_affinity,
        text,
        flags=re.IGNORECASE,
    )
    text = text.replace(
        "you add the Resource lost this way",
        "you put the lost Resources into your Buffer",
    )
    text = re.sub(r"\bEnchant\b", "Attach to", text, flags=re.IGNORECASE)
    text = text.replace(
        "Broadcast (This Avatar can't be blocked except by Avatars with Broadcast or reach.)",
        "Broadcast (Only Avatars with Broadcast or Broadcast Guard can block it.)",
    )
    text = re.sub(r"\breach\b", "Broadcast Guard", text, flags=re.IGNORECASE)
    text = text.replace("an Protocol", "a Protocol")
    text = text.replace("this Avatars owner", "this Avatar's owner")
    text = text.replace("a Avatar", "an Avatar")
    text = text.replace("a Archive", "an Archive")
    text = text.replace("Hardwares", "Hardware")
    text = re.sub(
        r"Reach \(This Avatar can block Avatars with Broadcast\.\)",
        "This Avatar can block Avatars with Broadcast.",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _affinity_name(letter: str) -> str:
    """Resolve one public affinity code."""
    return next(name for code, name in SOURCE_TO_AFFINITY.values() if code == letter)


def _replace_add_affinity(match: re.Match[str]) -> str:
    letters = match.group(1).upper()
    counts = Counter(letters)
    generated = []
    for letter, count in counts.items():
        noun = "Resource" if count == 1 else "Resources"
        generated.append(f"{count} {_affinity_name(letter)} {noun}")
    return "generate " + " and ".join(generated)


def _replace_additional_affinity(match: re.Match[str]) -> str:
    return f"generates 1 additional {_affinity_name(match.group(1).upper())} Resource"


def _replace_variable_affinity(match: re.Match[str]) -> str:
    return (
        f"Generate that many {_affinity_name(match.group(1).upper())} Resources, "
        "equal to"
    )


def _replace_add_neutral(match: re.Match[str]) -> str:
    count = len(match.group(1))
    noun = "Resource" if count == 1 else "Resources"
    return f"generate {count} neutral {noun}"


def rewrite_rules(source: dict[str, Any], slot: int, name: str) -> str:
    """Create functional rules text in original 600B language."""
    if slot in RULE_OVERRIDES:
        return RULE_OVERRIDES[slot]
    if "Land" in source.get("type_line", "").partition("—")[0]:
        subtypes = source["type_line"].split("—", maxsplit=1)[-1].strip().split()
        generated = [
            RESOURCE_SUBTYPES[item] for item in subtypes if item in RESOURCE_SUBTYPES
        ]
        choices = " or ".join(f"1 {affinity}" for affinity in generated)
        return f"Commit: generate {choices}."
    source_text = source.get("oracle_text") or ""
    source_name = source.get("name", "")
    self_marker = "SELF_CARD_NAME"
    text = source_text.replace(source_name, self_marker)
    text = convert_symbol_runs(text)
    text = replace_words(text)
    text = text.replace(self_marker, name)
    if text.startswith("(") and text.endswith(")") and text.count("(") == 1:
        text = text[1:-1]
    text = "\n".join(
        paragraph[:1].upper() + paragraph[1:] if paragraph else paragraph
        for paragraph in text.splitlines()
    )
    if not text and "Creature" in source.get("type_line", ""):
        return "No special ability."
    return text


def public_type(source_type: str) -> tuple[str, str]:
    """Translate the source type line to Edition One public card types."""
    before, _, after = source_type.partition("—")
    base = before.strip()
    source_subtypes = after.strip().split()
    if "Artifact" in base and "Creature" in base:
        return "Hardware Avatar", ""
    if "Creature" in base:
        return "Avatar", ""
    if "Land" in base:
        mapped = [RESOURCE_SUBTYPES[item] for item in source_subtypes if item in RESOURCE_SUBTYPES]
        prefix = "Basic " if "Basic" in base else ""
        return f"{prefix}Resource", " / ".join(mapped)
    if "Artifact" in base:
        return "Hardware", "Archive" if "Book" in source_subtypes else ""
    if "Enchantment" in base:
        return "Protocol", "Attachment" if "Aura" in source_subtypes else ""
    if "Instant" in base:
        return "Zap", ""
    if "Sorcery" in base:
        return "Operation", ""
    raise ValueError(f"unsupported source type: {source_type}")


def infer_avatar_subtype(name: str) -> str:
    """Infer a readable role subtype from a 600B character title."""
    title = name.partition(",")[2].strip().lower()
    if "firewall" in title:
        return "Firewall"
    if "node" in title or "rig" in title:
        return "Node"
    if any(word in title for word in ("miner", "hashrate", "overclock")):
        return "Miner"
    if any(word in title for word in ("key", "signer", "wallet", "auditor")):
        return "Signer"
    if any(word in title for word in ("relay", "broadcast", "channel")):
        return "Broadcaster"
    if any(word in title for word in ("builder", "engineer", "steward")):
        return "Builder"
    if any(word in title for word in ("knight", "sentinel", "shield", "keeper")):
        return "Guardian"
    if any(word in title for word in ("client", "process", "router")):
        return "Client"
    return "Operator"


def affinity_for(source: dict[str, Any]) -> list[str]:
    """Return public affinities from source colors or Resource subtypes."""
    colors = source.get("colors") or []
    affinities = [SOURCE_TO_AFFINITY[color][1] for color in colors if color in SOURCE_TO_AFFINITY]
    if affinities:
        return affinities
    source_type = source.get("type_line", "")
    return [name for old, name in RESOURCE_SUBTYPES.items() if old in source_type]


def character_ref(name: str, card_type: str) -> CharacterRef | None:
    """Resolve official full-body assets for every Avatar card."""
    if "Avatar" not in card_type:
        return None
    heading = name.partition(",")[0].strip()
    character_names = [part.strip() for part in heading.split("&")]
    assets = [CHARACTER_ASSETS[character_name] for character_name in character_names]
    return CharacterRef(
        source="join.600.wtf / official 600B fullbody standard",
        names=character_names,
        assets=assets,
    )


def protocol_note(slot: int, affinities: list[str]) -> tuple[str, str]:
    """Select a short positive educational note and its primary source."""
    category = affinities[0] if len(affinities) == 1 else "Neutral"
    notes = PROTOCOL_NOTES.get(category, PROTOCOL_NOTES["Neutral"])
    return notes[(slot - 1) % len(notes)]


def simple_help(card_type: str, rules_text: str, affinities: list[str]) -> str:
    """Explain a card's practical job in short, beginner-friendly language."""
    text = rules_text.casefold()
    affinity = affinities[0] if len(affinities) == 1 else "your strategy"
    if "resource" in card_type.casefold():
        if len(affinities) > 1:
            return "Play this as your Resource for the turn. Commit it to pay in either affinity."
        return f"Play this as your Resource for the turn. Commit it to generate {affinity}."

    effects: list[str] = []
    if "additional turn" in text:
        effects.append("Gives you another full turn after this one")
    if "invalidate" in text:
        effects.append("Stops a card on the Queue before it resolves")
    if "draw" in text:
        effects.append("Puts more cards in your Wallet")
    if "discard" in text:
        effects.append("Reduces the options in an opponent's Wallet")
    if "damage" in text:
        effects.append("Deals or redirects damage")
    if "decommission" in text:
        effects.append("Removes a card from the Network")
    if "archive" in text:
        effects.append("Moves a card into an Archive")
    if "reboot" in text:
        effects.append("Can keep an Avatar in the Network after damage")
    if "broadcast" in text:
        effects.append("Can usually be blocked only by another Broadcaster")
    if "backchannel" in text:
        effects.append("Can slip past players using the named Resource")
    if "overflow" in text:
        effects.append("Can push excess clash damage through to Uptime")
    if "mesh" in text:
        effects.append("Can coordinate with other Mesh Avatars during clashes")
    if "shielded from" in text:
        effects.append("Resists the named affinity")
    if "generate" in text:
        effects.append("Generates extra Resources for larger plays")
    if "gets +" in text:
        effects.append("Makes an Avatar stronger")
    if "unlock" in text:
        effects.append("Lets a committed card become usable again")
    if "commit" in text and not effects:
        effects.append("Uses committing as the cost for a repeatable effect")

    if effects:
        return ". ".join(effects[:2]) + "."
    if "Avatar" in card_type:
        return "Deploy this Avatar to defend your Uptime or pressure an opponent."
    if card_type == "Hardware":
        return "Deploy this Hardware for a lasting tool you can build around."
    if card_type == "Protocol":
        return "Deploy this Protocol to change how the Network behaves over time."
    if card_type == "Zap":
        return "Play this while other cards wait on the Queue to make a timely response."
    return "Play this during your main phase for a one-time strategic effect."


def art_textures(affinities: list[str]) -> str:
    """Describe the palette accent for an art brief."""
    if not affinities:
        return "orange energy, ultraviolet signal traces and matte-black hardware"
    return ", ".join(affinities) + " motifs with orange and ultraviolet accents"


def art_for(
    name: str,
    card_type: str,
    affinities: list[str],
    character: CharacterRef | None,
    rules_text: str,
) -> tuple[str, str]:
    """Create an art direction and generation prompt without card typography."""
    palette = art_textures(affinities)
    mechanic_hint = rules_text.splitlines()[0].rstrip(".")
    if character:
        cast = " and ".join(character.names)
        direction = (
            f"{cast} turns “{mechanic_hint}” into a constructive cypherpunk scene; "
            "official silhouette and wardrobe stay recognizable."
        )
        prompt = (
            f"Portrait trading-card artwork, no border, no text, no symbols. Use only "
            f"the supplied official 600Billion full-body reference asset(s) for {cast}; "
            f"do not invent background people. Positive cypherpunk workshop, {palette}, "
            f"black core, tactile screenprint grain, confident readable silhouette. "
            f"Visualize this mechanic without words: {mechanic_hint}. Vertical 5:4 crop."
        )
        return direction, prompt
    subject = {
        "Resource": "an open community infrastructure site",
        "Basic Resource": "an open community infrastructure site",
        "Hardware": "a practical open-source device",
        "Protocol": "an abstract but understandable protocol diagram made physical",
        "Zap": "a precise burst of network action",
        "Operation": "a coordinated network-wide event",
    }.get(card_type, "a constructive protocol moment")
    direction = f"{subject.capitalize()} visualizes “{mechanic_hint}” without characters."
    prompt = (
        f"Portrait trading-card artwork, no border, no text, no logos, no people. "
        f"Show {subject}, {palette}, black center values, purple shadows, warm orange "
        f"highlights, optimistic cypherpunk editorial realism, tactile screenprint grain. "
        f"Visualize this mechanic without words: {mechanic_hint}. Vertical 5:4 crop."
    )
    return direction, prompt


def build_cards(source_cards: list[dict[str, Any]]) -> list[CardRecord]:
    """Adapt all 295 reference mechanic slots into original 600B cards."""
    if len(CARD_NAMES) != 295:
        raise ValueError(f"CARD_NAMES must contain 295 names, found {len(CARD_NAMES)}")
    by_slot = {int(card["collector_number"]): card for card in source_cards}
    if set(by_slot) != set(range(1, 296)):
        raise ValueError("reference must contain mechanic slots 1 through 295 exactly once")

    ids = assigned_ids()
    cards: list[CardRecord] = []
    for slot in range(1, 296):
        source = by_slot[slot]
        name = CARD_NAMES[slot - 1]
        card_type, subtype = public_type(source["type_line"])
        if "Avatar" in card_type:
            subtype = infer_avatar_subtype(name)
        affinities = affinity_for(source)
        rules_text = rewrite_rules(source, slot, name)
        character = character_ref(name, card_type)
        note, note_source = protocol_note(slot, affinities)
        help_text = simple_help(card_type, rules_text, affinities)
        art_direction, art_prompt = art_for(
            name, card_type, affinities, character, rules_text
        )
        ar = ""
        if source.get("power") is not None:
            ar = f"{source['power']}/{source['toughness']}"
        cards.append(
            CardRecord(
                id=ids[slot],
                source_slot=slot,
                mechanic_fingerprint=mechanic_hash(source),
                name=name,
                card_type=card_type,
                subtype=subtype,
                affinity=affinities,
                cost=convert_cost(source.get("mana_cost", "")),
                action_resilience=ar,
                rarity=source.get("rarity", "common"),
                rules_text=rules_text,
                help_text=help_text,
                protocol_note=note,
                protocol_source=note_source,
                character=character,
                art_direction=art_direction,
                art_prompt=art_prompt,
                status="text-locked",
            )
        )
    return sorted(cards, key=lambda card: card.id)


def validate_cards(
    cards: list[CardRecord], source_cards: list[dict[str, Any]]
) -> list[str]:
    """Run consistency and originality checks; return human-readable findings."""
    errors: list[str] = []
    if len(cards) != 295:
        errors.append(f"expected 295 cards, found {len(cards)}")
    if len({card.id for card in cards}) != len(cards):
        errors.append("card IDs are not unique")
    if len({card.name for card in cards}) != len(cards):
        errors.append("public card names are not unique")

    expected_locks = {
        "E1-001": "Genesis Lotus",
        "E1-002": "Satoshi Orchard",
        "E1-003": "FLX, Culture Curator",
        "E1-004": "Zap",
        "E1-005": "Next Block",
        "E1-006": "Multisig Quorum",
    }
    actual_locks = {card.id: card.name for card in cards if card.id in expected_locks}
    if actual_locks != expected_locks:
        errors.append(f"iconic ID lock mismatch: {actual_locks}")

    source_names = {card["name"].casefold() for card in source_cards}
    source_rules = {
        re.sub(r"\s+", " ", (card.get("oracle_text") or "")).strip().casefold()
        for card in source_cards
        if card.get("oracle_text")
    }
    for card in cards:
        if card.name.casefold() in source_names:
            errors.append(f"{card.id}: public name matches a reference name")
        normalized_rules = re.sub(r"\s+", " ", card.rules_text).strip().casefold()
        if normalized_rules in source_rules:
            errors.append(f"{card.id}: rules text exactly matches reference prose")
        if not card.rules_text:
            errors.append(f"{card.id}: rules text is empty")
        if not card.help_text:
            errors.append(f"{card.id}: simple help text is empty")
        if not card.protocol_note or not card.protocol_source.startswith("https://"):
            errors.append(f"{card.id}: protocol note or primary source missing")
        if "Avatar" in card.card_type and card.character is None:
            errors.append(f"{card.id}: Avatar has no official 600B character")
        if "Avatar" not in card.card_type and card.character is not None:
            errors.append(f"{card.id}: non-Avatar unexpectedly has a character")
        for pattern in FORBIDDEN_RULE_TERMS:
            if re.search(pattern, card.rules_text, flags=re.IGNORECASE):
                errors.append(f"{card.id}: forbidden public rules term matches {pattern}")
            if re.search(pattern, card.help_text, flags=re.IGNORECASE):
                errors.append(f"{card.id}: forbidden help term matches {pattern}")
        if len(card.help_text) > 180:
            errors.append(f"{card.id}: simple help exceeds 180 characters")
        if len(card.protocol_note) > 120:
            errors.append(f"{card.id}: protocol note exceeds 120 characters")
        if len(card.rules_text) > 900:
            errors.append(f"{card.id}: rules text exceeds 900 characters")
    return errors


def record_audit(db_path: Path, cards: list[CardRecord]) -> None:
    """Record the complete text-lock decision set before writing public artifacts."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS card_decisions (
                id TEXT PRIMARY KEY,
                source_slot INTEGER NOT NULL,
                mechanic_fingerprint TEXT NOT NULL,
                public_name TEXT NOT NULL,
                rules_fingerprint TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM card_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO card_decisions (
                id, source_slot, mechanic_fingerprint, public_name,
                rules_fingerprint, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card.id,
                    card.source_slot,
                    card.mechanic_fingerprint,
                    card.name,
                    hashlib.sha256(card.rules_text.encode()).hexdigest(),
                    card.status,
                    "mechanic-reference adapted to original 600B language",
                    "auto:codex:e1-text-lock",
                )
                for card in cards
            ],
        )
        connection.commit()


def card_to_dict(card: CardRecord) -> dict[str, Any]:
    """Serialize a card while retaining nested character data."""
    result = asdict(card)
    result["type_line"] = card.type_line
    return result


def write_json(path: Path, cards: list[CardRecord]) -> None:
    """Write the canonical Edition One card data."""
    payload = {
        "set": {
            "name": SET_NAME,
            "code": SET_CODE,
            "text_version": TEXT_VERSION,
            "card_count": len(cards),
            "language": "English",
            "creative_direction": (
                "Positive cypherpunk education through Bitcoin, Nostr and the official "
                "600Billion cast."
            ),
            "legal_note": (
                "All public names, lore, artwork directions, explanatory notes, symbols "
                "and card presentation are original 600B work. Historical mechanics are "
                "used only as an initial prototype reference and will be independently "
                "reviewed before public or commercial release."
            ),
        },
        "cards": [card_to_dict(card) for card in cards],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv(path: Path, cards: list[CardRecord]) -> None:
    """Write the Cockatrice-compatible authoring table."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = (
        "id",
        "name",
        "type",
        "subtype",
        "cost",
        "ar",
        "rarity",
        "affinity",
        "text",
        "protocol_note",
        "help_text",
    )
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for card in cards:
            writer.writerow(
                {
                    "id": card.id,
                    "name": card.name,
                    "type": card.card_type,
                    "subtype": card.subtype,
                    "cost": card.cost,
                    "ar": card.action_resilience,
                    "rarity": card.rarity,
                    "affinity": " / ".join(card.affinity),
                    "text": card.rules_text.replace("\n", "\\n"),
                    "protocol_note": card.protocol_note,
                    "help_text": card.help_text,
                }
            )


def write_catalog(path: Path, cards: list[CardRecord]) -> None:
    """Write a readable Markdown text catalog for editorial review."""
    lines = [
        f"# {SET_NAME} — Complete Card Text",
        "",
        f"Text version: `{TEXT_VERSION}`  ",
        f"Cards: **{len(cards)}**  ",
        "Status: **TEXT LOCKED — artwork has not started**",
        "",
        "This catalog is the single editorial view of Edition One. Protocol Notes are",
        "educational context and never change gameplay.",
        "",
    ]
    current_group = ""
    for card in cards:
        group = card.affinity[0] if len(card.affinity) == 1 else "Neutral / Multi-affinity"
        if group != current_group:
            current_group = group
            lines.extend((f"## {group}", ""))
        header = f"### {card.id} · {card.name}"
        stats = f" · **{card.action_resilience}**" if card.action_resilience else ""
        cost = card.cost or "—"
        character = ""
        if card.character:
            character = f"  \n**Character:** {', '.join(card.character.names)}"
        lines.extend(
            (
                header,
                "",
                f"**{card.type_line}** · Cost **{cost}** · {card.rarity.title()}{stats}",
                character,
                "",
                card.rules_text.replace("\n", "<br>\n"),
                "",
                f"**Simple Guide:** {card.help_text}",
                "",
                f"**Protocol Note:** {card.protocol_note}  ",
                f"**Primary source:** {card.protocol_source}",
                "",
                f"**Art direction:** {card.art_direction}",
                "",
                "---",
                "",
            )
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def write_report(path: Path, cards: list[CardRecord], errors: list[str]) -> None:
    """Write the consistency gate report for the text-to-image handoff."""
    type_counts = Counter(card.card_type for card in cards)
    affinity_counts = Counter(
        card.affinity[0] if len(card.affinity) == 1 else "Neutral / Multi" for card in cards
    )
    character_cards = sum(card.character is not None for card in cards)
    lines = [
        "# Edition One Text-Lock Consistency Report",
        "",
        f"- Version: `{TEXT_VERSION}`",
        f"- Cards checked: **{len(cards)}**",
        f"- Official-character Avatar cards: **{character_cards}**",
        f"- Errors: **{len(errors)}**",
        f"- Gate: **{'PASS — READY FOR IMAGE PHASE' if not errors else 'FAIL'}**",
        "",
        "## Card-type counts",
        "",
    ]
    lines.extend(f"- {name}: {count}" for name, count in sorted(type_counts.items()))
    lines.extend(("", "## Affinity counts", ""))
    lines.extend(f"- {name}: {count}" for name, count in sorted(affinity_counts.items()))
    lines.extend(
        (
            "",
            "## Checks",
            "",
            "- 295 complete records and unique public IDs",
            "- six iconic demo-card IDs preserved",
            "- original public card names",
            "- no exact source rules prose",
            "- consistent 600B zones, verbs and keywords",
            "- beginner-friendly Simple Guide on every card",
            "- every Avatar tied to official join.600.wtf character assets",
            "- non-Avatar art prompts explicitly exclude people",
            "- concise educational note plus primary source on every card",
            "- image generation blocked until this gate passes",
            "",
        )
    )
    if errors:
        lines.extend(("## Errors", ""))
        lines.extend(f"- {error}" for error in errors)
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def load_reference(path: Path) -> list[dict[str, Any]]:
    """Load the read-only reference export."""
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    """Build the audit record, canonical text data, catalog and adapter CSV."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    source_cards = load_reference(args.reference)
    cards = build_cards(source_cards)
    errors = validate_cards(cards, source_cards)

    # Audit first. Public artifacts are written only after this transaction commits.
    record_audit(args.audit_db, cards)
    write_json(repo_root / "cards" / "e1-cards.json", cards)
    write_csv(repo_root / "cards" / "cards.csv", cards)
    write_catalog(repo_root / "cards" / "E1-CARD-TEXT.md", cards)
    write_report(repo_root / "cards" / "e1-text-lock-report.md", cards, errors)

    if errors:
        for error in errors:
            log.error(error)
        raise SystemExit(f"text lock failed with {len(errors)} error(s)")
    log.info("text lock passed: %d cards are ready for the image phase", len(cards))


if __name__ == "__main__":
    main()
