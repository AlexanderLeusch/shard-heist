"""First feature: the locked Study door. One test per "Done when" check in specs/first-feature.md.

State is a dict: {"scene": str, "inventory": list, "drawer_emptied": bool}.
logic.move(state, destination) and logic.take_key(state) return (new_state, message).
"""

import db
import logic

LOCKED_MESSAGE = "The door is locked. You need a key."


def get_key(state):
    """Play the short route Hall -> Library -> take the key -> back to the Hall."""
    state, _ = logic.move(state, "library")
    state, _ = logic.take_key(state)
    state, _ = logic.move(state, "hall")
    return state


def test_study_is_blocked_without_the_key():
    """Check 1 (A1): rejected action. Nothing changes and the player is told why."""
    state = logic.new_state()
    new_state, message = logic.move(state, "study")
    assert message == LOCKED_MESSAGE
    assert new_state["scene"] == "hall"
    assert new_state["inventory"] == []
    assert new_state == state


def test_the_key_can_only_be_taken_once():
    """Check 2 (A3): taking the key twice still leaves exactly one key."""
    state = logic.new_state()
    state, _ = logic.move(state, "library")
    state, _ = logic.take_key(state)
    assert state["inventory"] == ["key"]
    assert state["drawer_emptied"] is True
    state, _ = logic.take_key(state)
    assert state["inventory"] == ["key"]


def test_the_study_opens_with_the_key_and_the_key_is_kept():
    """Check 3 (A2): accepted action. The player enters the Study and still holds the key."""
    state = get_key(logic.new_state())
    state, _ = logic.move(state, "study")
    assert state["scene"] == "study"
    assert state["inventory"] == ["key"]


def test_progress_survives_a_restart(tmp_path):
    """Check 4 (A4): save, then load from the file again. Scene, key and empty drawer come back."""
    path = tmp_path / "game.db"
    state = get_key(logic.new_state())
    state, _ = logic.move(state, "study")
    db.save_progress(path, state)

    loaded = db.load_progress(path)

    assert loaded["scene"] == "study"
    assert loaded["inventory"] == ["key"]
    assert loaded["drawer_emptied"] is True
