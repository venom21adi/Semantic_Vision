"""Session/engine wiring for the demo store."""

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base

_engine = create_engine("sqlite:///:memory:")
_SessionLocal = sessionmaker(bind=_engine)


def init_db() -> None:
    Base.metadata.create_all(_engine)


@contextmanager
def session_scope():
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
