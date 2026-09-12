"""
utils/validation.py -- Validation helpers for the sample shop.
"""


def validate_email(email):
    """
    Return True if the email address looks valid (contains '@' and '.').
    This is a simple check, not a full RFC 5322 validator.
    """
    return isinstance(email, str) and "@" in email and "." in email


def validate_amount(amount):
    """
    Return True if the payment amount is a positive number.
    """
    try:
        return float(amount) > 0
    except (TypeError, ValueError):
        return False
