"""
payment.py -- Payment processing for the sample shop.

Depends on database.py and utils/validation.py.
"""

from database import save_payment
from utils.validation import validate_amount


def process_payment(user, amount):
    """
    Validate and record a payment.

    Parameters
    ----------
    user : dict
        The logged-in user record.
    amount : float
        The payment amount to charge.
    """
    if not validate_amount(amount):
        raise ValueError(f"Invalid payment amount: {amount}")
    save_payment(user, amount)
    print(f"Payment of {amount} processed for {user['username']}")
