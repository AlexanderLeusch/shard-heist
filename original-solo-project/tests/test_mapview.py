"""The HTML builder of the clickable map (mapview.py). Written after the code, to protect what was checked by hand."""

import logic
import mapview


def in_the_hall_with_the_key():
    state, _ = logic.move(logic.new_state(), "library")
    state, _ = logic.take_key(state)
    state, _ = logic.move(state, "hall")
    return state


def test_items_that_were_taken_leave_the_picture():
    kitchen, _ = logic.move(logic.new_state(), "kitchen")
    assert "item-letter" in mapview.picture_svg(kitchen)
    kitchen, _ = logic.take_letter(kitchen)
    assert "item-letter" not in mapview.picture_svg(kitchen)

    library, _ = logic.move(logic.new_state(), "library")
    assert "item-key" in mapview.picture_svg(library)
    library, _ = logic.take_key(library)
    assert "item-key" not in mapview.picture_svg(library)


def test_every_link_carries_its_action_and_target():
    html = mapview.map_html(logic.new_state())
    assert 'href="?act=go&amp;target=kitchen"' in html
    assert 'href="?act=go&amp;target=library"' in html


def test_the_locked_door_is_marked_only_without_the_key():
    assert "hotspot locked" in mapview.map_html(logic.new_state())
    assert "hotspot locked" not in mapview.map_html(in_the_hall_with_the_key())
