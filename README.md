# Shard Heist

A two-room browser game. **Room 1, *Plot Twist: Cell Block D***, is a 3D prison escape room: find the code for the hatch in the washroom floor before the guard comes back. **Room 2, *Shard Heist***, is the 3D police chase that follows. A start page leads to both rooms.

| Page | Play |
|---|---|
| Start page (both rooms) | https://alexanderleusch.github.io/shard-heist/ |
| 1 · Escape room | https://alexanderleusch.github.io/shard-heist/room-1-escape/ |
| 2 · Police chase | https://alexanderleusch.github.io/shard-heist/room-2-chase/ |

Both rooms take place on the same night and share one design system (the same fonts, panels, buttons and cards), with orange as the accent of the prison and cyan as the accent of the chase. Room 2's story starts where room 1 ends: inmate 4471 is on the run, and Officer Hale helps over the radio.

Both are published automatically from `main` once all tests pass. The rules of both rooms are written out in plain English in [docs/rules/](docs/rules/README.md).

The folder `original-solo-project/` holds the original solo project *Plot Twist: The Missing Necklace* (Python and Streamlit), which room 1 rebuilds in 3D. It is kept for reference, and CI tests it, but it is not part of the deployed game. Run it with `cd original-solo-project && uv run streamlit run app.py`.

## Room 1 · Plot Twist: Cell Block D

You were the detective on the Ashford necklace case; now you are inmate 4471, convicted of the theft. Officer Hale locks you in washroom 2 for ten minutes. A hatch in the floor is held shut by a four-digit combination lock, and the code is hidden in the room.

| | |
|---|---|
| Scenes (5) | The door, the sinks, the toilet stall, the hatch, the tunnel |
| Items (2) | The car key hidden behind the crooked tile (pried off by hand), and a mop (optional: jams the door) |
| Clues (3) | Steam on the mirror, graffiti in the stall, scratches in the wall beside the door. Together they give the year the "unsinkable" ship sank. The code is always the same |
| Endings (2) | **A:** the hatch opens in time and you climb down into the tunnel. **B:** time runs out and Hale takes you back to your cell. The earlier choice to jam the door buys one extra minute before Ending B |
| Pressure | 10:00 clock, warnings at 5:00, 2:00, 1:00 and 0:30; every wrong code makes noise and costs 30 seconds |
| Controls | Arrow keys (or `W A S D`) to walk freely in the first person, drag to look around, click the pulsing markers or the objects, "Walk to" buttons to glide to a spot (touch screens), `P` / `Esc` pause, `M` sound, a volume slider on the pause card |

Progress is saved in the browser after every accepted action, and a reload offers to continue.

## Room 2 · Shard Heist

A 3D police-chase driving game that runs in any modern browser. Pick a map and a getaway vehicle, find the six pieces of evidence that prove you innocent in Lisbon (or grab the bonus shards on the open road), shake off up to four police cars and a helicopter and reach the finish before the clock runs out. Or play **The Necklace Job**, a three-act story with three endings.

**Play:** https://alexanderleusch.github.io/shard-heist/room-2-chase/ (published automatically from `main` once all tests pass)

| | |
|---|---|
| Maps | Lisbon's Baixa (real street names, Arco da Rua Augusta, traffic lights, 26 AI cars, 2 buses, 4 motorcycles, 3 trams), Highway (4 km, 200 km/h, traffic both ways), Countryside (hills, farms, village) |
| Vehicles | Muscle coupe (balanced), Superbike (fastest, most agile), Tractor unit (slowest, toughest, best at ramming) |
| Story mode | *The Necklace Job*, after the escape: 3 acts on the 3 maps, Officer Hale on the radio, 2 story items (a hidden letter, a clasp), 3 endings. Which one you get depends on whether you found the letter in act 1 |
| Systems | Seven synthesised radio stations, hills on every map, wanted stars and a police helicopter, visible damage, police AI with a bust meter, crash damage and repair kits, synthesised engine sounds, map-boundary force field, radar, Ultra/Balanced graphics |
| Controls | `W A S D` or arrow keys to drive, `Space` handbrake, `P` / `Esc` pause, `M` sound, `R` radio, volume sliders for game and music in the menu and the pause, `Enter` confirms. On phones: touch pads (brake and gas together are the handbrake), and steering by tilting the phone sideways |

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer. There is nothing to install.

```bash
npm start          # serves the start page and both rooms: http://localhost:8080
npm test           # rules, story, input, page and escape-room tests (about 1 s)
npm run test:sri   # checks the library files against their integrity hashes (needs internet)
npm run test:browser   # plays both rooms in headless Chrome or Edge (about 3 to 4 min)
npm run test:all   # all of the above
cd original-solo-project && uv run pytest   # the 36 Python tests of the original Plot Twist project (needs uv)
```

