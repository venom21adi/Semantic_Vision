"""Payment-method bookkeeping for an order."""

from models import PAYMENT_METHODS, Order

_COLUMN_BY_METHOD = {
    "credit_card": "credit_card_amount",
    "coupon": "coupon_amount",
    "bank_transfer": "bank_transfer_amount",
    "gift_card": "gift_card_amount",
}


def validate_payment_method(method):
    return method in PAYMENT_METHODS


def process_payment(session, order_id, method, amount):
    if not validate_payment_method(method):
        raise ValueError(f"unsupported payment method: {method}")
    if amount <= 0:
        raise ValueError("payment amount must be positive")

    order = session.query(Order).filter_by(order_id=order_id).first()
    if order is None:
        raise LookupError(f"no such order: {order_id}")

    column = _COLUMN_BY_METHOD[method]
    current = getattr(order, column) or 0
    setattr(order, column, float(current) + amount)
    order.amount = (order.amount or 0) + amount
    return order


def refund_payment(session, order_id, method, amount):
    order = session.query(Order).filter_by(order_id=order_id).first()
    if order is None:
        raise LookupError(f"no such order: {order_id}")

    column = _COLUMN_BY_METHOD.get(method)
    if column is None:
        raise ValueError(f"unsupported payment method: {method}")

    current = getattr(order, column) or 0
    refundable = min(float(current), amount)
    setattr(order, column, float(current) - refundable)
    order.amount = max(0.0, (order.amount or 0) - refundable)
    return refundable


def reconcile_payment_methods(session, order_id):
    """Recompute `amount` from the four per-method columns, method by method.

    Surfaces any drift (an order whose columns no longer sum to `amount`,
    e.g. after a partial refund rounding error) instead of trusting the
    cached total blindly.
    """
    order = session.query(Order).filter_by(order_id=order_id).first()
    if order is None:
        raise LookupError(f"no such order: {order_id}")

    recomputed = 0.0
    breakdown = {}
    for method in PAYMENT_METHODS:
        column = _COLUMN_BY_METHOD[method]
        value = getattr(order, column)
        if value is None:
            continue
        recomputed += float(value)
        breakdown[method] = float(value)

    drift = round(recomputed - float(order.amount or 0), 2)
    if drift != 0:
        order.amount = recomputed

    return {"order_id": order_id, "breakdown": breakdown, "drift": drift}
