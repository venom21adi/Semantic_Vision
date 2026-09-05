"""Thin HTTP-style handlers -- the layer a real web framework would call.

Kept framework-free on purpose (no Flask/FastAPI dependency) so this demo
repo parses standalone; each handler is exactly what a route decorator
would wrap.
"""

from services.customers import flag_high_value_customers, get_customer_summary
from services.orders import (
    cancel_order,
    create_order,
    list_orders_for_customer,
    transition_order_status,
)
from services.reporting import monthly_revenue_report, top_customers_by_spend
from utils.pagination import paginate


def get_customer_endpoint(session, customer_id):
    summary = get_customer_summary(session, customer_id)
    if summary is None:
        return {"status": 404, "body": {"error": "customer not found"}}
    return {"status": 200, "body": summary}


def create_order_endpoint(session, payload):
    try:
        order = create_order(session, payload)
    except ValueError as exc:
        return {"status": 400, "body": {"error": str(exc)}}
    return {"status": 201, "body": {"order_id": order.order_id}}


def cancel_order_endpoint(session, order_id):
    try:
        order = cancel_order(session, order_id)
    except LookupError:
        return {"status": 404, "body": {"error": "order not found"}}
    except ValueError as exc:
        return {"status": 409, "body": {"error": str(exc)}}
    return {"status": 200, "body": {"order_id": order.order_id, "status": order.status}}


def advance_order_status_endpoint(session, order_id, new_status):
    try:
        order = transition_order_status(session, order_id, new_status)
    except LookupError:
        return {"status": 404, "body": {"error": "order not found"}}
    except ValueError as exc:
        return {"status": 409, "body": {"error": str(exc)}}
    return {"status": 200, "body": {"order_id": order.order_id, "status": order.status}}


def list_orders_endpoint(session, customer_id, page=1, page_size=20, status=None):
    statuses = None
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]

    orders = list_orders_for_customer(session, customer_id, statuses=statuses)
    rows = [{"order_id": o.order_id, "status": o.status, "amount": float(o.amount or 0)} for o in orders]
    return {"status": 200, "body": paginate(rows, page=page, page_size=page_size)}


def high_value_customers_endpoint(session, threshold=1000):
    ids = flag_high_value_customers(session, threshold=threshold)
    return {"status": 200, "body": {"customer_ids": ids}}


def revenue_report_endpoint(session, year):
    report = monthly_revenue_report(session, year)
    return {"status": 200, "body": {"year": year, "months": report}}


def top_customers_endpoint(session, limit=10):
    rows = top_customers_by_spend(session, limit=limit)
    body = [{"customer_id": cid, "lifetime_value": value} for cid, value in rows]
    return {"status": 200, "body": body}
