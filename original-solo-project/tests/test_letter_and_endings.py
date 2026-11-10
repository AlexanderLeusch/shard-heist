"""Second feature: the letter and two endings. One test per "Done when" check in specs/letter-and-endings.md.

State is a dict: {"scene", "inventory", "drawer_emptied", "table_emptied", "ending"}.
"ending" is None while the story runs, then "A" or "B".
logic.take_letter(state) and logic.accuse(state) return (new_state, message), like move and take_key.
"""

import db
import logic

STORY_OVER_MESSAGE = "The story is over."


def get_key(state):
    """Hall -> Library -> take the key -> Hall."""
    state, _ = logic.move(state, "library")
    state, _ = logic.take_key(state)
    state, _ = logic.move(state, "hall")
    return state


def get_letter(state):
    """Hall -> Kitchen -> take the letter -> Hall."""
    state, _ = logic.move(state, "kitchen")
    state, _ = logic.take_letter(state)
    state, _ = logic.move(state, "hall")
    return state


def go_to_confrontation(state):
    """Hall -> Study -> Confrontation. The player needs the key."""
    state, _ = logic.move(state, "study")
    state, _ = logic.move(state, "confrontation")
    return state


def finish_with_ending_a():
    state = get_letter(get_key(logic.new_state()))
    state = go_to_confrontation(state)
    state, _ = logic.accuse(state)
    return state


def test_the_letter_can_only_be_taken_once():
    """Check 1 (A3): taking the letter twice still leaves exactly one letter."""
    state = logic.new_state()
    state, _ = logic.move(state, "kitchen")
    state, _ = logic.take_letter(state)
    assert state["inventory"] == ["letter"]
    assert state["table_emptied"] is True
    state, _ = logic.take_letter(state)
    assert state["inventory"] == ["letter"]


def test_ending_a_when_you_have_the_letter():
    """Check 2 (A5): with the key and the letter, accusing the butler gives ending A and keeps both items."""
    state = finish_with_ending_a()
    assert state["scene"] == "confrontation"
    assert state["ending"] == "A"
    assert sorted(state["inventory"]) == ["key", "letter"]


def test_ending_b_when_you_have_no_letter():
    """Check 3 (A5): with the key but no letter, accusing the butler gives a different ending, B."""
    state = get_key(logic.new_state())
    state = go_to_confrontation(state)
    state, _ = logic.accuse(state)
    assert state["ending"] == "B"
    assert state["inventory"] == ["key"]


def test_the_story_stays_over_after_an_ending():
    """Check 4a (PT05): after an ending, every story action is rejected and changes nothing."""
    state = finish_with_ending_a()
    attempts = [
        logic.move(state, "study"),
        logic.take_key(state),
        logic.take_letter(state),
        logic.accuse(state),
    ]
    for new_state, message in attempts:
        assert message == STORY_OVER_MESSAGE
        assert new_state == state


def test_the_ending_survives_a_restart(tmp_path):
    """Check 4b (A4): save, then load from the file again. The same ending and everything else come back."""
    path = tmp_path / "game.db"
    state = finish_with_ending_a()
    db.save_progress(path, state)

    loaded = db.load_progress(path)

    assert loaded["ending"] == "A"
    assert loaded == state
