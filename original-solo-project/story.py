"""Fixed story content for "The Missing Necklace". Nothing here changes while playing."""

START_SCENE = "hall"

LOCKED_MESSAGE = "The door is locked. You need a key."
STORY_OVER_MESSAGE = "The story is over."
KEPT_MESSAGE = "Your progress was kept."
NEW_GAME_MESSAGE = "A new game begins."
UNKNOWN_ACTION_MESSAGE = "That action is not possible."

# Every picture is this big. Hotspot boxes are (x, y, width, height) inside the picture.
MAP_WIDTH = 800
MAP_HEIGHT = 450

SCENES = {
    "hall": {
        "title": "The Hall",
        "text": "You stand in the front hall of the manor. The necklace is missing and everyone is a suspect. "
        "Doors lead to the Library and the Kitchen. A heavy oak door marked Study is locked.",
        "exits": ["library", "kitchen", "study"],
        "image": "images/hall.svg",
        "music": "lobby",
        "ambience": None,
        "hotspots": [
            {"action": "go", "target": "library", "box": (60, 120, 130, 210), "label": "Library"},
            {"action": "go", "target": "kitchen", "box": (610, 120, 130, 210), "label": "Kitchen"},
            {"action": "go", "target": "study", "box": (335, 100, 130, 230), "label": "Study"},
        ],
    },
    "library": {
        "title": "The Library",
        "text": "Dusty shelves reach the ceiling. A small drawer in the reading desk looks like it might hold something.",
        "exits": ["hall"],
        "image": "images/library.svg",
        "music": "study",
        "ambience": None,
        "hotspots": [
            {"action": "take_key", "target": None, "box": (338, 276, 124, 48), "label": "Open the drawer"},
            {"action": "go", "target": "hall", "box": (650, 130, 108, 200), "label": "Back to the Hall"},
        ],
    },
    "kitchen": {
        "title": "The Kitchen",
        "text": "Copper pots hang above a cold stove. A scrubbed wooden table stands in the middle of the room.",
        "exits": ["hall"],
        "image": "images/kitchen.svg",
        "music": "kitchen",
        "ambience": None,
        "hotspots": [
            {"action": "take_letter", "target": None, "box": (255, 244, 290, 82), "label": "Look at the table"},
            {"action": "go", "target": "hall", "box": (40, 130, 120, 200), "label": "Back to the Hall"},
        ],
    },
    "study": {
        "title": "The Study",
        "text": "The key turns and the door swings open. A desk and a safe wait in the dim light. "
        "Beyond them, the butler stands by the window.",
        "exits": ["hall", "confrontation"],
        "image": "images/study.svg",
        "music": "study",
        "ambience": None,
        "hotspots": [
            {"action": "go", "target": "hall", "box": (60, 130, 120, 200), "label": "Back to the Hall"},
            {"action": "go", "target": "confrontation", "box": (520, 80, 150, 255), "label": "Face the butler"},
        ],
    },
    "confrontation": {
        "title": "The Confrontation",
        "text": "The butler turns to face you. Everyone in the manor is listening. It is time to name the thief.",
        "exits": ["study"],
        "image": "images/confrontation.svg",
        "music": "suspense",
        "ambience": "murmur",
        "hotspots": [
            {"action": "accuse", "target": None, "box": (320, 48, 160, 296), "label": "Accuse the butler"},
            {"action": "go", "target": "study", "box": (30, 124, 120, 208), "label": "Back to the Study"},
        ],
    },
}

# Which sound each kind of click makes. A locked door rattles instead of opening.
CUES = {"go": "door", "take_key": "drawer", "take_letter": "paper", "accuse": "accuse"}
LOCKED_CUE = "locked"
ENDING_CUES = {"A": "ending_a", "B": "ending_b"}

# Routes that need an item in the inventory before the player can enter.
LOCKED_ROUTES = {"study": "key"}

ENDINGS = {
    "A": "You show the letter. The butler confesses and the necklace is returned. THE END (ending A)",
    "B": "You have no proof. The butler smiles and the thief walks free. THE END (ending B)",
}
