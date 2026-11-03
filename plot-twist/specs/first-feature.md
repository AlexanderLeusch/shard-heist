# First feature — The locked Study door

Product: Plot Twist, story "The Missing Necklace" (BRD requirements PT02, PT03; rules R1, R2, R3; scenarios A1, A2, A3, A4).

## Why

A player can find the key in the Library, use it to open the locked Study door, and carry on from the same place after closing and reopening the app.

## What

- The Hall offers three routes: Library, Kitchen, Study.
- The Library drawer holds one key. Taking it puts the key in the inventory (PT03, R2).
- The drawer can be emptied only once. Visiting the Library again must not offer a second key (R2, R3).
- The Study route is locked. Without the key, choosing it is rejected with a message that explains why. The player stays in the Hall and the inventory does not change (R1).
- With the key, the Study route works and the player enters the Study. The key stays in the inventory because it is reusable (R2).
- After every accepted action, the current scene, the inventory and the "drawer emptied" fact are saved.

## Out of scope

- The Kitchen letter (second item).
- The Confrontation scene and both endings.
- "New game" and the restart confirmation.
- Images, sound and styling.

## Done when

1. **Rejected action (A1).** Start in the Hall with an empty inventory and choose Study. The game says the door is locked, the scene is still Hall, and the inventory is still empty.
2. **No duplicate key (A3).** In the Library, take the key: the inventory holds exactly 1 key. Try to take it again: the inventory still holds exactly 1 key and the drawer offers nothing.
3. **Accepted action (A2).** With the key, go to the Hall and choose Study: the scene is Study and the inventory still holds the key.
4. **Restart (A4).** After check 3, stop the app completely and start it again. The scene is Study, the inventory holds 1 key, and the drawer is still empty.
