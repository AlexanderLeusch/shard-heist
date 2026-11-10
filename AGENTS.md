# Shard Heist: rules for everyone who changes this project, people and coding agents

This file is the one place for the team's working rules. Every coding agent reads it (Codex reads `AGENTS.md`; Claude Code reads `CLAUDE.md`, which points here). Change it only through a pull request, like any other file.

## The project

A two-room browser game for the Nova SBE course *Introduction to Programming*. **Room 1**, *Plot Twist: Cell Block D*, is a 3D escape room (`escape-room/`). **Room 2**, *Shard Heist*, is the 3D police chase that follows (`index.html`, `styles.css`, `src/`). The original Python solo project *Plot Twist* is kept in `plot-twist/` for reference.

- Live: https://alexanderleusch.github.io/shard-heist/ (room 2) and https://alexanderleusch.github.io/shard-heist/escape-room/ (room 1)
- Repository: https://github.com/AlexanderLeusch/shard-heist (the only one; `Marco-open-source/plot-twist` is out of date)

## Stack (decided; do not change it without the whole team)

- **Plain HTML, CSS and JavaScript**, no framework, no build step, **no npm packages**. three.js r128 is loaded from a CDN with SRI hashes; nothing else comes from outside.
- **Hosting:** GitHub Pages, deployed by `.github/workflows/ci.yml` from `main`, and only when all tests pass.
- **Data:** only the player's browser (`localStorage`). There is no server, no database and no account. The full list of stored values, and how to reset them, is in `rules/settings.md`.
- **No secrets.** The game uses no API key, password or token. See "Secrets" below if that ever changes.
- The course's default stack is Python with Streamlit. A JavaScript stack needs the teaching staff's approval (course guide *Choosing a stack*).

## Run and test

You need Node.js 22 or newer. There is nothing to install.

```bash
npm start              # both rooms on http://localhost:8080 and http://localhost:8080/escape-room/
npm test               # all rules, story, input, page and escape-room tests (about 1 s)
npm run test:browser   # plays both rooms in headless Chrome or Edge (3 to 4 min)
npm run test:sri       # checks the three.js files against their hashes (needs internet)
npm run docs           # rebuilds docs/rules.html from rules/*.md
cd plot-twist && uv run pytest   # the original Python project's tests (needs uv)
```

## Where things are

| Part | Files | Rule |
|---|---|---|
| Room 2 rules | `src/core.js` | Pure functions only: no DOM, no three.js, no randomness of its own. Every rule that decides an outcome lives here and has a test in `tests/rules.test.js`, `story.test.js` or `input.test.js` |
| Room 2 world, AI, sound, HUD, story | `src/game.js` | Asks `core.js` for every decision. Each section and function starts with a `// ###` comment in English |
| Room 1 rules | `escape-room/src/rules.js` | `perform(state, action, target)` returns a new state for an accepted action and the same state plus a message for a refused one. Tests in `tests/escape-rules.test.js` |
| Room 1 3D room | `escape-room/src/room.js` | Only draws the state and turns clicks into actions |
| Rules in plain English | `rules/*.md` | Must match the code. After a change run `npm run docs` and commit `docs/rules.html` |
| Error screen | `src/boot.js`, `escape-room/src/boot.js` | Load failures, missing WebGL and unexpected errors show a card, never a black page |

## Branches, reviews and `main`

1. Work on a branch and open a pull request. Keep changes small and merge them often; no long-lived branches.
2. **A second team member reviews every pull request before it is merged.** The reviewer checks that it does what was asked, that tests cover it (including refused actions), and that it stays in its scope. The person who merges owns the result.
3. `npm test` and `npm run test:browser` pass before you push. CI runs them again and blocks the deploy if anything fails.
4. **When `main` is red:** nobody merges anything else. Whoever's change broke it fixes it or reverts it at once.
5. One owner at a time for each shared file (`src/core.js`, `src/game.js`, `escape-room/src/rules.js`, `escape-room/src/room.js`, this file). Say in the team chat before you start on one, so two branches never change the same rules in parallel.
6. Every member contributes code under their own name. Set `git config user.name` and `user.email` to your own, also when an agent makes the commit.
7. Deadline: commits after **23 November 2026, 23:59** do not count.

## What an agent must never do

- Never weaken, skip, edit or delete a test to make it pass. If a test looks wrong, say so and ask.
- Never add an npm package, a framework, a build step or another outside service. Ask the team first.
- Never put a key, password, token or connection string in a file. Never commit `.env`.
- Never change `plot-twist/` (the original solo project), unless the team asks for it.
- Never push to `main` without the tests passing, and never claim something works without showing the test output.
- Never leave debug hooks (such as `window.__dbg`) in the code.
- Do only the task that was asked, in its own files; list the changed files and show the test output at the end.

## Secrets (if one is ever needed)

The game has none today. If a feature needs a key: put it in `.env` (already in `.gitignore`; confirm with `git check-ignore .env` before the first commit that uses it), commit only a `.env.example` with placeholders, read it by name, and set the real value in the host's settings. A leaked key is revoked at the provider at once; deleting the commit is not enough.

## Documents to keep up to date

- `README.md`: live URL, team members with student numbers, run and test commands, how it is built and why, tests, security, limits.
- `rules/*.md` and `docs/rules.html` (+ `docs/Rules.pdf`): the rules of both rooms and all settings.
- `docs/code-guide.html` (+ `docs/Code-Guide.pdf`): architecture and code sections.
- `docs/course-guides.md`: how the project follows the course guides.
