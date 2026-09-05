"""SQLAlchemy models for the jaffle-shop-style demo store.

Column names deliberately mirror dbt Labs' jaffle_shop_duckdb tutorial
schema (customers/orders), so a real `dbt build` of that project can be
ingested against these same tables via Data Lineage -> Add tables & models.
"""

from datetime import date

from sqlalchemy import Column, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Customer(Base):
    __tablename__ = "customers"

    customer_id = Column(Integer, primary_key=True)
    first_name = Column(String)
    last_name = Column(String)

    orders = relationship("Order", back_populates="customer")

    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class Order(Base):
    __tablename__ = "orders"

    order_id = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"))
    order_date = Column(Date)
    status = Column(String)
    amount = Column(Numeric)
    credit_card_amount = Column(Numeric)
    coupon_amount = Column(Numeric)
    bank_transfer_amount = Column(Numeric)
    gift_card_amount = Column(Numeric)

    customer = relationship("Customer", back_populates="orders")

    def is_terminal(self) -> bool:
        return self.status in ("completed", "returned")


ORDER_STATUSES = ("placed", "shipped", "completed", "return_pending", "returned")
PAYMENT_METHODS = ("credit_card", "coupon", "bank_transfer", "gift_card")


def today() -> date:
    return date.today()
