# Fifth feature — Music and sound effects

Product: Plot Twist, story "The Missing Necklace" (BRD: sound is optional; requirements PT02–PT05 and rules R1–R4 must keep working unchanged).

## Why

A player feels the atmosphere of the manor: calm, uneasy music in the rooms, a creaking door when they walk through it, a drawer sliding open, paper rustling, and whispers growing around the butler before the accusation.

## What

- The map moves into a small **custom component**: a mini web page that stays alive between clicks. Because it is not reloaded, the music keeps playing from room to room, and every click can start a sound at once.
- Every sound is **synthesised in the browser** (Web Audio). No audio files are used.
- Every room has a **music mood** (`lobby`, `kitchen`, `study`, `suspense`). The Confrontation also has a looping **murmur** (whispering crowd) on top of its music.
- Every clickable area has one **sound cue**, chosen by its action:
  - a door: `door`
  - the locked Study door (no key yet): `locked` (a rattle, R1)
  - the drawer: `drawer`
  - the letter on the table: `paper`
  - the accusation: `accuse`
- Reaching an ending plays its own cue: `ending_a` or `ending_b`. While the story runs there is none.
- Sound never starts by itself before the player has clicked once (browsers do not allow it). The component shows a "Click to enable sound" hint first.
- A **mute button** and a **volume slider** are always visible. The choice is remembered in the browser, not in the game save.
- The rules, the game state and the save file do not change. Sound is only a reaction to actions.

## Out of scope

- Loading real audio files (possible later, sound by sound).
- Voices, speech or spoken text.
- Sounds for the text-only buttons.

## Done when

1. **Moods.** Every room has a known music mood, and only the Confrontation has the murmur.
2. **Cues.** Every clickable area has a known cue: doors `door`, the locked Study door `locked` (and `door` once the player has the key), the drawer `drawer`, the table `paper`, the accusation `accuse`.
3. **Ending cues.** No ending cue while the story runs; `ending_a` after ending A and `ending_b` after ending B.
4. **Nothing missing.** Every cue, mood and the murmur has a sound generator in the component file.
5. **The component gets what it needs.** `mapview.component_args(state)` holds the title, the picture, the visible hotspots (each with a cue), the music, the ambience and the ending cue, and it has no hotspots after an ending.
6. **Played by hand (manual).** In the browser: music plays after the first click and keeps going between rooms, each action makes its sound, mute works and is still on after a reload, there is no page reload on a click, and Ending A can be reached by clicking with the progress saved and resumed after a restart.
