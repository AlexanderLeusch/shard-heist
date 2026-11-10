# How Shard Heist follows the course guides

> Checked on 10 November 2026 against the team project page and the ten guides of the course wiki (https://2477-introduction-programming.gitlab.io/wiki/). ✅ done · ⚠️ partly, or needs the team · ❌ missing. The open points are collected at the end.

## Team project requirements

| Requirement | Status | Where / how |
|---|---|---|
| Deployed at a public URL | ✅ | https://alexanderleusch.github.io/shard-heist/ (start page), `/room-1-escape/`, `/room-2-chase/`, GitHub Pages |
| Repository is public, `main` holds the deployed code | ✅ | Pages is deployed only from `main`, by CI |
| No keys or passwords in the repository | ✅ | The game has no secrets; a test scans every file; GitHub secret scanning and push protection are on |
| `README.md` has the deployed URL | ✅ | Top of the README |
| `README.md` has the **names and student numbers of all members** | ❌ | Still missing: the team adds them |
| `README.md` has the commands to run the app and its tests | ✅ | "Run it locally" |
| Every member contributes code to the repository | ⚠️ | Commits by Alexander, Marco, Jasper and Louisa. Sarah's changes arrive through her pull requests, but their commits carry the author name "Claude": set `git config user.name` / `user.email` so they count under her name |
| Team of 3 to 4 students | ⚠️ | Five people have write access; if all five are members, clear it with the teaching staff |
| Live demo at the deployed URL | ✅ | Nothing to wake up: static hosting does not sleep |
| Walkthrough: data, tests, unavailable API | ✅ | README: "Security", "Testing", "When something is unavailable"; `docs/rules/settings.md` lists all stored data |

## Choosing a stack

| Guide point | Status | Where / how |
|---|---|---|
| A stack other than Python needs the teaching staff's approval | ⚠️ | The game is plain JavaScript. **Confirm the approval with the teaching staff** (or note when it was given) |
| The stack fits the interface (games need more than Streamlit) | ✅ | 3D games with real-time input; README "Why it is built this way" |
| Every member can explain it | ⚠️ | No framework and no build step keep it small; every member should read README, AGENTS.md and the Code Guide |
| Stack, run and test commands recorded in `AGENTS.md` | ✅ | `AGENTS.md` |
| No last-minute stack switch, no second stack | ✅ | One stack; `original-solo-project/` is the original project, kept for reference and tested by CI |

## Storing data

| Guide point | Status | Where / how |
|---|---|---|
| What must survive, who shares it, its shape | ✅ | Settings, best times, drivers and leaderboards, and the escape-room save, per browser, in `localStorage`; nothing is shared between devices (the leaderboard compares the players on one device) |
| No credentials, tests never touch real data | ✅ | No database; tests run on fixed values in Node and on a fresh browser profile |
| Storage choice and how to reset it recorded | ✅ | `docs/rules/settings.md` (table of stored values, reset by clearing site data), `AGENTS.md` |
| Stored data is validated | ✅ | `parsePick`, `parseBest`, `parseRadio`, `parseSteer`, `parseVolume`, `restore` |

## Hosting and deploying

| Guide point | Status | Where / how |
|---|---|---|
| Host matches the app type | ✅ | Static site → GitHub Pages |
| Deploys automatically from `main` | ✅ | `.github/workflows/ci.yml`, only when all tests pass |
| Runs from a fresh copy of the repository | ✅ | CI checks out the repository and tests it; the deploy copies only committed files |
| No sleeping app, no temporary disk, no secrets on the host | ✅ | Static hosting; nothing written on the server |
| Before the demo: the latest merge is live | ⚠️ | Check the "Actions" tab and reload the page with `Ctrl+Shift+R` (Pages caches up to 10 minutes) |

## User accounts

| Guide point | Status | Where / how |
|---|---|---|
| Accounts only when people need different data or rights | ✅ | Single-player game, everyone sees the same thing: no accounts, on purpose |
| Permissions checked where the action happens | ✅ | `Core.actionAllowed` and room 1's `perform` refuse actions in the wrong state, not just by hiding buttons; tested |

## Real-time and multiplayer

| Guide point | Status | Where / how |
|---|---|---|
| Only if users interact live | ✅ | Not built. README "How it could change" describes a possible multiplayer with a WebSocket server that decides busts with the same `core.js` rules |

## External APIs

| Guide point | Status | Where / how |
|---|---|---|
| Plan for failure | ✅ | No API is called. The only outside dependency is the three.js CDN: if it fails, the error screen explains it (tested in the browser) |
| Tests never call a real service | ✅ | Unit tests run in Node; the browser test serves the game locally |

## AI in your app

| Guide point | Status | Where / how |
|---|---|---|
| A model as a feature | ✅ | Not used, so no key, cost or wrong answers to handle |

## Coding agents

| Guide point | Status | Where / how |
|---|---|---|
| Rules live in the project, in `AGENTS.md` | ✅ | `AGENTS.md`: stack, run and test commands, branch rule, what an agent must never do |
| Claude Code points to `AGENTS.md` | ✅ | `CLAUDE.md` |
| All agents read the same rules | ✅ | Codex reads `AGENTS.md`, Claude Code via `CLAUDE.md` |
| Read every agent change before accepting it | ⚠️ | Part of the review rule in `AGENTS.md`; see "Working as a team" |
| Disclose agent use | ✅ | README credits |

## Working as a team

| Guide point | Status | Where / how |
|---|---|---|
| How work is split, who owns shared files | ✅ | `AGENTS.md`: one owner at a time for `core.js`, `game.js`, `rules.js`, `room.js`, `AGENTS.md` |
| **A second person reviews every change before `main`** | ❌ | Pull requests #1–#14 were merged without a review, and some changes went straight to `main`. From now on: `AGENTS.md` rule 2 |
| Rule when `main` breaks | ✅ | `AGENTS.md` rule 4 |
| Track the work (GitHub issues or a shared list) | ⚠️ | No issues so far. One issue per feature or bug, linked to its pull request, would show who did what |
| Small, short-lived branches | ✅ | Pull requests are small and merged within a day |

## Secrets and safety

| Guide point | Status | Where / how |
|---|---|---|
| Secrets out of the repository; `.env` ignored before the first commit | ✅ | `.gitignore` lists `.env`; the game uses no secret |
| `.env.example` if secrets exist | ✅ | Not needed: no secrets. `AGENTS.md` says what to do if one is added |
| After a leak: revoke at the provider | ✅ | `AGENTS.md` |
| Least privilege | ✅ | CI runs with `contents: read`; only the deploy job may write to Pages |
| Close dashboards before screen sharing | ⚠️ | A reminder for the presentation |

## Open points for the team

1. Add the **names and student numbers** of all members to `README.md`.
2. Confirm the **teaching staff's approval** of the JavaScript stack.
3. **Review every pull request** by a second member before merging (`AGENTS.md`).
4. Sarah: set your own **git name and email**, so your commits count under your name.
5. If all five people with write access are members, clear the **team size** (3 to 4) with the teaching staff.
6. Optional: track the remaining work as **GitHub issues**.
