# Room 1 · Plot Twist: Cell Block D

> This document describes the rules in `escape-room/src/rules.js`. Values marked **(open)** are not decided yet.

## Goal

Open the hatch in the floor of the toilet stall and climb out **before the clock reaches zero**.

## Story

The briefing is a short series of cards; **Next** and **Back** move between them.

1. **The front page.** *The Lisbon Times* of Monday 16 April 2012: the **Starfall necklace**, lent by the Ashford family to the Museu de Marinha for an exhibition marking 100 years since the Titanic sank, vanished from its glass case on the night of the centenary. No alarm sounded, and a detective was put on the case.
2. **Who you are.** Three weeks ago you were that detective. The trail ended at your own door: the necklace's velvet box was hidden in your car. Tonight you are **inmate 4471**, convicted of the theft: someone framed you. Your oldest friend on the force kept digging and found the proof that clears your name, but the people who framed you came after him. Before he disappeared from Lisbon, he hid the evidence across the city, in places only you would know to look.
3. **The door.** Officer Hale walks you to washroom 2. In a short scene in the room you turn round to the open door, see him in the corridor light, and watch him swing the door shut and lock it. Through the door he says: "Your ten minutes have begun. Not a second more." He waits outside.
4. **The rumour.** Inmates whisper about a hatch in the floor of this washroom, locked with a four-digit code that is hidden somewhere in the room.
5. **How to play:** the controls.

The clock only starts when the player presses **Start the clock** after the briefing.

## Time

| Rule | Value |
|---|---|
| Time limit | **10:00** (open: 10 or 15 minutes; `TIME_LIMIT`) |
| Warnings from Hale | at 5:00, 2:00, 1:00 and 0:30, each only once |
| Wrong code | costs **30 seconds** (`WRONG_CODE_PENALTY`), never below 0:00 |
| Jammed door | when the clock hits 0:00 the first time, you get **one extra minute** (`WEDGE_GRACE`), once only |
| The clock stops | in the briefing, in the pause menu (which also opens when the browser tab is hidden or the window loses focus), and after an ending |
| The clock keeps running | while reading a clue and while turning the lock |

## Scenes and how to move

| Scene | What is there | You can walk to |
|---|---|---|
| **The Door** (start) | Steel door with a barred window, Hale outside; scratches in the wall beside it; mop in a bucket | Sinks, Stall |
| **The Sinks** | Two steel sinks, a polished metal mirror, an empty soap dish, a hot tap | Door, Stall |
| **The Stall** | Steel toilet, scratches on the wall, a crooked tile, the hatch in the floor | Door, Sinks, Hatch |
| **The Hatch** | The trapdoor with a four-wheel combination lock (you kneel down) | Stall |
| **The Tunnel** | Only reached through Ending A | – |

Walking anywhere else is refused: "You cannot get there from here."

## Items (you can carry two)

| Item | Where | What it does |
|---|---|---|
| **Mop** | Bucket by the door | Optional. Used at the door ("Jam the door with the mop") it is placed under the door handle and leaves your inventory. This buys the extra minute. |
| **Car key** | In a hollow behind the crooked tile, once you have pried it off with your fingers | Optional. A car key on a worn leather fob that someone hid there for you, a hint at the car waiting after Ending A. It opens nothing in this room. |

## Clues and the code

| Clue | How to find it | Text |
|---|---|---|
| **Mirror** | Turn on the hot tap first. Then the steam shows letters someone traced. Without steam you only see your face. | "UNSINKABLE?" |
| **Graffiti** | Read the scratches on the stall wall | "She was unsinkable. She sailed only once. The year opens the floor." |
| **Scratches by the door** | Read the words scratched into the wall beside the door | "The 'unsinkable' went down on her first voyage. 15 April 19▒2. More than 1,500 lost." |

- The code is **1912**, the year the Titanic sank. It is the **same in every game** (open: should it change between games?).
- Players who do not know the history can still solve it: "sailed only once" gives the missing digit 1.
- Every clue you read is kept in your clue notes (3 at most). Reading a clue again does not count twice.
- The crooked tile comes off by hand and hides the car key, not a clue.

## The lock

- Four wheels, each showing 0–9. Up after 9 is 0, down after 0 is 9.
- You can only turn the wheels and try the code while kneeling at the hatch.
- **Try the code:**
  - Right code: the hatch opens, Ending A.
  - Wrong code: "Clunk. The lock holds." Hale hears the noise, and you lose 30 seconds. The number of wrong codes is counted.

## Endings

| Ending | When | What happens |
|---|---|---|
| **A · Out below** | The right code before time runs out | You climb down the ladder. A note is taped to it: "Took you long enough. A car is waiting at the end of the tunnel. — H." The guard wanted you out. That is the plot twist that leads to room 2. |
| **B · Back to the cell** | The clock reaches 0:00 (after the extra minute, if the door was jammed) | The door bangs open and Hale and two officers take you back to cell 4471. |

**The earlier decision:** jamming the door early gives one more minute at the very end. That can turn Ending B into Ending A.

After an ending, every action is refused except **Play again / Try again**, which starts a new game from the briefing.

## Refused actions (nothing changes, the player is told why)

| The player tries to... | Message (short) |
|---|---|
| do anything before the briefing is finished | "Read the briefing first." |
| walk where there is no way | "You cannot get there from here." |
| take an item that is not here, or twice | "There is no ... here." / "You already have the ..." |
| jam the door without the mop, or a second time | "You need something long and solid..." / "The door is already jammed." |
| take the car key while the tile is still on | "The tile is still in place." |
| use the tap away from the sinks, the lock away from the hatch | "There is no tap here." / "Kneel down at the hatch to reach the lock." |
| turn a wheel that does not exist | "The lock only has four wheels." |
| do anything after an ending | "The story is over. Start a new game to play again." |

## Saving

- The game is saved in the browser after **every accepted action** and every few seconds while the clock runs.
- After a reload, the player can **Continue** (with the time that was left) or start a **New game**, which asks for confirmation first.
- A saved game is checked field by field when loaded. Anything that is not a real save is ignored, and a new game starts.

## Controls

| Input | Action |
|---|---|
| Drag the mouse or a finger, or the arrow keys | Look around |
| Click a pulsing marker or the object itself | Use it |
| "Walk to" buttons (bottom right) | Move to another scene |
| "Clues" button (bottom left) | Read your clue notes |
| `P` / `Esc` | Pause (Esc also closes a card) |
| `M` | Sound on or off |
| Volume slider | On the pause card, 0 to 100 %. It is kept for the next visit |
| `Enter` | Confirm the main button on a card |
