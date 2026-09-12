"""
app.py -- Entry point for the sample shop application.

Imports from other modules to demonstrate file-level dependencies.
"""

from services.auth import AuthService
from payment import process_payment


def start_application(username, password, amount):
    """Start the shop application, log in a user and process a payment."""
    auth = AuthService()
    user = auth.login_user(username, password)
    if user:
        process_payment(user, amount)


if __name__ == "__main__":
    start_application("alice@example.com", "secret123", 49.99)
