"""Input validation helpers shared by the API layer."""

import re

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

REQUIRED_ORDER_FIELDS = ("customer_id", "amount")


def validate_email(email):
    if not email:
        return False
    return bool(_EMAIL_RE.match(email))


def sanitize_string(value, max_length=200):
    if value is None:
        return ""
    cleaned = value.strip()
    if len(cleaned) > max_length:
        return cleaned[:max_length]
    return cleaned


def validate_order_payload(payload):
    errors = []

    for field in REQUIRED_ORDER_FIELDS:
        if field not in payload or payload[field] in (None, ""):
            errors.append(f"missing field: {field}")

    if "amount" in payload:
        try:
            amount = float(payload["amount"])
        except (TypeError, ValueError):
            errors.append("amount must be numeric")
        else:
            if amount <= 0:
                errors.append("amount must be positive")

    if "customer_id" in payload and payload["customer_id"] is not None:
        if not isinstance(payload["customer_id"], int):
            errors.append("customer_id must be an integer")

    return errors
