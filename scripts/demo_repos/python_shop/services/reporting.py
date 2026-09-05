"""Reporting queries -- a mix of ORM traversal and raw SQL.

`raw_high_value_customers` deliberately goes around the ORM with a plain
cursor query, the way `flag_high_value_customers` in `customers.py` does it
through SQLAlchemy -- both should resolve to the same `customers` table/
column nodes on the graph despite the very different code shape.
"""

from collections import defaultdict

from models import ORDER_STATUSES, Customer


def customer_lifetime_value(session, customer_id):
    customer = session.query(Customer).filter_by(customer_id=customer_id).first()
    if customer is None:
        return 0.0

    total = 0.0
    for order in customer.orders:
        if order.amount is not None:
            total += float(order.amount)
    return total


def top_customers_by_spend(session, limit=10):
    totals = []
    for customer in session.query(Customer).all():
        value = customer_lifetime_value(session, customer.customer_id)
        totals.append((customer.customer_id, value))

    totals.sort(key=lambda row: row[1], reverse=True)
    return totals[:limit]


def monthly_revenue_report(session, year):
    """Bucket every completed order's amount by month, for one year."""
    by_month = defaultdict(float)

    for customer in session.query(Customer).all():
        for order in customer.orders:
            if order.order_date is None or order.order_date.year != year:
                continue
            if order.status != "completed":
                continue

            month = order.order_date.month
            if order.amount is not None:
                by_month[month] += float(order.amount)

    report = []
    for month in range(1, 13):
        report.append({"month": month, "revenue": round(by_month.get(month, 0.0), 2)})
    return report


def order_status_breakdown(session):
    counts = {status: 0 for status in ORDER_STATUSES}
    for customer in session.query(Customer).all():
        for order in customer.orders:
            if order.status in counts:
                counts[order.status] += 1
            else:
                counts[order.status] = counts.get(order.status, 0) + 1
    return counts


def raw_high_value_customers(cursor, threshold=1000):
    """Same intent as `flag_high_value_customers`, via a raw cursor query."""
    cursor.execute(
        "SELECT customer_id, first_name, last_name, total_order_amount "
        "FROM customers WHERE total_order_amount > ?",
        (threshold,),
    )
    return cursor.fetchall()
