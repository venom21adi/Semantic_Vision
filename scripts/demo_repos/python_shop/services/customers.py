"""Customer-facing queries and derived metrics."""

from models import Customer, Order
from utils.formatting import format_currency


def get_customer(session, customer_id):
    return session.query(Customer).filter_by(customer_id=customer_id).first()


def get_customer_summary(session, customer_id):
    """Fetch a customer plus the order stats a support agent actually needs."""
    customer = get_customer(session, customer_id)
    if customer is None:
        return None

    orders = session.query(Order).filter_by(customer_id=customer_id).all()
    if not orders:
        return {
            "customer_id": customer_id,
            "name": customer.full_name(),
            "order_count": 0,
            "lifetime_value": format_currency(0),
        }

    total = 0
    completed = 0
    for order in orders:
        if order.status == "completed":
            completed += 1
        if order.amount is not None:
            total += float(order.amount)

    return {
        "customer_id": customer_id,
        "name": customer.full_name(),
        "order_count": len(orders),
        "completed_orders": completed,
        "lifetime_value": format_currency(total),
    }


def flag_high_value_customers(session, threshold=1000):
    """Return customer ids whose lifetime spend crosses `threshold`.

    Walks every customer once rather than pushing the aggregation into SQL,
    since this demo store also wants a function with a real loop + branch
    for the complexity/flowchart views.
    """
    flagged = []
    for customer in session.query(Customer).all():
        total = 0
        for order in customer.orders:
            if order.amount is None:
                continue
            total += float(order.amount)
        if total > threshold:
            flagged.append(customer.customer_id)
    return flagged


def merge_duplicate_customers(session, keep_id, duplicate_id):
    """Reassign a duplicate customer's orders onto the record to keep."""
    keep = get_customer(session, keep_id)
    duplicate = get_customer(session, duplicate_id)
    if keep is None or duplicate is None:
        raise ValueError("both customers must exist to merge")

    moved = 0
    for order in list(duplicate.orders):
        order.customer_id = keep.customer_id
        moved += 1

    session.delete(duplicate)
    return moved
