"""The precon library: legal, scripted-only, deterministic."""

import re

from build_precons import build_precons, classics_specs, cost_total, load_cards

CARDS = load_cards()
BY_ID = {c["id"]: c for c in CARDS}
PRECONS = build_precons(CARDS)
STAKE = re.compile(r"\bStake\b")

RESOURCE_TYPES = {"Basic Resource", "Resource"}
AVATAR_TYPES = {"Avatar", "Hardware Avatar"}
SPELL_TYPES = {"Zap", "Operation"}
DEVICE_TYPES = {"Hardware", "Protocol"}


def test_every_stack_is_engine_legal_in_shape():
    assert len(PRECONS) == 5 + len(classics_specs())
    for name, precon in PRECONS.items():
        assert len(precon["cards"]) >= 40, f"{name} is under the paragraph-7 floor"
        for card_id in precon["cards"]:
            assert card_id in BY_ID, f"{name} names unknown card {card_id}"


def test_only_scripted_stake_free_x_free_cards():
    for name, precon in PRECONS.items():
        for card_id in set(precon["cards"]):
            card = BY_ID[card_id]
            assert not card.get("manual"), f"{name}: {card_id} is assisted"
            assert not STAKE.search(card.get("text") or ""), f"{name}: {card_id} is Stake"
            assert (card.get("costParsed") or {}).get("x") is None, f"{name}: {card_id} has X"


def test_affinity_purity():
    for name, precon in PRECONS.items():
        want = precon["affinity"]
        for card_id in set(precon["cards"]):
            aff = BY_ID[card_id].get("affinity") or []
            assert want in aff or "Neutral" in aff, f"{name}: {card_id} is off-affinity ({aff})"


def test_starters_wear_the_prototype_shape():
    for name, precon in PRECONS.items():
        if precon["group"] != "Starter":
            continue
        types = [BY_ID[c]["type"] for c in precon["cards"]]
        assert len(types) == 40
        assert sum(t in RESOURCE_TYPES for t in types) == 17, name
        assert sum(t in AVATAR_TYPES for t in types) == 14, name
        assert sum(t in SPELL_TYPES for t in types) == 5, name
        assert sum(t in DEVICE_TYPES for t in types) == 4, name


def test_classics_wear_their_declared_shape():
    by_name = {spec["name"]: spec for spec in classics_specs()}
    for name, precon in PRECONS.items():
        if precon["group"] != "Classic":
            continue
        spec = by_name[name]
        types = [BY_ID[c]["type"] for c in precon["cards"]]
        assert sum(t in RESOURCE_TYPES for t in types) == spec["resources"], name
        assert sum(t in AVATAR_TYPES for t in types) == spec["avatars"], name
        assert sum(t in SPELL_TYPES for t in types) == spec["spells"], name
        assert sum(t in DEVICE_TYPES for t in types) == spec["devices"], name


def test_the_build_is_deterministic():
    assert build_precons(CARDS) == PRECONS


def test_the_swarm_curves_low_and_the_ramp_curves_high():
    swarm = [
        cost_total(BY_ID[c])
        for c in PRECONS["Relay Swarm"]["cards"]
        if BY_ID[c]["type"] in AVATAR_TYPES
    ]
    ramp = [
        cost_total(BY_ID[c])
        for c in PRECONS["Channel the Grid"]["cards"]
        if BY_ID[c]["type"] in AVATAR_TYPES
    ]
    assert sum(swarm) / len(swarm) < sum(ramp) / len(ramp), "the archetypes must actually differ"
