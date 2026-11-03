# Shard Heist

A two-room browser game. **Room 1, *Plot Twist: Cell Block D***, is a 3D prison escape room: find the code for the hatch in the washroom floor before the guard comes back. **Room 2, *Shard Heist***, is the 3D police chase that follows. The two rooms are developed separately and will be connected at the end.

| Room | Play |
|---|---|
| 1 · Escape room | https://alexanderleusch.github.io/shard-heist/escape-room/ |
| 2 · Police chase | https://alexanderleusch.github.io/shard-heist/ |

Both are published automatically from `main` once all tests pass. The rules of both rooms are written out in plain English in [rules/](rules/README.md).

The folder `plot-twist/` holds the original solo project *Plot Twist: The Missing Necklace* (Python and Streamlit), which room 1 rebuilds in 3D. It is kept for reference, and CI tests it, but it is not part of the deployed game. Run it with `cd plot-twist && uv run streamlit run app.py`.

## Room 1 · Plot Twist: Cell Block D

You were the detective on the Ashford necklace case; now you are inmate 4471, convicted of the theft. Officer Hale locks you in washroom 2 for ten minutes. A hatch in the floor is held shut by a four-digit combination lock, and the code is hidden in the room.

| | |
|---|---|
| Scenes (5) | The door, the sinks, the toilet stall, the hatch, the tunnel |
| Items (2) | A spoon (pries the crooked tile off the wall) and a mop (optional: jams the door) |
| Clues (3) | Steam on the mirror, graffiti in the stall, a newspaper scrap behind the tile. Together they give the year the "unsinkable" ship sank. The code is always the same |
| Endings (2) | **A:** the hatch opens in time and you climb down into the tunnel. **B:** time runs out and Hale takes you back to your cell. The earlier choice to jam the door buys one extra minute before Ending B |
| Pressure | 10:00 clock, warnings at 5:00, 2:00, 1:00 and 0:30; every wrong code makes noise and costs 30 seconds |
| Controls | Drag (or arrow keys) to look around, click the pulsing markers or the objects, "Walk to" buttons to move, `P` / `Esc` pause, `M` sound |

Progress is saved in the browser after every accepted action, and a reload offers to continue.

## Room 2 · Shard Heist

A 3D police-chase driving game that runs in any modern browser. Pick a map and a getaway vehicle, grab the glowing star shards, shake off up to three police cars and reach the finish before the clock runs out. Or play **The Necklace Job**, a three-act story with three endings.

**Play:** https://alexanderleusch.github.io/shard-heist/ (published automatically from `main` once all tests pass)

| | |
|---|---|
| Maps | City traffic (traffic lights, 26 AI cars), Highway (4 km, 200 km/h, traffic both ways), Countryside (hills, farms, village) |
| Vehicles | Muscle coupe (balanced), Superbike (fastest, most agile), Tractor unit (slowest, toughest, best at ramming) |
| Story mode | *The Necklace Job*: 3 acts on the 3 maps, 2 story items (a hidden letter, a clasp), 3 endings. Which one you get depends on whether you found the letter in act 1 |
| Systems | Police AI with a bust meter, crash damage and repair kits, synthesised engine sounds, map-boundary force field, radar, Ultra/Balanced graphics |
| Controls | `W A S D` or arrow keys to drive, `Space` handbrake, `P` / `Esc` pause, `M` sound, `Enter` confirms. Touch pads on phones |

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer. There is nothing to install.

```bash
npm start          # serves both rooms: http://localhost:8080/escape-room/ and http://localhost:8080
npm test           # rules, story, input, page and escape-room tests (about 1 s)
npm run test:sri   # checks the library files against their integrity hashes (needs internet)
npm run test:browser   # plays both rooms in headless Chrome or Edge (about 1.5 min)
npm run test:all   # all of the above
cd plot-twist && uv run pytest   # the 36 Python tests of the original Plot Twist project (needs uv)
```

Opening `escape-room/index.html` or `index.html` directly from the folder also works.

## How it is built

