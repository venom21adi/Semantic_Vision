"""Nightly housekeeping over stale orders and old payment history."""

from datetime import date, timedelta

from models import Order


def purge_stale_orders(session, older_than_days=90):
    """Cancel-out any `placed` order that's been sitting untouched too long."""
    cutoff = date.today() - timedelta(days=older_than_days)
    purged = 0

    for order in session.query(Order).filter_by(status="placed").all():
        if order.order_date is None:
            continue
        if order.order_date > cutoff:
            continue

        order.status = "return_pending"
        purged += 1

    return purged


def archive_old_payments(session, orders, cutoff_year):
    """Split orders into (archived, retained) by year, for cold storage."""
    archived = []
    retained = []

    for order in orders:
        if order.order_date is None:
            retained.append(order)
            continue

        if order.order_date.year < cutoff_year:
            archived.append(order)
        else:
            retained.append(order)

    return archived, retained
