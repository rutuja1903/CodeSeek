"""
services/auth.py -- Authentication service for the sample shop.

Depends on database.py and utils/validation.py.
"""

from database import get_user
from utils.validation import validate_email


class AuthService:
    """Handles user authentication for the shop."""

    def login_user(self, username, password):
        """
        Attempt to log in a user.

        Validates the email format, then looks up the user record.
        Returns the user dict on success, or None on failure.
        """
        if not validate_email(username):
            print(f"Invalid email format: {username}")
            return None
        user = get_user(username)
        if user is None:
            print(f"User not found: {username}")
        return user

    def display_name(self, user):
        """Return a display-friendly name for the user (method on AuthService)."""
        return user.get("username", "Unknown")