```
rules/            the rules of both rooms in plain English (working draft)
plot-twist/       the original Python/Streamlit solo project: logic.py, story.py, db.py, app.py, pytest tests
escape-room/      ROOM 1, self-contained (it shares no files with room 2):
  index.html        page structure: HUD, markers, cards, error screen
  styles.css        prison look
  src/boot.js       error screen (a copy of room 2's, so the room works on its own)
  src/rules.js      the story and rules as pure functions: scenes, items, clues, lock, clock, saved games
  src/room.js       the 3D washroom, camera, markers, lock and clue cards, sound

index.html        ROOM 2 page structure: HUD, cockpit, menu overlay, error screen; loads the scripts in order
styles.css        all styling (glass HUD, cockpit, showroom menu, error screen)
src/boot.js       error screen: catches load failures, missing WebGL and unexpected errors
src/core.js       the rules: tuning tables, driving, damage, police pressure, scoring, story, input validation
src/game.js       everything visual and real-time: 3D worlds, vehicles, traffic and police AI, sound, HUD, story scenes
tests/            Node tests for both rooms' rules and pages, plus a headless-browser test of both rooms
scripts/          dev server (serve.js) and the SRI checker (check-sri.js)
.github/workflows CI: JavaScript tests, SRI check, browser tests, Python tests and dependency audit on every push to main
                  and every pull request; deploy to GitHub Pages only when all of them pass
docs/             Code Guide (PDF): architecture, all code sections, tuning, limits
```

**Room 1 in one sentence.** `rules.js` holds the state as one plain object; `perform(state, action, target)` returns a new state for an accepted action and the same, unchanged state plus a message for a refused one; `tick()` runs the clock; `room.js` only draws the state and turns clicks into actions. This is the structure of the original Plot Twist project, in JavaScript and 3D.

**The frame loop (room 2).** `frame()` in `game.js` runs once per screen refresh: player physics → police → pickups, timer, story → traffic and signals → particles, boundary, camera → engine sound → HUD and radar → render. The time step is capped at 50 ms (`Core.frameDt`), so a slow frame never moves a car through a wall.

**The state machine.** `menu → play ⇄ pause → done | over`. Every button on a card has a `data-action`, and `Core.actionAllowed(action, state)` decides whether it may run, so a stale click is ignored.

**Rules vs. presentation.** `core.js` contains only pure functions: numbers in, numbers out, no DOM, no 3D, no randomness of its own. `game.js` calls it for every decision that affects the outcome (top speed, braking, damage, bust meter, stars, best times, which ending you get) and does everything else itself. Every section of `game.js` starts with a `// ###` comment that explains it.

## Why it is built this way

| Decision | Why | Trade-off |
|---|---|---|
| Static website, no backend, no build step | Runs anywhere, free hosting on GitHub Pages, nothing to install or keep running, no server to attack | No online leaderboard |
| three.js r128 from a CDN, pinned to one version, with SRI hashes | A proven 3D engine instead of raw WebGL; the hashes make the browser refuse any file that is not exactly the one we tested | r128 is from 2021; upgrading means re-testing the post-processing add-ons |
| Everything procedural (buildings, textures, vehicles, sounds) | No image or audio files to license or download; the whole game is a few hundred KB | Stylised rather than photo-real |
| Rules split out into `core.js` | They can be tested in Node in milliseconds, and the rules are in one place | `game.js` still shares state between its sections |
| Arcade physics (speed along the heading, collision circles) | Predictable, fun handling at 60 fps on modest hardware | No real tyre grip or weight transfer |
| Engine sound synthesised from combustion pulses | Reacts to every rpm and gear change, different per vehicle | Approximates real engines, it is not a recording |
| Story as data (`STORY` acts and radio timeline) plus rules in `core.js` | Texts and timing can change without touching the logic; the ending logic is tested | Branching is simple (one decision, three endings) |

## Testing

`npm test` runs 64 tests in Node (15 of them for the escape room), and `npm run test:browser` runs 14 more in headless Chrome (4 of them in the escape room). CI runs all of them, plus the SRI check and the 36 pytest checks of `plot-twist/`, on every push to `main` and on every pull request. They cover:

