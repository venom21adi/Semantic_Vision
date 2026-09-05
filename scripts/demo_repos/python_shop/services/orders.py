"""Order lifecycle: creation, status transitions, cancellation."""

from datetime import date

from models import ORDER_STATUSES, Order
from services.notifications import notify_customer
from utils.validation import validate_order_payload

_ALLOWED_TRANSITIONS = {
    "placed": ("shipped", "return_pending"),
    "shipped": ("completed", "return_pending"),
    "completed": ("return_pending",),
    "return_pending": ("returned",),
    "returned": (),
}


def create_order(session, payload):
    errors = validate_order_payload(payload)
    if errors:
        raise ValueError(f"invalid order payload: {', '.join(errors)}")

    order = Order(
        customer_id=payload["customer_id"],
        order_date=payload.get("order_date", date.today()),
        status="placed",
        amount=payload["amount"],
        credit_card_amount=payload.get("credit_card_amount", 0),
        coupon_amount=payload.get("coupon_amount", 0),
        bank_transfer_amount=payload.get("bank_transfer_amount", 0),
        gift_card_amount=payload.get("gift_card_amount", 0),
    )
    session.add(order)
    session.flush()
    notify_customer(order.customer_id, "order_placed", order_id=order.order_id)
    return order


def transition_order_status(session, order_id, new_status):
    """Move an order to `new_status`, enforcing the allowed transition graph."""
    if new_status not in ORDER_STATUSES:
        raise ValueError(f"unknown status: {new_status}")

    order = session.query(Order).filter_by(order_id=order_id).first()
    if order is None:
        raise LookupError(f"no such order: {order_id}")

    allowed = _ALLOWED_TRANSITIONS.get(order.status, ())
    if new_status not in allowed:
        raise ValueError(
            f"cannot move order {order_id} from {order.status} to {new_status}"
        )

    previous = order.status
    order.status = new_status

    if new_status == "shipped":
        notify_customer(order.customer_id, "order_shipped", order_id=order_id)
    elif new_status == "completed":
        notify_customer(order.customer_id, "order_completed", order_id=order_id)
    elif new_status == "returned" and previous != "returned":
        notify_customer(order.customer_id, "return_processed", order_id=order_id)

    return order


def cancel_order(session, order_id):
    order = session.query(Order).filter_by(order_id=order_id).first()
    if order is None:
        raise LookupError(f"no such order: {order_id}")

    if order.status not in ("placed", "shipped"):
        raise ValueError(f"order {order_id} can no longer be cancelled")

    order.status = "return_pending"
    return order


def compute_order_total(order):
    """Cross-check the four payment-method columns against `amount`."""
    parts = [
        order.credit_card_amount,
        order.coupon_amount,
        order.bank_transfer_amount,
        order.gift_card_amount,
    ]

    total = 0
    for part in parts:
        if part is not None:
            total += float(part)

    return total


def list_orders_for_customer(session, customer_id, statuses=None):
    query = session.query(Order).filter_by(customer_id=customer_id)
    orders = query.all()

    if statuses is None:
        return orders

    matched = []
    for order in orders:
        if order.status in statuses:
            matched.append(order)
    return matched
