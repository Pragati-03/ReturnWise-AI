"""Seed demo data for local development.

Usage (from backend/, after `alembic upgrade head`):

    python -m app.db.seed

For a clean slate, delete returnwise.db (and its -wal/-shm files), then run
`alembic upgrade head` and this script again.

This script never creates refunded money, PayPal IDs or capture IDs. Those only
come from real PayPal sandbox activity.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import inspect, select

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import SessionLocal, engine
from app.models import Customer, Order, OrderItem, User
from app.models.enums import Currency, PaymentStatus
from app.schemas.auth import RegisterRequest
from app.schemas.return_request import CreateReturnRequest
from app.services import auth as auth_service
from app.services import workflow
from app.services.returns import create_return

DEMO_EMAIL = "demo@example.com"  # example.com is reserved, so this can never be a real mailbox
DEMO_NAME = "Demo Seller"

# Fictional customers. All addresses use the reserved example.com domain.
CUSTOMERS: dict[str, tuple[str, str]] = {
    "aarav": ("Aarav Mehta", "aarav.mehta@example.com"),
    "sofia": ("Sofia Alvarez", "sofia.alvarez@example.com"),
    "liam": ("Liam O'Connor", "liam.oconnor@example.com"),
    "priya": ("Priya Nair", "priya.nair@example.com"),
    "noah": ("Noah Becker", "noah.becker@example.com"),
    "hana": ("Hana Kimura", "hana.kimura@example.com"),
    "mateo": ("Mateo Silva", "mateo.silva@example.com"),
    "emma": ("Emma Fischer", "emma.fischer@example.com"),
}


@dataclass(frozen=True)
class ItemSpec:
    sku: str
    name: str
    quantity: int
    unit_price_minor: int
    returnable: bool = True


@dataclass(frozen=True)
class OrderSpec:
    key: str
    number: str
    customer: str
    items: tuple[ItemSpec, ...]
    placed_days_ago: int
    delivered_days_ago: int | None
    payment_status: PaymentStatus = PaymentStatus.CAPTURED


@dataclass(frozen=True)
class ReturnSpec:
    order: str
    sku: str
    quantity: int
    amount: str
    comment: str
    submitted_days_ago: float
    outcome: Literal["submitted", "review", "approved", "rejected"]
    note: str = ""
    decision_hours: int = 24


ORDERS: tuple[OrderSpec, ...] = (
    OrderSpec("aarav", "RW-2001", "aarav", (
        ItemSpec("EARBUDS-PRO", "Wireless Earbuds Pro", 1, 7999),
        ItemSpec("CABLE-USBC", "USB-C Charging Cable", 2, 1250),
    ), placed_days_ago=13, delivered_days_ago=9),
    OrderSpec("sofia", "RW-2002", "sofia", (
        ItemSpec("BLANKET-LINEN", "Linen Throw Blanket", 1, 6400),
        ItemSpec("MUG-SET-4", "Ceramic Mug Set (4 pcs)", 1, 3850),
    ), placed_days_ago=16, delivered_days_ago=12),
    OrderSpec("liam", "RW-2003", "liam", (
        ItemSpec("SHOE-TRAIL-42", "Trail Running Shoes", 1, 12900),
    ), placed_days_ago=58, delivered_days_ago=51),
    OrderSpec("priya", "RW-2004", "priya", (
        ItemSpec("YOGA-MAT", "Yoga Mat", 1, 4500),
        ItemSpec("BANDS-SET", "Resistance Bands Set", 1, 1800),
    ), placed_days_ago=31, delivered_days_ago=27),
    OrderSpec("noah", "RW-2005", "noah", (
        ItemSpec("WATCH-ENGRAVED", "Custom Engraved Watch", 1, 21000, returnable=False),
        ItemSpec("STRAP-LEATHER", "Leather Watch Strap", 1, 2500),
    ), placed_days_ago=11, delivered_days_ago=7),
    OrderSpec("hana", "RW-2006", "hana", (
        ItemSpec("KB-MECH-ANSI", "Mechanical Keyboard (ANSI)", 1, 14900),
        ItemSpec("KEYCAP-SET", "PBT Keycap Set", 1, 3500),
    ), placed_days_ago=9, delivered_days_ago=5),
    # Payment pending and not delivered yet: shows the "not eligible for return" case.
    OrderSpec("mateo", "RW-2007", "mateo", (
        ItemSpec("LAMP-DESK", "LED Desk Lamp", 1, 5500),
    ), placed_days_ago=1, delivered_days_ago=None, payment_status=PaymentStatus.PENDING),
    OrderSpec("emma", "RW-2008", "emma", (
        ItemSpec("BACKPACK-24L", "Everyday Backpack 24L", 1, 8900),
    ), placed_days_ago=15, delivered_days_ago=11),
)

# Created oldest first, so references (RET-1001, ...) ascend with time.
RETURNS: tuple[ReturnSpec, ...] = (
    ReturnSpec("priya", "YOGA-MAT", 1, "45.00",
               "The mat is much thinner than the listing described.",
               11, "approved", "Approved: listing thickness was unclear.", 24),
    ReturnSpec("emma", "BACKPACK-24L", 1, "89.00",
               "The zipper broke the first time I used the backpack.",
               9, "approved", "Approved: probable manufacturing defect.", 20),
    ReturnSpec("noah", "WATCH-ENGRAVED", 1, "210.00",
               "I changed my mind about the gift.",
               6, "rejected", "Custom engraved items are final sale under the store policy.", 4),
    ReturnSpec("hana", "KB-MECH-ANSI", 1, "149.00",
               "I received the ISO layout keyboard but I ordered ANSI.",
               4, "approved", "Approved: wrong layout was shipped.", 32),
    ReturnSpec("sofia", "MUG-SET-4", 1, "38.50",
               "Two of the four mugs arrived cracked. I would like a refund for the whole set.",
               3, "review"),
    ReturnSpec("liam", "SHOE-TRAIL-42", 1, "129.00",
               "They fit fine but I just don't like the color.",
               2, "submitted"),
    ReturnSpec("aarav", "EARBUDS-PRO", 1, "79.99",
               "Left earbud stopped charging after 3 days. The case LED blinks red.",
               1, "submitted"),
)


def _seed_orders(db, seller: User, now) -> dict[str, Order]:
    customers = {
        key: Customer(seller_id=seller.id, name=name, email=email)
        for key, (name, email) in CUSTOMERS.items()
    }
    db.add_all(customers.values())
    db.flush()

    orders: dict[str, Order] = {}
    for spec in ORDERS:
        order = Order(
            seller_id=seller.id,
            customer_id=customers[spec.customer].id,
            order_number=spec.number,
            currency=Currency.USD,
            total_minor=sum(item.unit_price_minor * item.quantity for item in spec.items),
            refunded_minor=0,
            payment_status=spec.payment_status,
            placed_at=now - timedelta(days=spec.placed_days_ago),
            delivered_at=(
                None if spec.delivered_days_ago is None
                else now - timedelta(days=spec.delivered_days_ago)
            ),
        )
        order.items = [
            OrderItem(
                sku=item.sku,
                name=item.name,
                quantity=item.quantity,
                unit_price_minor=item.unit_price_minor,
                returnable=item.returnable,
            )
            for item in spec.items
        ]
        db.add(order)
        orders[spec.key] = order
    db.commit()
    return orders


def _seed_returns(db, seller: User, orders: dict[str, Order], now) -> None:
    for spec in sorted(RETURNS, key=lambda r: -r.submitted_days_ago):
        order = orders[spec.order]
        item = next(i for i in order.items if i.sku == spec.sku)
        submitted = now - timedelta(days=spec.submitted_days_ago)

        payload = CreateReturnRequest.model_validate({
            "orderId": order.id,
            "items": [{"orderItemId": item.id, "quantity": spec.quantity}],
            "customerComment": spec.comment,
            "requestedAmount": spec.amount,
        })
        request = create_return(db, seller.id, payload, now=submitted)
        if spec.outcome == "submitted":
            continue

        workflow.start_review(db, seller.id, request.id, now=submitted + timedelta(hours=3))
        if spec.outcome == "review":
            continue

        decided = submitted + timedelta(hours=spec.decision_hours)
        if spec.outcome == "approved":
            workflow.approve_return(db, seller.id, request.id, spec.note, now=decided)
        else:
            workflow.reject_return(db, seller.id, request.id, spec.note, now=decided)


def main() -> int:
    if get_settings().is_production:
        print("Refusing to seed demo data when APP_ENV=production.")
        return 1

    if not inspect(engine).has_table("users"):
        print("Database tables not found. Run this first:  alembic upgrade head")
        return 1

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == DEMO_EMAIL)) is not None:
            print(f"Demo data already exists ({DEMO_EMAIL}). Nothing changed.")
            print("For a clean slate: delete returnwise.db, run `alembic upgrade head`, seed again.")
            return 0

        provided = os.environ.get("SEED_DEMO_PASSWORD")
        password = provided or secrets.token_urlsafe(12)

        try:
            seller = auth_service.register(
                db,
                RegisterRequest.model_validate(
                    {"email": DEMO_EMAIL, "password": password, "displayName": DEMO_NAME}
                ),
            )
        except ValidationError:
            # Deliberately no details: the error text would repeat the password.
            print("SEED_DEMO_PASSWORD must be 12 to 72 characters.")
            return 1

        now = utcnow()
        try:
            orders = _seed_orders(db, seller, now)
            _seed_returns(db, seller, orders, now)
        except Exception:
            db.rollback()
            print("Seeding failed part-way. Delete returnwise.db, re-run `alembic upgrade head`,")
            print("then seed again.")
            raise

    print(f"Demo seller created: {DEMO_EMAIL}")
    print(f"  orders: {len(ORDERS)}, returns: {len(RETURNS)}")
    if provided:
        print("  password: taken from SEED_DEMO_PASSWORD")
    else:
        print(f"  password (shown once): {password}")
        print("  set SEED_DEMO_PASSWORD to choose your own next time")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())