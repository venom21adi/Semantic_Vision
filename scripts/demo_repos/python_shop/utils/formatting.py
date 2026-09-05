"""Display formatting helpers."""


def format_currency(amount, currency="AUD"):
    if amount is None:
        amount = 0
    return f"{currency} {amount:,.2f}"


def format_customer_name(first_name, last_name):
    parts = [part for part in (first_name, last_name) if part]
    return " ".join(parts) if parts else "Unknown customer"


def humanize_status(status):
    if not status:
        return "Unknown"
    words = status.split("_")
    return " ".join(word.capitalize() for word in words)