Opening `index.html`, `room-1-escape/index.html` or `room-2-chase/index.html` directly from the folder also works.

## How it is built

The repository has one folder per room, and one folder for each kind of supporting work. Each room is a complete web page on its own.

```
shard-heist/
├── index.html               START PAGE: the two rooms in playing order (no script)
├── README.md                this file
├── AGENTS.md / CLAUDE.md    working rules for the team and its coding agents
│
├── room-1-escape/           ROOM 1 · Plot Twist: Cell Block D (3D escape room)
│   ├── index.html           page structure: HUD, markers, cards, error screen
│   ├── styles.css           the prison look
│   ├── js/rules.js          the rules: scenes, items, clues, lock, clock, saved games (pure functions)
│   ├── js/room.js           the 3D washroom, camera, markers, cards, sound
│   ├── js/boot.js           error screen (load failures, no WebGL, unexpected errors)
│   ├── textures/            CC0 scans from Poly Haven: concrete, cinder blocks, scratched steel, the vault HDRI
│   └── fonts/               the two fonts with their licences
│
├── room-2-chase/            ROOM 2 · Shard Heist (3D police chase)
│   ├── index.html           page structure: HUD, cockpit, menu, error screen; loads the scripts in order
│   ├── styles.css           the chase look (also used by the start page)
│   ├── js/core.js           the rules: driving, damage, police, scoring, story, input checks (pure functions)
│   ├── js/game.js           everything visual and real-time: worlds, vehicles, AI, sound, HUD, story scenes
│   ├── js/boot.js           error screen
│   └── fonts/               the two fonts with their licences
│
├── tests/                   all automated tests
│   ├── room-1/              rules of room 1
│   ├── room-2/              rules, story and menu input of room 2
│   ├── project/             both pages, security, the dev server, documents
│   └── browser/             plays both rooms and the start page in a real (headless) browser
│
├── docs/                    documents
│   ├── rules/               the rules of both rooms and all settings (Markdown, HTML, Rules.pdf)
│   ├── code-guide/          the Code Guide: architecture and every code section (HTML, PDF)
│   └── course-guides.md     how the project follows the course guides
│
├── tools/                   serve.js (dev server), check-sri.js (library hashes), build-rules.js (rules → HTML)
├── original-solo-project/   the original Plot Twist solo project (Python/Streamlit) that room 1 rebuilds; tested by CI
└── .github/workflows/       CI: all tests on every push and pull request; deploy to GitHub Pages only when they pass
```

**Where to start reading.** For a room's rules, open its rules file (`room-1-escape/js/rules.js`, `room-2-chase/js/core.js`) and the matching tests. For what the player sees, open its page and its big script (`room.js`, `game.js`). The plain-English rules in `docs/rules/` describe the same things without code.

**Room 1 in one sentence.** `rules.js` holds the state as one plain object; `perform(state, action, target)` returns a new state for an accepted action and the same, unchanged state plus a message for a refused one; `tick()` runs the clock; `room.js` only draws the state and turns clicks into actions. This is the structure of the original Plot Twist project, in JavaScript and 3D.

**The frame loop (room 2).** `frame()` in `game.js` runs once per screen refresh: player physics → police → pickups, timer, story → traffic and signals → particles, boundary, camera → engine sound → HUD and radar → render. The time step is capped at 50 ms (`Core.frameDt`), so a slow frame never moves a car through a wall.

**The state machine.** `menu → play ⇄ pause → done | over`. Every button on a card has a `data-action`, and `Core.actionAllowed(action, state)` decides whether it may run, so a stale click is ignored.

**Rules vs. presentation.** `core.js` contains only pure functions: numbers in, numbers out, no DOM, no 3D, no randomness of its own. `game.js` calls it for every decision that affects the outcome (top speed, braking, damage, bust meter, stars, best times, which ending you get) and does everything else itself. Every section of `game.js` starts with a `// ###` comment that explains it.

## Why it is built this way