- **Escape room:** both endings and the jammed-door grace minute; refused actions (walking where there is no exit, taking an item twice, the tile without the spoon, the door without the mop, lock wheels that do not exist, anything before the briefing or after an ending) return the unchanged state; wrong codes cost 30 s but never take the clock below zero; warnings sound once; tampered saved games are rejected; in the browser: briefing, refused action, save and continue after a reload, a wrong code and then Ending A.
- **Accepted actions:** each menu action in the states whose cards show it; valid map and vehicle picks; restoring a valid saved selection; finishing every story act; both story endings.
- **Rejected actions:** card buttons while driving; story buttons without a story; "next act" after the last act; unknown actions; picks such as `"tank"`, `"constructor"` or `"__proto__"`; acts outside 1–3; the act 2 toll without the clasp; tampered saved data; dev-server requests for `.git`, for paths outside the folder, and with methods other than GET or HEAD.
- **Edge cases:** gas and brake held together, zero-length and 3-second frames, negative frame times, NaN impacts, damage above 100 or below 0, coasting to exactly zero, a letter found in an attempt that then failed, radio lines that must not repeat, time displays that must never show negative or NaN.
- **Consistency:** the 0–80 km/h figure and the top speed on the menu card match the physics; every element id the game looks up exists in the page; every button action is reachable.
- **Real browser:** the menu loads without errors, picking a vehicle updates the card, a run starts and the throttle moves the car, pause and resume work, story act 1 starts, and the error screen appears when a library is blocked or WebGL is missing.

Writing the tests found two real bugs. Both are fixed:
1. Saved data like `{"mode":"constructor"}` passed the old check `if (MODES[s.mode])`, because every object inherits a `constructor` property. That would have crashed the game on the next load.
2. The car could go about 5 km/h faster than the top speed shown on the menu card, because the throttle pushed past the limit every frame before it was pulled back. Now the throttle stops at the top speed.

## Security

- **No accounts, no server, no personal data.** The only data the game stores is your last map and vehicle, best times and the graphics setting, all in your browser's `localStorage`. There are no credentials anywhere in the repository; a test scans every file for keys and tokens.
- **Input validation.** Everything read back from `localStorage` is checked (`parsePick`, `parseBest`) and replaced by defaults when it is invalid. Menu picks and actions are checked against fixed lists using own properties only. Error messages are inserted as text, never as HTML.
- **Access control.** Nothing on the site needs a login. Cards accept only the actions allowed in the current state, and the dev server only serves known file types from the project folder (no `.git`, no path traversal, GET and HEAD only).
- **Dependencies.** No npm packages at all. The Python project pins every package in `uv.lock`, and CI audits them with `pip-audit` (0 known vulnerabilities on 3 November 2026). The only runtime library is three.js 0.128.0 (9 files), pinned by exact URL, checked by SRI hashes (`npm run test:sri`) and loaded with `crossorigin="anonymous"`. `npm audit` reports 0 known vulnerabilities for `three@0.128.0` (checked 3 November 2026). GitHub Actions are pinned to commit hashes.
- **Content Security Policy.** Scripts may only come from this site and the two pinned CDNs; there are no inline scripts, plugins, forms or foreign base URLs.

## Limits

- **Look and sound:** procedural geometry and synthesised engines are stylised; they do not look or sound like photos or recordings.
- **Performance:** Ultra graphics (bloom, large shadow maps) needs a decent GPU; phones start in Balanced.
- **AI:** traffic never changes lanes; police ignore traffic lights and can take detours in the city.
- **Physics:** arcade model with collision circles; no tyre grip or mass transfer.
- **Structure:** `game.js` is one large closure (about 3,400 lines) whose sections share variables, so it is harder to work on in parallel than separate modules would be.
- **Testing:** the browser test checks the main workflows, but not long play sessions, every map end to end, or sound quality, and the CI browser renders in software.
- **Persistence:** best times live in one browser only and can be edited by the player.

## How it could change

- Split `game.js` into ES modules (world, traffic, police, physics, audio, ui, story) behind a common map interface (`build`, `reset`, `update`, `progress`).
- Move police steering and traffic following into `core.js` so they can be tested too.
- **Planned: online multiplayer (getaway vs. police).** One player drives the getaway vehicle, the other a police car. This needs a small server (for example Node.js with WebSockets) that pairs players in a room and relays positions about 20 times a second. To stop cheating, the server should decide the bust and the finish, using the same `core.js` rules (`bustStep`, `finishOpen`), and accept only validated messages from each player. `core.js` already runs in Node, so the server can reuse it without changes.
- An online leaderboard would need a small backend with authentication, rate limiting and server-side validation of run times.
- Load real glTF vehicle models and recorded engine loops for more realism; add lane changes for traffic.
- Longer browser tests that drive whole runs and story acts with scripted inputs.

## Credits

Built with three.js r128 (MIT licence). Fonts: Bricolage Grotesque and JetBrains Mono (Google Fonts, SIL Open Font License). Code written with the help of Claude (Anthropic).
