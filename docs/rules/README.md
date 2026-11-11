# Game rules

> These documents describe what the game does, as implemented in the code. When a rule changes, update the document, the code and the tests together, then run `npm run docs` to rebuild the printable version.

The game has two rooms that are played one after the other. Until the group connects them, each room is its own page.

| Room | Document | Code with the rules | Tests |
|---|---|---|---|
| 1 · Plot Twist: Cell Block D (escape room) | [room-1-escape-room.md](room-1-escape-room.md) | `room-1-escape/js/rules.js` | `tests/room-1/rules.test.js` |
| 2 · Shard Heist (police chase) | [room-2-shard-heist.md](room-2-shard-heist.md) | `room-2-chase/js/core.js` (rules), `room-2-chase/js/game.js` (pickups, police AI) | `tests/room-2/rules.test.js`, `tests/room-2/story.test.js`, `tests/room-2/input.test.js` |
| Both rooms: every setting and option | [settings.md](settings.md) | `room-2-chase/js/core.js`, `room-1-escape/js/rules.js` (checks of stored values) | `tests/room-2/rules.test.js`, `tests/room-1/rules.test.js`, `tests/browser/browser.test.js` |

## The whole game in one paragraph

In April 2012 the Starfall necklace, lent by the Ashford family to Lisbon's naval museum for the centenary of the Titanic, vanished from its case. You were the detective on the case, until the trail ended at your own door. Now you are inmate 4471, convicted of stealing it. **Room 1:** you have ten minutes in a prison washroom to find the code for a hatch in the floor. If you get out (Ending A), a note shows that the guard wanted you out, and a car is waiting at the end of the tunnel. **Room 2:** the police chase begins. You drive a getaway vehicle through Lisbon's Baixa, on the highway and across the countryside, collecting star shards while up to four police cars and a helicopter hunt you.

## One night, one look

- **Time:** both rooms are set on the same night: room 1 around 02:15, room 2 from about 02:30.
- **Design:** both rooms share one design system: the same background, glass panels, fonts, buttons and cards. Each room keeps its own accent colour: **orange** in the prison, **cyan** on the run. Hale's radio messages in room 2 are orange because he comes from room 1.
- A test (`tests/project/page.test.js`) checks that the shared design tokens and the story links between the rooms stay in place.

## How the two rooms will connect (planned, not built)

- Ending A of room 1 shows a button that opens room 2.
- Ending B of room 1 stays in room 1 (try again).
- Open question for the group: does room 2 then start in free ride, or straight in the story mode *The Necklace Job*?

## Words used in these documents

| Word | Meaning |
|---|---|
| **Accepted action** | The player did something allowed. The state changes and is saved. |
| **Refused action** | The player tried something not allowed. Nothing changes, and the player is told why. |
| **State** | Everything the game remembers at one moment: where you are, items, time left, and so on. |
| **Scene** | A place you can stand in room 1 (the door, the sinks, ...). |
| **Hotspot** | Something you can use in a scene, shown as a pulsing marker (or, on a touch screen, a "Walk to" button). |
| **Tick** | One step of the clock, many times per second. |
