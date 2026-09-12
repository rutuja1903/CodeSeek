"""
database.py -- Simple in-memory database helpers for the sample shop.
"""


class Database:
    """A minimal stand-in for a real database connection."""

    def __init__(self):
        self._store = {}

    def save(self, key, value):
        """Persist a value under the given key."""
        self._store[key] = value
        return True

    def get(self, key):
        """Retrieve a value by key, or None if it does not exist."""
        return self._store.get(key)


def get_user(username):
    """Look up a user record by username. Returns a dict or None."""
    # Placeholder -- real code would query a database.
    users = {
        "alice@example.com": {"username": "alice@example.com", "role": "customer"},
    }
    return users.get(username)


def save_payment(user, amount):
    """Record a payment for a user."""
    db = Database()
    db.save(f"payment_{user['username']}", {"amount": amount, "status": "completed"})
    return True
