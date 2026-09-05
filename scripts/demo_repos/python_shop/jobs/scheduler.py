"""A tiny hand-rolled job runner -- no Celery/cron dependency for this demo."""

import time

from jobs.cleanup import purge_stale_orders
from services.notifications import batch_notify


def retry_with_backoff(fn, *, max_attempts=3, base_delay=0.0):
    """Run `fn`, retrying on any exception with exponential backoff.

    `base_delay=0.0` in this demo repo so nightly-job traces don't actually
    sleep; a real deployment would pass a real delay.
    """
    attempt = 0
    last_error = None

    while attempt < max_attempts:
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            attempt += 1
            if attempt >= max_attempts:
                break
            time.sleep(base_delay * (2 ** attempt))
            continue

    raise RuntimeError(f"gave up after {attempt} attempts") from last_error


def run_nightly_jobs(session, notify_customer_ids=None):
    """Run each nightly job in turn, collecting failures instead of aborting."""
    results = {}
    jobs = {
        "purge_stale_orders": lambda: purge_stale_orders(session),
    }

    for name, job in jobs.items():
        try:
            results[name] = retry_with_backoff(job)
        except RuntimeError as exc:
            results[name] = {"error": str(exc)}

    if notify_customer_ids:
        results["notifications"] = batch_notify(notify_customer_ids, "nightly_digest")

    return results
