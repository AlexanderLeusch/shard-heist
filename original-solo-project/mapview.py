"""Builds the HTML of the clickable map. No Streamlit calls: it only returns text."""

import base64
import html
import re
from pathlib import Path
from urllib.parse import urlencode

import logic
import story

PROJECT = Path(__file__).resolve().parent

MAP_CSS = """
.map { position: relative; width: 100%; max-width: 800px; aspect-ratio: 800 / 450; margin: 0 auto 1rem; }
.map img { width: 100%; display: block; border-radius: 12px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45); }
.map .hotspot { position: absolute; display: flex; align-items: center; justify-content: center;
  border: 2px solid transparent; border-radius: 10px; text-decoration: none; transition: all 0.15s; }
.map .hotspot:hover { background: rgba(255, 224, 140, 0.22); border-color: #ffe08c; }
.map .hotspot.locked { background: rgba(160, 30, 40, 0.18); }
.map .hotspot.locked:hover { background: rgba(190, 40, 50, 0.35); border-color: #ff7a7a; }
.map .label { opacity: 0; font: 600 13px sans-serif; color: #fff; background: rgba(0, 0, 0, 0.75);
  padding: 3px 9px; border-radius: 6px; pointer-events: none; text-align: center; }
.map .hotspot:hover .label { opacity: 1; }
.map .lock { position: absolute; top: 38%; font-size: 26px; pointer-events: none; }
"""


def _remove_layer(svg, layer_id):
    return re.sub(r'<g id="' + layer_id + r'"[^>]*>.*?</g>', "", svg, flags=re.DOTALL)


def picture_svg(state):
    """The drawing of the current room. Items that were already taken are left out of the picture."""
    svg = (PROJECT / story.SCENES[state["scene"]]["image"]).read_text()
    if state["drawer_emptied"]:
        svg = _remove_layer(svg, "item-key")
    if state["table_emptied"]:
        svg = _remove_layer(svg, "item-letter")
    return svg


def _percent(value, total):
    return str(round(value / total * 100, 3)) + "%"


def picture_data_uri(state):
    return "data:image/svg+xml;base64," + base64.b64encode(picture_svg(state).encode()).decode()


def component_args(state):
    """Everything the map component needs to draw and play the current room."""
    scene = story.SCENES[state["scene"]]
    hotspots = []
    for hotspot in logic.visible_hotspots(state):
        hotspots.append({
            "action": hotspot["action"],
            "target": hotspot["target"],
            "label": hotspot["label"],
            "locked": hotspot["locked"],
            "cue": hotspot["cue"],
            "box": list(hotspot["box"]),
        })
    return {
        "title": scene["title"],
        "image": picture_data_uri(state),
        "width": story.MAP_WIDTH,
        "height": story.MAP_HEIGHT,
        "hotspots": hotspots,
        "music": scene["music"],
        "ambience": scene["ambience"],
        "ending_cue": logic.ending_cue(state),
    }


def map_html(state):
    """The picture of the current room with one link on top of every hotspot that is possible right now."""
    image = picture_data_uri(state)
    title = html.escape(story.SCENES[state["scene"]]["title"])
    lines = ['<div class="map">', '<img src="' + image + '" alt="' + title + '">']
    for hotspot in logic.visible_hotspots(state):
        x, y, width, height = hotspot["box"]
        params = {"act": hotspot["action"]}
        if hotspot["target"] is not None:
            params["target"] = hotspot["target"]
        label = html.escape(hotspot["label"])
        css_class = "hotspot locked" if hotspot["locked"] else "hotspot"
        style = "left:{};top:{};width:{};height:{};".format(
            _percent(x, story.MAP_WIDTH), _percent(y, story.MAP_HEIGHT),
            _percent(width, story.MAP_WIDTH), _percent(height, story.MAP_HEIGHT),
        )
        lock = '<span class="lock">&#128274;</span>' if hotspot["locked"] else ""
        lines.append(
            '<a class="' + css_class + '" href="' + html.escape("?" + urlencode(params)) + '" target="_self" title="' + label
            + '" style="' + style + '">' + lock + '<span class="label">' + label + "</span></a>"
        )
    lines.append("</div>")
    return "\n".join(lines)
