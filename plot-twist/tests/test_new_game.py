"""Third feature: New game with confirmation. One test per "Done when" check in specs/new-game.md.

logic.new_game(state, confirmed) returns (new_state, message), like the other rules.
confirmed=False means the player pressed "No, keep playing". confirmed=True means "Yes, start over".
The two-step "Are you sure?" question lives on the screen; the rule only receives the answer.
"""

import db
import logic

KEPT_MESSAGE = "Your progress was kept."
NEW_GAME_MESSAGE = "A new game begins."


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


def in_the_study_with_the_key():
    state = get_key(logic.new_state())
    state, _ = logic.move(state, "study")
    return state


def finish_with_ending_a():
    state = get_letter(get_key(logic.new_state()))
    state, _ = logic.move(state, "study")
    state, _ = logic.move(state, "confrontation")
    state, _ = logic.accuse(state)
    return state


def test_cancelling_keeps_the_progress():
    """Check 1 (A6): not confirming changes nothing."""
    state = in_the_study_with_the_key()
    new_state, message = logic.new_game(state, False)
    assert message == KEPT_MESSAGE
    assert new_state == state
    assert new_state["scene"] == "study"
    assert new_state["inventory"] == ["key"]


def test_confirming_resets_the_game_and_refills_the_drawer():
    """Check 2 (A6, R4): confirming gives the starting state, and the key can be taken again."""
    state = get_letter(in_the_study_with_the_key())
    new_state, message = logic.new_game(state, True)
    assert message == NEW_GAME_MESSAGE
    assert new_state == logic.new_state()

    new_state, _ = logic.move(new_state, "library")
    new_state, _ = logic.take_key(new_state)
    assert new_state["inventory"] == ["key"]


def test_a_new_game_after_an_ending_can_be_played_again():
    """Check 3 (PT05, R4): after ending A, a confirmed new game accepts moves and items again."""
    state = finish_with_ending_a()
    assert state["ending"] == "A"

    new_state, _ = logic.new_game(state, True)
    assert new_state["ending"] is None
    assert new_state["scene"] == "hall"

    new_state, message = logic.move(new_state, "library")
    assert new_state["scene"] == "library"
    assert message != "The story is over."


def test_the_reset_survives_a_restart(tmp_path):
    """Check 4 (A4): save the reset game, then load from the file again. The starting state comes back."""
    path = tmp_path / "game.db"
    db.save_progress(path, finish_with_ending_a())

    reset_state, _ = logic.new_game(db.load_progress(path), True)
    db.save_progress(path, reset_state)

    assert db.load_progress(path) == logic.new_state()
