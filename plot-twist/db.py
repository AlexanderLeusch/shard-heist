"""Saves and loads the player's progress in one SQLite file. One save slot only."""

import json
import sqlite3
from contextlib import closing

DB_PATH = "plot_twist.db"


def _connect(path):
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS progress ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "scene TEXT NOT NULL, "
        "inventory TEXT NOT NULL, "
        "drawer_emptied INTEGER NOT NULL, "
        "table_emptied INTEGER NOT NULL, "
        "ending TEXT)"
    )
    return connection


def save_progress(path, state):
    """Write the state to the file, replacing any earlier save."""
    with closing(_connect(path)) as connection, connection:
        connection.execute(
            "INSERT OR REPLACE INTO progress (id, scene, inventory, drawer_emptied, table_emptied, ending) "
            "VALUES (1, ?, ?, ?, ?, ?)",
            (
                state["scene"],
                json.dumps(state["inventory"]),
                int(state["drawer_emptied"]),
                int(state["table_emptied"]),
                state["ending"],
            ),
        )


def load_progress(path):
    """Return the saved state, or None if nothing has been saved yet."""
    with closing(_connect(path)) as connection:
        row = connection.execute(
            "SELECT scene, inventory, drawer_emptied, table_emptied, ending FROM progress WHERE id = 1"
        ).fetchone()
    if row is None:
        return None
    return {
        "scene": row[0],
        "inventory": json.loads(row[1]),
        "drawer_emptied": bool(row[2]),
        "table_emptied": bool(row[3]),
        "ending": row[4],
    }
