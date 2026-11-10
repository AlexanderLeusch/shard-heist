"""Fourth feature: the clickable map. One group of tests per "Done when" check in specs/map-view.md.

Each scene in story.SCENES gets "image" (a file path) and "hotspots" (a list of dicts):
    {"action": "go" | "take_key" | "take_letter" | "accuse", "target": room or None, "box": (x, y, width, height), "label": str}
story.MAP_WIDTH and story.MAP_HEIGHT give the size of the picture.
logic.visible_hotspots(state) returns the hotspots that are possible right now; each has an extra "locked" flag.
logic.perform(state, action, target=None) runs one action by name and returns (new_state, message).
"""

from pathlib import Path

import logic
import story

PROJECT = Path(__file__).resolve().parent.parent
UNKNOWN_MESSAGE = "That action is not possible."


def overlaps(box_a, box_b):
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def go_hotspot(hotspots, target):
    return [h for h in hotspots if h["action"] == "go" and h["target"] == target]


def get_key(state):
    state, _ = logic.move(state, "library")
    state, _ = logic.take_key(state)
    state, _ = logic.move(state, "hall")
    return state


# Check 1: a complete map


def test_every_scene_has_a_picture_file():
    for name, scene in story.SCENES.items():
        assert (PROJECT / scene["image"]).is_file(), name + " has no picture file"


def test_door_hotspots_match_the_exits_exactly():
    for name, scene in story.SCENES.items():
        doors = [h["target"] for h in scene["hotspots"] if h["action"] == "go"]
        assert sorted(doors) == sorted(scene["exits"]), name


# Check 2: items and endings are clickable


def test_items_and_the_accusation_have_hotspots():
    def actions(scene_name):
        return [h["action"] for h in story.SCENES[scene_name]["hotspots"]]

    assert "take_key" in actions("library")
    assert "take_letter" in actions("kitchen")
    assert "accuse" in actions("confrontation")


# Check 3: valid hotspots


def test_hotspots_stay_inside_the_picture_and_do_not_overlap():
    for name, scene in story.SCENES.items():
        boxes = [h["box"] for h in scene["hotspots"]]
        for x, y, width, height in boxes:
            assert x >= 0 and y >= 0, name
            assert x + width <= story.MAP_WIDTH and y + height <= story.MAP_HEIGHT, name
        for index, box in enumerate(boxes):
            for other in boxes[index + 1:]:
                assert not overlaps(box, other), name


def test_hotspot_actions_are_known_ones():
    for scene in story.SCENES.values():
        for hotspot in scene["hotspots"]:
            assert hotspot["action"] in ("go", "take_key", "take_letter", "accuse")


# Check 4: only what is possible right now


def test_the_drawer_hotspot_disappears_once_the_key_is_taken():
    state, _ = logic.move(logic.new_state(), "library")
    assert "take_key" in [h["action"] for h in logic.visible_hotspots(state)]
    state, _ = logic.take_key(state)
    assert "take_key" not in [h["action"] for h in logic.visible_hotspots(state)]


def test_the_study_door_is_locked_without_the_key_and_open_with_it():
    state = logic.new_state()
    study_door = go_hotspot(logic.visible_hotspots(state), "study")[0]
    assert study_door["locked"] is True
    assert go_hotspot(logic.visible_hotspots(state), "library")[0]["locked"] is False

    study_door = go_hotspot(logic.visible_hotspots(get_key(state)), "study")[0]
    assert study_door["locked"] is False


def test_there_are_no_hotspots_after_an_ending():
    state = get_key(logic.new_state())
    state, _ = logic.move(state, "study")
    state, _ = logic.move(state, "confrontation")
    state, _ = logic.accuse(state)
    assert state["ending"] is not None
    assert logic.visible_hotspots(state) == []


# Check 5: safe actions


def test_perform_gives_the_same_result_as_the_rules():
    start = logic.new_state()
    assert logic.perform(start, "go", "library") == logic.move(start, "library")
    assert logic.perform(start, "go", "study") == logic.move(start, "study")

    library, _ = logic.move(start, "library")
    assert logic.perform(library, "take_key") == logic.take_key(library)

    kitchen, _ = logic.move(start, "kitchen")
    assert logic.perform(kitchen, "take_letter") == logic.take_letter(kitchen)

    confrontation = {**get_key(start), "scene": "confrontation"}
    assert logic.perform(confrontation, "accuse") == logic.accuse(confrontation)


def test_an_unknown_action_is_rejected_and_changes_nothing():
    state = get_key(logic.new_state())
    new_state, message = logic.perform(state, "fly", None)
    assert message == UNKNOWN_MESSAGE
    assert new_state == state


def test_a_bad_target_is_rejected_and_changes_nothing():
    state = logic.new_state()
    for target in ("narnia", None, ""):
        new_state, _ = logic.perform(state, "go", target)
        assert new_state == state
