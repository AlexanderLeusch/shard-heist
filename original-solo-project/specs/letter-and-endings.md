# Second feature — The letter and two endings

Product: Plot Twist, story "The Missing Necklace" (BRD requirements PT04, PT05; rules R1, R2, R3; scenarios A3, A4, A5).

## Why

A player can collect a second item, the letter, and then reach one of two different endings depending on whether they have it. Once the story is over, it stays over, even after a restart.

## What

- The Kitchen table holds one letter. Taking it puts the letter in the inventory. It can be taken only once; visiting the Kitchen again must not offer a second letter (R2, R3).
- The Study has a new exit to the Confrontation scene. This route is not locked (the key was needed to enter the Study).
- In the Confrontation the player chooses to accuse the butler. The ending depends on the inventory (PT04, PT05):
  - With the letter: **Ending A**, "You show the letter. The butler confesses and the necklace is returned."
  - Without the letter: **Ending B**, "You have no proof. The butler smiles and the thief walks free."
- Reaching an ending is saved. After an ending, every story action (move, take an item, accuse) is rejected with the message "The story is over." and changes nothing (PT05).
- After every accepted action, the scene, inventory, item facts and the ending (if any) are saved.

## Out of scope

- "New game" and the restart confirmation (next feature).
- Anything beyond two endings: no extra items, scenes or choices.
- Images, sound and styling.

## Done when

1. **No duplicate letter (A3).** In the Kitchen, take the letter: the inventory holds exactly 1 letter. Try again: still exactly 1 letter and the table offers nothing.
2. **Ending A (A5).** With the key and the letter, go Hall → Study → Confrontation and accuse the butler: the ending is A and the inventory still holds both items.
3. **Ending B (A5).** With the key but no letter, go to the Confrontation and accuse the butler: the ending is B, a different ending from check 2.
4. **The story stays over (A4, PT05).** After any ending, trying to move or take an item is rejected with "The story is over." and the state is unchanged. After stopping and restarting the app, the same ending is still shown.
