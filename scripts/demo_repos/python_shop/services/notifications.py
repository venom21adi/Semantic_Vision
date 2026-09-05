"""Customer notification dispatch (email/sms stubs -- this is a demo)."""

_TEMPLATES = {
    "order_placed": "Thanks for your order #{order_id}!",
    "order_shipped": "Order #{order_id} is on its way.",
    "order_completed": "Order #{order_id} has been delivered.",
    "return_processed": "We've processed the return for order #{order_id}.",
}


def render_template(event, **context):
    template = _TEMPLATES.get(event)
    if template is None:
        return f"Update on your account (event: {event})"
    return template.format(**context)


def notify_customer(customer_id, event, channel="email", **context):
    message = render_template(event, **context)

    if channel == "email":
        _send_email(customer_id, message)
    elif channel == "sms":
        _send_sms(customer_id, message)
    else:
        raise ValueError(f"unknown channel: {channel}")

    return message


def batch_notify(customer_ids, event, **context):
    sent = 0
    failed = []
    for customer_id in customer_ids:
        try:
            notify_customer(customer_id, event, **context)
            sent += 1
        except Exception:
            failed.append(customer_id)
    return {"sent": sent, "failed": failed}


def _send_email(customer_id, message):
    print(f"[email -> customer {customer_id}] {message}")


def _send_sms(customer_id, message):
    print(f"[sms -> customer {customer_id}] {message}")