| Decision | Why | Trade-off |
|---|---|---|
| Static website, no backend, no build step | Runs anywhere, free hosting on GitHub Pages, nothing to install or keep running, no server to attack | No online leaderboard |
| three.js r128 from a CDN, pinned to one version, with SRI hashes | A proven 3D engine instead of raw WebGL; the hashes make the browser refuse any file that is not exactly the one we tested | r128 is from 2021; upgrading means re-testing the post-processing add-ons |
| Everything procedural (buildings, textures, vehicles, sounds), except four CC0 scans from Poly Haven in the escape room | Almost no image or audio files to license or download; the scans (concrete, cinder blocks, scratched steel and one HDRI for the steel's reflections, 1.7 MB) make the washroom photo-real where it matters | Stylised elsewhere |
| Rules split out into `core.js` | They can be tested in Node in milliseconds, and the rules are in one place | `game.js` still shares state between its sections |
| Arcade physics (speed along the heading, collision circles) | Predictable, fun handling at 60 fps on modest hardware | No real tyre grip or weight transfer |
| Engine sound from a small physical model: a pressure pulse per firing, a reflecting exhaust pipe, fixed muffler resonances, separate loops for load and overrun | Follows every rpm and gear change, each vehicle has its real engine layout, and the model can be tested in Node | Approximates real engines, it is not a recording; we checked it by measurement, and the group should judge it by ear |
| Story as data (`STORY` acts and radio timeline) plus rules in `core.js` | Texts and timing can change without touching the logic; the ending logic is tested | Branching is simple (one decision, three endings) |
| Hills by bending finished flat worlds over one height field | The layouts, collisions and radar stay simple 2D; every layer is cut on one grid, so layers cannot pass through each other | Building fronts follow the slope instead of stepping |
| Radio composed and synthesised at run time | No music files, so no licences; each bar is a tested list of notes | Stylised, without vocals |

## Testing

`npm test` runs 125 tests in Node (17 of them for the escape room), and `npm run test:browser` runs 20 more in headless Chrome (4 of them in the escape room). CI runs all of them, plus the SRI check and the 36 pytest checks of `original-solo-project/`, on every push to `main` and on every pull request. They cover:

- **Escape room:** both endings and the jammed-door grace minute; refused actions (walking where there is no exit, taking an item twice, the car key before the tile is off, the door without the mop, lock wheels that do not exist, anything before the briefing or after an ending) return the unchanged state; wrong codes cost 30 s but never take the clock below zero; warnings sound once; tampered saved games are rejected; in the browser: briefing, refused action, save and continue after a reload, a wrong code and then Ending A.
- **Accepted actions:** each menu action in the states whose cards show it; valid map and vehicle picks; restoring a valid saved selection; finishing every story act; both story endings.
- **Rejected actions:** card buttons while driving; story buttons without a story; "next act" after the last act; unknown actions; picks such as `"tank"`, `"constructor"` or `"__proto__"`; acts outside 1–3; the act 2 toll without the clasp; tampered saved data; dev-server requests for `.git`, for paths outside the folder, and with methods other than GET or HEAD.
- **Edge cases:** gas and brake held together, zero-length and 3-second frames, negative frame times, NaN impacts, damage above 100 or below 0, coasting to exactly zero, a letter found in an attempt that then failed, radio lines that must not repeat, time displays that must never show negative or NaN.
- **Consistency:** the 0–80 km/h figure and the top speed on the menu card match the physics; every element id the game looks up exists in the page; every button action is reachable.
- **Real browser:** the menu loads without errors, picking a vehicle updates the card, a run starts and the throttle moves the car, pause and resume work, story act 1 starts, and the error screen appears when a library is blocked or WebGL is missing.

Writing the tests found two real bugs. Both are fixed:
1. Saved data like `{"mode":"constructor"}` passed the old check `if (MODES[s.mode])`, because every object inherits a `constructor` property. That would have crashed the game on the next load.
2. The car could go about 5 km/h faster than the top speed shown on the menu card, because the throttle pushed past the limit every frame before it was pulled back. Now the throttle stops at the top speed.

## Security

- **No real accounts, no server, no personal data.** A driver for the leaderboard is only a name, with no password, kept in this browser; names are cleaned and escaped before they are shown. The only data the game stores is your last map and vehicle, best times, the drivers and leaderboards, the radio station, the graphics setting, the steering choice, the volumes and the saved escape-room game, all in your browser's `localStorage` (the full list is in [docs/rules/settings.md](docs/rules/settings.md)). The game has no server of its own. The fonts ship with the game; only the three.js library comes from cdnjs and jsDelivr, so those two services see your IP address. There are no credentials anywhere in the repository; a test scans every file for keys and tokens.
- **Input validation.** Everything read back from `localStorage` is checked (`parsePick`, `parseBest`, `parseRadio`, `parseSteer`, `parseVolume`, and `restore` and `parseVolume` in room 1) and replaced by defaults when it is invalid. Menu picks and actions are checked against fixed lists using own properties only. Error messages are inserted as text, never as HTML.
- **Access control.** Nothing on the site needs a login. Cards accept only the actions allowed in the current state, and the dev server only serves known file types from the project folder (no `.git`, no path traversal, GET and HEAD only).
- **Dependencies.** No npm packages at all. The two fonts ship in each room's `fonts/` folder with their licences, so no font service is needed. The Python project pins every package in `uv.lock`, and CI audits them with `pip-audit` on every push; a known vulnerability fails the build and stops the deploy. GitHub's Dependabot alerts are on for the repository, so a newly published vulnerability in a pinned version is reported even when nobody pushes. The only runtime library is three.js 0.128.0 (9 files), pinned by exact URL, checked by SRI hashes (`npm run test:sri`) and loaded with `crossorigin="anonymous"`. `npm audit` reports 0 known vulnerabilities for `three@0.128.0` (checked 3 November 2026). GitHub Actions are pinned to commit hashes.
- **Content Security Policy.** Scripts may only come from this site and the two pinned CDNs; there are no inline scripts, plugins, forms or foreign base URLs.

## When something is unavailable

The game needs no server of its own and calls no API. The only outside service is the CDN for three.js. Each thing that can be missing has a defined behaviour:

| Missing | What happens |
|---|---|
| three.js or one of its effect files (cdnjs, jsDelivr), offline or blocked, or a file that fails its integrity check | The error screen in `room-2-chase/js/boot.js` says which file could not load and offers *Reload*, instead of a black page. A browser test blocks the library on purpose and checks this card |
| WebGL (old or locked-down browser) | The same error screen explains how to turn on hardware acceleration. A browser test removes WebGL and checks it |
| `localStorage` (private mode, blocked storage) | Every read and write is wrapped, so the game runs with the defaults and simply does not remember settings, best times, drivers or the escape-room save |
| The motion sensor on a phone (missing or refused) | Steering stays on the buttons |

## Limits

- **Lisbon:** the map is a simplified Baixa: square blocks, 7 streets each way, and some real streets left out. It has hills, which the real Baixa does not: a game decision. The houses follow the Pombaline pattern and the landmarks are modelled freely from descriptions, not from plans. It is recognisable, not surveyed. The other two maps are not Lisbon yet.
- **Look and sound:** procedural geometry, synthesised engines and the radio are stylised; they do not look or sound like photos or recordings. Sound was checked by measurement (frequency, level, spectrum), so it should also be judged by ear.
- **Performance:** Ultra graphics (bloom, large shadow maps) needs a decent GPU; phones start in Balanced. When the frame rate stays under 48 per second, the resolution drops by itself, down to 60 %. Frame rates were only measured in software rendering, not on a real phone.
- **AI:** traffic never changes lanes and keeps its speed on hills; police ignore traffic lights and can take detours in the city.
- **Physics:** arcade model with collision circles; no tyre grip or mass transfer.
- **Structure:** `game.js` is one large closure (about 5,100 lines) whose sections share variables, so it is harder to work on in parallel than separate modules would be.
- **Testing:** the browser test checks the main workflows, but not long play sessions, every map end to end, or sound quality, and the CI browser renders in software.
- **Persistence:** best times and the leaderboard live in one browser only and can be edited by the player, so the board compares the people who play on the same device, not everyone online. A shared online board would need a server and a database.

The street names and their order were checked against [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL). The game ships no map data and calls no map service.

## How it could change

- Split `game.js` into ES modules (world, traffic, police, physics, audio, ui, story) behind a common map interface (`build`, `reset`, `update`, `progress`).
- Move police steering and traffic following into `core.js` so they can be tested too.
- **Planned: online multiplayer (getaway vs. police).** One player drives the getaway vehicle, the other a police car. This needs a small server (for example Node.js with WebSockets) that pairs players in a room and relays positions about 20 times a second. To stop cheating, the server should decide the bust and the finish, using the same `core.js` rules (`bustStep`, `finishOpen`), and accept only validated messages from each player. `core.js` already runs in Node, so the server can reuse it without changes.
- An online leaderboard would need a small backend with authentication, rate limiting and server-side validation of run times.
- Load real glTF vehicle models and recorded engine loops for more realism; add lane changes for traffic.
- Longer browser tests that drive whole runs and story acts with scripted inputs.

## Working as a team

The team's working rules for people and coding agents are in [AGENTS.md](AGENTS.md): the stack, the run and test commands, branches and reviews, what to do when `main` breaks, and what an agent must never do. `CLAUDE.md` points there, so every agent follows the same rules. [docs/course-guides.md](docs/course-guides.md) checks the project against the course's team project page and its ten guides, with the points that are still open.

## Credits

All radio music is composed and synthesised by the game at run time, so there are no music files or licences. The tunes are generated from seeded random walks. The classical station plays J. S. Bach's Prelude in C (BWV 846) and the Ode to Joy from Beethoven's Ninth Symphony, both in the public domain.


Escape-room scans from [Poly Haven](https://polyhaven.com) (CC0, fetched through its public API and kept in `room-1-escape/textures/`): the textures *Hangar Concrete Floor*, *Concrete Wall 004* and *Blue Metal Plate*, and the HDRI *Bank Vault*. CC0 asks for no credit; we give it anyway.

Built with three.js r128 (MIT licence). Fonts: Big Shoulders Display and JetBrains Mono (SIL Open Font License 1.1; the font files and their licences are in `room-1-escape/fonts/` and `room-2-chase/fonts/`). Code written with the help of Claude (Anthropic).
