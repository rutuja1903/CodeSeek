"""
models/user.py -- User model classes for the sample shop.

Demonstrates class inheritance (User extends BaseUser).
"""


class BaseUser:
    """Base class with shared user behaviour."""

    def __init__(self, username):
        self.username = username

    def display_name(self):
        """Return a plain display name (overridden by subclasses)."""
        return self.username


class User(BaseUser):
    """A registered shop customer."""

    def __init__(self, username, role="customer"):
        super().__init__(username)
        self.role = role

    def display_name(self):
        """Return the username with role appended."""
        return f"{self.username} ({self.role})"
