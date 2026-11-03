# Fourth feature — The clickable map

Product: Plot Twist, story "The Missing Necklace" (BRD: the interface is free to design; images are optional. Requirements PT02, PT03, PT05 and rules R1–R3 must keep working unchanged).

## Why

A player can explore the manor by clicking on the picture of the room itself: walk through a door by clicking it, open the drawer by clicking it, and accuse the butler by clicking him. It feels like being in the house, not filling in a form.

## What

- Every room is shown as one picture (800 x 450). Doors, the drawer, the kitchen table and the butler are **hotspots**: clickable areas drawn on the picture.
- Each hotspot belongs to one action: `go` (with a target room), `take_key`, `take_letter` or `accuse`. Clicking it runs exactly the same rule as the old buttons. The rules, the state and the save file do not change.
- Every exit of a room has exactly one door hotspot, so every room can be reached by clicking. The key, the letter and the accusation each have a hotspot in the right room.
- Hotspots show only what is possible right now:
  - once the key is taken, the drawer hotspot disappears (R2, R3); the same for the letter and the table,
  - the Study door is drawn as **locked** while the player has no key (R1), and as open once they do,
  - after an ending there are no hotspots at all (PT05).
- The page address is user input, so unknown or invalid actions are rejected with a message and change nothing.
- The text message, the inventory and the "New game" button stay below the picture. The old "Go to" buttons stay available inside a collapsed "Text controls" section.

## Out of scope

- Animation, sound and photos. The pictures are simple drawn illustrations.
- A mobile layout.
- Any change to the rules, the story or the save file.

## Done when

1. **Complete map.** Every scene has a picture file, and its door hotspots match its exits exactly.
2. **Items and endings are clickable.** The Library has a `take_key` hotspot, the Kitchen a `take_letter` hotspot, and the Confrontation an `accuse` hotspot.
3. **Valid hotspots.** All hotspots lie inside the picture and none overlap.
4. **Only what is possible.** After taking the key, the drawer hotspot is gone. Without the key the Study door is marked locked, and with it, open. After an ending there are no hotspots.
5. **Safe actions.** `logic.perform(state, action, target)` gives the same result as the matching rule for valid actions, and rejects an unknown action or a bad target with the state unchanged.
6. **Played by clicking (manual).** In the browser, the whole route to Ending A is played by clicking the picture only, and after stopping and restarting the app the game resumes in the same room.
