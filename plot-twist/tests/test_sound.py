"""Fifth feature: music and sound effects. One group of tests per "Done when" check in specs/sound.md.

Each scene in story.SCENES gets "music" (a mood) and "ambience" (None, or "murmur").
logic.visible_hotspots(state) adds a "cue" to every hotspot. logic.ending_cue(state) names the ending sound.
mapview.component_args(state) is everything the custom component needs to draw and play the current room.
The component's file components/map/index.html must contain a sound generator for every cue and mood.
"""

import re
from pathlib import Path

import logic
import mapview
import story

PROJECT = Path(__file__).resolve().parent.parent
COMPONENT_FILE = PROJECT / "components" / "map" / "index.html"

KNOWN_MOODS = {"lobby", "kitchen", "study", "suspense"}
KNOWN_CUES = {"door", "locked", "drawer", "paper", "accuse", "ending_a", "ending_b"}


def in_room(name, **changes):
    return {**logic.new_state(), "scene": name, **changes}


def hotspot(state, action, target=None):
    found = [h for h in logic.visible_hotspots(state) if h["action"] == action and h["target"] == target]
    assert len(found) == 1
    return found[0]


def ending_state(letter):
    state = {**logic.new_state(), "inventory": ["key", "letter"] if letter else ["key"], "scene": "confrontation"}
    state, _ = logic.accuse(state)
    return state


# Check 1: moods


def test_every_room_has_a_known_music_mood():
    for name, scene in story.SCENES.items():
        assert scene["music"] in KNOWN_MOODS, name


def test_only_the_confrontation_has_the_murmur():
    for name, scene in story.SCENES.items():
        expected = "murmur" if name == "confrontation" else None
        assert scene["ambience"] == expected, name


# Check 2: cues


def test_every_clickable_area_has_a_known_cue():
    for name in story.SCENES:
        for spot in logic.visible_hotspots(in_room(name)):
            assert spot["cue"] in KNOWN_CUES, name


def test_each_action_has_its_own_cue():
    assert hotspot(in_room("library"), "take_key")["cue"] == "drawer"
    assert hotspot(in_room("kitchen"), "take_letter")["cue"] == "paper"
    assert hotspot(in_room("confrontation"), "accuse")["cue"] == "accuse"
    assert hotspot(in_room("hall"), "go", "library")["cue"] == "door"


def test_the_study_door_rattles_without_the_key_and_opens_with_it():
    assert hotspot(in_room("hall"), "go", "study")["cue"] == "locked"
    assert hotspot(in_room("hall", inventory=["key"]), "go", "study")["cue"] == "door"


# Check 3: ending cues


def test_the_ending_cue_only_exists_after_an_ending():
    assert logic.ending_cue(logic.new_state()) is None
    assert logic.ending_cue(ending_state(letter=True)) == "ending_a"
    assert logic.ending_cue(ending_state(letter=False)) == "ending_b"


# Check 4: nothing missing in the component


def test_the_component_can_play_every_cue_and_mood():
    source = COMPONENT_FILE.read_text()
    for name in sorted(KNOWN_CUES | KNOWN_MOODS | {"murmur"}):
        assert re.search(r"\b" + name + r"\s*[:(]", source), name + " has no sound generator"


# Check 5: what the component gets


def test_component_args_describe_the_current_room():
    state = in_room("kitchen")
    args = mapview.component_args(state)
    assert args["title"] == story.SCENES["kitchen"]["title"]
    assert args["image"].startswith("data:image/svg+xml;base64,")
    assert args["music"] == story.SCENES["kitchen"]["music"]
    assert args["ambience"] is None
    assert args["ending_cue"] is None
    assert len(args["hotspots"]) == len(logic.visible_hotspots(state))
    for spot in args["hotspots"]:
        assert set(spot) >= {"action", "target", "label", "locked", "cue", "box"}


def test_component_args_have_no_hotspots_after_an_ending():
    args = mapview.component_args(ending_state(letter=True))
    assert args["hotspots"] == []
    assert args["ending_cue"] == "ending_a"
    assert args["ambience"] == "murmur"
