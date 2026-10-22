from __future__ import annotations

import os
import sys
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from pathlib import Path

# Make `import app` work however pytest is launched.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Test settings. These MUST be set before any app module is imported. Environment variables
# beat backend/.env, so a developer's real keys and database can never leak into tests.
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": "sqlite://",
        "JWT_SECRET": "test-only-secret-" + "x" * 40,
        "GEMINI_API_KEY": "",
        "PAYPAL_CLIENT_ID": "",
        "PAYPAL_CLIENT_SECRET": "",
        "PAYPAL_WEBHOOK_ID": "",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

import app.core.security as security  # noqa: E402
import app.models  # noqa: E402,F401  (registers every table)
from app.db.base import Base, utcnow  # noqa: E402
from app.db.session import create_db_engine, get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Customer, Order, OrderItem, User  # noqa: E402
from app.models.enums import Currency, PaymentStatus  # noqa: E402
from app.schemas.auth import RegisterRequest  # noqa: E402
from app.schemas.return_request import CreateReturnRequest  # noqa: E402
from app.services import auth as auth_service  # noqa: E402

security.BCRYPT_ROUNDS = 4  # fast password hashing for tests only

API = "/api/v1"
TEST_PASSWORD = "correct horse battery"

# (sku, name, quantity, unit price in cents, returnable)
DEFAULT_ITEMS = (
    ("EARBUDS", "Earbuds", 1, 7999, True),
    ("CABLE", "Cable", 2, 1250, True),
)


@pytest.fixture
def engine() -> Iterator[Engine]:
    test_engine = create_db_engine("sqlite://")  # fresh in-memory database per test
    Base.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def db(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> TestClient:
    application = create_app()

    def override_db() -> Iterator[Session]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    application.dependency_overrides[get_db] = override_db
    return TestClient(application)


@pytest.fixture
def make_seller(db: Session) -> Callable[..., User]:
    def _make(
        email: str = "asha@example.com", name: str = "Asha", password: str = TEST_PASSWORD
    ) -> User:
        return auth_service.register(
            db,
            RegisterRequest.model_validate(
                {"email": email, "password": password, "displayName": name}
            ),
        )

    return _make


@pytest.fixture
def login_headers(client: TestClient) -> Callable[..., dict[str, str]]:
    def _login(email: str = "asha@example.com", password: str = TEST_PASSWORD) -> dict[str, str]:
        response = client.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['accessToken']}"}

    return _login


@pytest.fixture
def make_order(db: Session) -> Callable[..., Order]:
    def _make(
        seller: User,
        *,
        number: str = "RW-2001",
        customer_email: str = "aarav@example.com",
        items: tuple[tuple[str, str, int, int, bool], ...] = DEFAULT_ITEMS,
        payment_status: PaymentStatus = PaymentStatus.CAPTURED,
        delivered_days_ago: int | None = 9,
        refunded_minor: int = 0,
        now: datetime | None = None,
    ) -> Order:
        moment = now or utcnow()
        customer = db.scalar(
            select(Customer).where(
                Customer.seller_id == seller.id, Customer.email == customer_email
            )
        )
        if customer is None:
            customer = Customer(seller_id=seller.id, name="Aarav", email=customer_email)
            db.add(customer)
            db.flush()

        order = Order(
            seller_id=seller.id,
            customer_id=customer.id,
            order_number=number,
            currency=Currency.USD,
            total_minor=sum(qty * price for _sku, _name, qty, price, _ret in items),
            refunded_minor=refunded_minor,
            payment_status=payment_status,
            placed_at=moment - timedelta(days=(delivered_days_ago or 0) + 4),
            delivered_at=(
                None if delivered_days_ago is None else moment - timedelta(days=delivered_days_ago)
            ),
        )
        order.items = [
            OrderItem(
                sku=sku, name=name, quantity=qty, unit_price_minor=price, returnable=returnable
            )
            for sku, name, qty, price, returnable in items
        ]
        db.add(order)
        db.commit()
        return order

    return _make


@pytest.fixture
def make_return_payload() -> Callable[..., CreateReturnRequest]:
    def _make(
        order: Order,
        sku: str = "EARBUDS",
        quantity: int = 1,
        amount: str = "79.99",
        comment: str = "It stopped working.",
    ) -> CreateReturnRequest:
        item = next(i for i in order.items if i.sku == sku)
        return CreateReturnRequest.model_validate(
            {
                "orderId": order.id,
                "items": [{"orderItemId": item.id, "quantity": quantity}],
                "customerComment": comment,
                "requestedAmount": amount,
            }
        )

    return _make