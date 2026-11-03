# Third feature — New game with confirmation

Product: Plot Twist, story "The Missing Necklace" (BRD requirements PT01, PT05; rules R4; scenarios A4, A6).

## Why

A player can start the story over, whether they are halfway through or have reached an ending, without losing their progress by accident.

## What

- The screen always offers a "New game" button.
- Pressing it does not reset anything yet. The screen asks "Are you sure? Your progress will be lost." with two buttons: "Yes, start over" and "No, keep playing" (PT01).
- Cancelling keeps all progress exactly as it was. Nothing is changed and nothing is saved (A6).
- Confirming resets the game to the start of the story (R4):
  - the player is in the Hall with an empty inventory,
  - the drawer and the table are full again, so the key and the letter can be taken again,
  - there is no ending.
  The story content itself (rooms, texts, endings) is unchanged.
- "New game" works after an ending too. This is how the player replays (PT05).
- The reset is saved straight away. After stopping and restarting the app the player is still at the start (A4).

## Out of scope

- More than one save slot, or choosing between several saves.
- A different story or a story editor.
- Images, sound and styling.

## Done when

1. **Cancel keeps progress (A6).** The player holds the key and is in the Study. Asking for a new game but not confirming leaves the scene, the inventory and the saved progress exactly as they were.
2. **Confirm resets (A6, R4).** From the same state, confirming puts the player in the Hall with an empty inventory and no ending, and the key can be taken again from the drawer (and the letter from the table).
3. **Replay after an ending (PT05, R4).** After ending A, confirming a new game puts the player at the start, and moving and taking items work again.
4. **The reset is saved (A4).** After confirming, saving and loading from the file again gives the starting state: the Hall, an empty inventory, no ending.
