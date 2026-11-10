# Shard Heist: rules for everyone who changes this project, people and coding agents

This file is the one place for the team's working rules. Every coding agent reads it (Codex reads `AGENTS.md`; Claude Code reads `CLAUDE.md`, which points here). Change it only through a pull request, like any other file.

## The project

A two-room browser game for the Nova SBE course *Introduction to Programming*. **Room 1**, *Plot Twist: Cell Block D*, is a 3D escape room (`room-1-escape/`). **Room 2**, *Shard Heist*, is the 3D police chase that follows (`room-2-chase/`). `index.html` at the top is the start page that leads to both. The original Python solo project *Plot Twist* is kept in `original-solo-project/` for reference. The README shows the whole folder tree.

- Live: https://alexanderleusch.github.io/shard-heist/ (start page), `room-1-escape/` (room 1) and `room-2-chase/` (room 2)
- Repository: https://github.com/AlexanderLeusch/shard-heist (the only one; `Marco-open-source/plot-twist` is out of date)

## Stack (decided; do not change it without the whole team)

- **Plain HTML, CSS and JavaScript**, no framework, no build step, **no npm packages**. three.js r128 is loaded from a CDN with SRI hashes; nothing else comes from outside.
- **Hosting:** GitHub Pages, deployed by `.github/workflows/ci.yml` from `main`, and only when all tests pass.
- **Data:** only the player's browser (`localStorage`). There is no server, no database and no real account: a leaderboard driver is only a name kept in the browser, with no password. The full list of stored values, and how to reset them, is in `docs/rules/settings.md`.
- **No secrets.** The game uses no API key, password or token. See "Secrets" below if that ever changes.
- The course's default stack is Python with Streamlit. A JavaScript stack needs the teaching staff's approval (course guide *Choosing a stack*).

## Run and test

You need Node.js 22 or newer. There is nothing to install.

```bash
npm start              # the start page and both rooms on http://localhost:8080
npm test               # all rules, story, input, page and escape-room tests (about 1 s)
npm run test:browser   # plays both rooms in headless Chrome or Edge (3 to 4 min)
npm run test:sri       # checks the three.js files against their hashes (needs internet)
npm run docs           # rebuilds docs/rules/rules.html from docs/rules/*.md
cd original-solo-project && uv run pytest   # the original Python project's tests (needs uv)
```

## Where things are

| Part | Files | Rule |
|---|---|---|
| Room 2 rules | `room-2-chase/js/core.js` | Pure functions only: no DOM, no three.js, no randomness of its own. Every rule that decides an outcome lives here and has a test in `tests/room-2/rules.test.js`, `story.test.js` or `input.test.js` |
| Room 2 world, AI, sound, HUD, story | `room-2-chase/js/game.js` | Asks `core.js` for every decision. Each section and function starts with a `// ###` comment in English |
| Room 1 rules | `room-1-escape/js/rules.js` | `perform(state, action, target)` returns a new state for an accepted action and the same state plus a message for a refused one. Tests in `tests/room-1/rules.test.js` |
| Room 1 3D room | `room-1-escape/js/room.js` | Only draws the state and turns clicks into actions |
| Rules in plain English | `docs/rules/*.md` | Must match the code. After a change run `npm run docs` and commit `docs/rules/rules.html` |
| Error screen | `room-2-chase/js/boot.js`, `room-1-escape/js/boot.js` | Load failures, missing WebGL and unexpected errors show a card, never a black page |

## Branches, reviews and `main`

1. Work on a branch and open a pull request. Keep changes small and merge them often; no long-lived branches.
2. **A second team member reviews every pull request before it is merged.** The reviewer checks that it does what was asked, that tests cover it (including refused actions), and that it stays in its scope. The person who merges owns the result.
3. `npm test` and `npm run test:browser` pass before you push. CI runs them again and blocks the deploy if anything fails.
4. **When `main` is red:** nobody merges anything else. Whoever's change broke it fixes it or reverts it at once.
5. One owner at a time for each shared file (`room-2-chase/js/core.js`, `room-2-chase/js/game.js`, `room-1-escape/js/rules.js`, `room-1-escape/js/room.js`, this file). Say in the team chat before you start on one, so two branches never change the same rules in parallel.
6. Every member contributes code under their own name. Set `git config user.name` and `user.email` to your own, also when an agent makes the commit.
7. Deadline: commits after **23 November 2026, 23:59** do not count.

## What an agent must never do

- Never weaken, skip, edit or delete a test to make it pass. If a test looks wrong, say so and ask.
- Never add an npm package, a framework, a build step or another outside service. Ask the team first.
- Never put a key, password, token or connection string in a file. Never commit `.env`.
- Never change `original-solo-project/` (the original solo project), unless the team asks for it.
- Never push to `main` without the tests passing, and never claim something works without showing the test output.
- Never leave debug hooks (such as `window.__dbg`) in the code.
- Do only the task that was asked, in its own files; list the changed files and show the test output at the end.

## Secrets (if one is ever needed)

The game has none today. If a feature needs a key: put it in `.env` (already in `.gitignore`; confirm with `git check-ignore .env` before the first commit that uses it), commit only a `.env.example` with placeholders, read it by name, and set the real value in the host's settings. A leaked key is revoked at the provider at once; deleting the commit is not enough.

## Documents to keep up to date

- `README.md`: live URL, team members with student numbers, run and test commands, how it is built and why, tests, security, limits.
- `docs/rules/*.md` and `docs/rules/rules.html` (+ `docs/rules/Rules.pdf`): the rules of both rooms and all settings.
- `docs/code-guide/code-guide.html` (+ `docs/code-guide/Code-Guide.pdf`): architecture and code sections.
- `docs/course-guides.md`: how the project follows the course guides.
