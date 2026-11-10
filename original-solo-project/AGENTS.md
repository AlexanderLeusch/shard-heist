# Plot Twist — notes for the AI agent

Solo project for the Nova SBE Introduction to Programming course. The story is "The Missing Necklace". The person asking is a **beginner** who must be able to explain every part of the app in an exam. Teach, don't just do.

## Run and test

- Run the app: `uv run streamlit run app.py`
- Run the tests: `uv run pytest`
- Always use `uv`. Never use `pip` or `python -m venv`.

## Structure

- `app.py` — the screens (Streamlit). Shows the scene and the buttons. No game rules here.
- `logic.py` — the rules. Pure functions on a state dict. No Streamlit, no database here.
- `story.py` — the fixed story content (rooms, text, where items start). Never changes while playing.
- `db.py` — saves and loads progress in one SQLite file. One save slot only.
- `tests/` — pytest checks. `specs/` — one spec per task. `docs/` — a copy of the brief.

State is a dict: `scene`, `inventory` (list), `drawer_emptied` (bool). Progress is saved after every accepted action. A rejected action changes nothing and is not saved.

## Rules for working

- Read `specs/first-feature.md` and `docs/01-plot-twist-brd.html` before building anything.
- Propose the file structure and the tests first. Wait for the student to review them before writing game code.
- Never weaken, skip, edit or delete a test to make it pass. If a test looks wrong, say so and ask.
- Work on a branch (`first-feature`), never directly on `main`.
- After a change: run `uv run pytest`, show the output, and list the changed files.
- Build only the task that was asked. Do not add features from the brief that are out of scope for the current spec.
- Keep the `*.db` save file and secrets out of git.
- Every claim about the code comes with file and line.
