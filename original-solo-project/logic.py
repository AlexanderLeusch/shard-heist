"""The rules of Plot Twist. Pure functions on a state dict: no screen code, no database code.

State: {"scene": str, "inventory": list of str, "drawer_emptied": bool, "table_emptied": bool, "ending": None or "A" or "B"}
Every function returns (new_state, message) and never changes the state it was given.
A rejected action returns a copy that is equal to the old state.
Once an ending is reached, every action is rejected.
"""

import story


def new_state():
    """The state of a brand new game."""
    return {
        "scene": story.START_SCENE,
        "inventory": [],
        "drawer_emptied": False,
        "table_emptied": False,
        "ending": None,
    }


def new_game(state, confirmed):
    """Start over if the player confirmed. Otherwise keep everything as it is. Works after an ending too."""
    if not confirmed:
        return _copy(state), story.KEPT_MESSAGE
    return new_state(), story.NEW_GAME_MESSAGE


def _copy(state):
    return {
        "scene": state["scene"],
        "inventory": list(state["inventory"]),
        "drawer_emptied": state["drawer_emptied"],
        "table_emptied": state["table_emptied"],
        "ending": state["ending"],
    }


def move(state, destination):
    """Try to walk to another scene. Rejected if there is no such exit or the route is locked."""
    if state["ending"] is not None:
        return _copy(state), story.STORY_OVER_MESSAGE
    if destination not in story.SCENES[state["scene"]]["exits"]:
        return _copy(state), "You can't go there from here."
    needed_item = story.LOCKED_ROUTES.get(destination)
    if needed_item is not None and needed_item not in state["inventory"]:
        return _copy(state), story.LOCKED_MESSAGE
    new = _copy(state)
    new["scene"] = destination
    return new, "You go to " + story.SCENES[destination]["title"] + "."


def take_key(state):
    """Take the key from the Library drawer. Works once per game."""
    new = _copy(state)
    if state["ending"] is not None:
        return new, story.STORY_OVER_MESSAGE
    if state["scene"] != "library":
        return new, "There is no key here."
    if state["drawer_emptied"]:
        return new, "The drawer is empty."
    new["inventory"].append("key")
    new["drawer_emptied"] = True
    return new, "You take a brass key from the drawer."


def take_letter(state):
    """Take the letter from the Kitchen table. Works once per game."""
    new = _copy(state)
    if state["ending"] is not None:
        return new, story.STORY_OVER_MESSAGE
    if state["scene"] != "kitchen":
        return new, "There is no letter here."
    if state["table_emptied"]:
        return new, "The table is empty."
    new["inventory"].append("letter")
    new["table_emptied"] = True
    return new, "You pick up a folded letter from the table."


def accuse(state):
    """Accuse the butler in the Confrontation. The ending depends on whether the player holds the letter."""
    new = _copy(state)
    if state["ending"] is not None:
        return new, story.STORY_OVER_MESSAGE
    if state["scene"] != "confrontation":
        return new, "There is nobody to accuse here."
    new["ending"] = "A" if "letter" in state["inventory"] else "B"
    return new, story.ENDINGS[new["ending"]]


ACTIONS = {
    "take_key": take_key,
    "take_letter": take_letter,
    "accuse": accuse,
}


def visible_hotspots(state):
    """The clickable areas of the current scene that are possible right now. Each gets a "locked" flag."""
    if state["ending"] is not None:
        return []
    visible = []
    for hotspot in story.SCENES[state["scene"]]["hotspots"]:
        if hotspot["action"] == "take_key" and state["drawer_emptied"]:
            continue
        if hotspot["action"] == "take_letter" and state["table_emptied"]:
            continue
        locked = False
        if hotspot["action"] == "go":
            needed_item = story.LOCKED_ROUTES.get(hotspot["target"])
            locked = needed_item is not None and needed_item not in state["inventory"]
        cue = story.LOCKED_CUE if locked else story.CUES[hotspot["action"]]
        visible.append({**hotspot, "locked": locked, "cue": cue})
    return visible


def ending_cue(state):
    """The sound of the ending the player reached, or None while the story is still running."""
    return story.ENDING_CUES.get(state["ending"])


def perform(state, action, target=None):
    """Run one action by name. The name can come from the page address, so unknown ones are rejected."""
    if action == "go":
        return move(state, target)
    if action in ACTIONS:
        return ACTIONS[action](state)
    return _copy(state), story.UNKNOWN_ACTION_MESSAGE
