from __future__ import annotations

import itertools
from collections.abc import Callable
from datetime import timedelta

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base, utcnow
from app.db.session import create_db_engine
from app.models import (
    AuditLog,
    Customer,
    Order,
    OrderItem,
    PolicyEvaluation,
    Refund,
    ReturnRequest,
    User,
)
from app.models.enums import AuditActorType, Currency, PaymentStatus, ReturnStatus
from app.schemas.auth import RegisterRequest
from app.schemas.return_request import CreateReturnRequest
from app.services import auth as auth_service
from app.services import returns as ret_svc
from app.services import workflow
from app.services.errors import (
    ConflictError,
    InvalidInputError,
    InvalidTransitionError,
    NotFoundError,
    PolicyViolationError,
)

S = ReturnStatus

ALLOWED_PAIRS = {
    (S.SUBMITTED, S.UNDER_REVIEW),
    (S.UNDER_REVIEW, S.APPROVED),
    (S.UNDER_REVIEW, S.REJECTED),
    (S.APPROVED, S.REFUND_PENDING),
    (S.REFUND_PENDING, S.REFUNDED),
    (S.REFUND_PENDING, S.REFUND_FAILED),
    (S.REFUND_FAILED, S.REFUND_PENDING),
}


@pytest.fixture
def seller(make_seller: Callable[..., User]) -> User:
    return make_seller()


@pytest.fixture
def order(make_order: Callable[..., Order], seller: User) -> Order:
    return make_order(seller)


@pytest.fixture
def ineligible_order(make_order: Callable[..., Order], seller: User) -> Order:
    """Final-sale item delivered 51 days ago: fails the window and returnable checks."""
    return make_order(
        seller,
        number="RW-2003",
        items=(("WATCH", "Engraved Watch", 1, 21_000, False),),
        delivered_days_ago=51,
    )


def audit_rows(db: Session, return_id: str) -> list[AuditLog]:
    return list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.return_id == return_id)
            .order_by(AuditLog.occurred_at, AuditLog.id)
        )
    )


def event_types(db: Session, return_id: str) -> list[str]:
    return [row.event_type.value for row in audit_rows(db, return_id)]


def status_of(db: Session, seller: User, return_id: str) -> ReturnStatus:
    return ret_svc.get_return(db, seller.id, return_id).status


class TestTransitionTable:
    @pytest.mark.parametrize(("source", "target"), list(itertools.product(S, S)))
    def test_every_pair_is_decided_by_the_table(self, source: S, target: S) -> None:
        assert workflow.can_transition(source, target) is ((source, target) in ALLOWED_PAIRS)

    def test_closed_states_have_no_exits(self) -> None:
        assert workflow.ALLOWED_TRANSITIONS[S.REJECTED] == frozenset()
        assert workflow.ALLOWED_TRANSITIONS[S.REFUNDED] == frozenset()

    def test_every_status_has_an_entry(self) -> None:
        assert set(workflow.ALLOWED_TRANSITIONS) == set(S)

    def test_ensure_transition_raises_a_readable_conflict(self) -> None:
        with pytest.raises(InvalidTransitionError) as caught:
            workflow.ensure_transition(S.SUBMITTED, S.APPROVED)
        error = caught.value
        assert error.status_code == 409
        assert error.code == "invalid_transition"
        assert error.message == 'A request that is "submitted" cannot be moved to "approved".'

    def test_ensure_transition_allows_valid_moves(self) -> None:
        workflow.ensure_transition(S.SUBMITTED, S.UNDER_REVIEW)  # does not raise


class TestCreateReturn:
    def test_stores_a_submitted_request_with_a_reference(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order, amount="79.9"))
        assert request.reference == "RET-1001"
        assert request.status == S.SUBMITTED
        assert request.requested_minor == 7990
        assert request.seller_id == seller.id
        assert request.customer_comment == "It stopped working."

    def test_stores_the_policy_result_and_audit_entries(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))

        evaluation = ret_svc.latest_evaluation(db, seller.id, request.id)
        assert evaluation is not None
        assert evaluation.eligible is True
        assert len(evaluation.checks) == 6

        rows = audit_rows(db, request.id)
        assert [(r.event_type.value, r.actor_type) for r in rows] == [
            ("return_submitted", AuditActorType.SELLER),
            ("policy_evaluated", AuditActorType.SYSTEM),
        ]
        assert rows[0].actor_id == seller.id
        assert rows[1].actor_id is None
        assert rows[0].to_status == S.SUBMITTED

    def test_references_count_up_per_seller(
        self,
        db: Session,
        make_seller: Callable[..., User],
        make_order: Callable[..., Order],
        make_return_payload: Callable[..., CreateReturnRequest],
    ) -> None:
        first = make_seller("asha@example.com", "Asha")
        second = make_seller("ben@example.com", "Ben")
        order_one = make_order(first)
        order_two = make_order(second, number="RW-9001", customer_email="bela@example.com")

        a = ret_svc.create_return(db, first.id, make_return_payload(order_one))
        b = ret_svc.create_return(db, first.id, make_return_payload(order_one, sku="CABLE", amount="12.50"))
        c = ret_svc.create_return(db, second.id, make_return_payload(order_two))

        assert (a.reference, b.reference, c.reference) == ("RET-1001", "RET-1002", "RET-1001")

    def test_a_policy_failing_request_is_stored_with_its_reasons(
        self, db: Session, seller: User, ineligible_order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(
            db, seller.id, make_return_payload(ineligible_order, sku="WATCH", amount="210.00")
        )
        assert request.status == S.SUBMITTED

        evaluation = ret_svc.latest_evaluation(db, seller.id, request.id)
        assert evaluation is not None
        assert evaluation.eligible is False
        failed = {check["code"] for check in evaluation.checks if not check["passed"]}
        assert failed == {"RETURN_WINDOW_EXPIRED", "ITEM_NOT_RETURNABLE"}

    def test_a_second_open_request_for_the_same_item_is_refused(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        ret_svc.create_return(db, seller.id, make_return_payload(order))
        with pytest.raises(ConflictError) as caught:
            ret_svc.create_return(db, seller.id, make_return_payload(order))
        assert caught.value.status_code == 409
        assert caught.value.message == "An open return request already covers: Earbuds."

    def test_a_refused_request_leaves_nothing_behind(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        ret_svc.create_return(db, seller.id, make_return_payload(order))
        returns_before = db.scalar(select(func.count()).select_from(ReturnRequest))
        audit_before = db.scalar(select(func.count()).select_from(AuditLog))
        evaluations_before = db.scalar(select(func.count()).select_from(PolicyEvaluation))

        with pytest.raises(ConflictError):
            ret_svc.create_return(db, seller.id, make_return_payload(order))

        assert db.scalar(select(func.count()).select_from(ReturnRequest)) == returns_before
        assert db.scalar(select(func.count()).select_from(AuditLog)) == audit_before
        assert db.scalar(select(func.count()).select_from(PolicyEvaluation)) == evaluations_before

    def test_a_rejected_request_frees_its_item(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        first = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, first.id)
        workflow.reject_return(db, seller.id, first.id, "Not covered")

        again = ret_svc.create_return(db, seller.id, make_return_payload(order))
        assert again.reference == "RET-1002"
        assert again.status == S.SUBMITTED

    def test_items_from_another_order_are_refused(
        self,
        db: Session,
        seller: User,
        order: Order,
        ineligible_order: Order,
        make_return_payload: Callable[..., CreateReturnRequest],
    ) -> None:
        payload = make_return_payload(order).model_copy(update={"order_id": ineligible_order.id})
        with pytest.raises(InvalidInputError) as caught:
            ret_svc.create_return(db, seller.id, payload)
        assert caught.value.message == "One or more items do not belong to this order."

    def test_the_policy_defaults_are_created_once(self, db: Session, seller: User) -> None:
        first = ret_svc.get_or_create_policy(db, seller.id)
        second = ret_svc.get_or_create_policy(db, seller.id)
        assert first.id == second.id
        assert first.return_window_days == 30
        assert first.manual_review_threshold_minor == 15_000


class TestOwnership:
    def test_another_seller_gets_not_found_everywhere(
        self,
        db: Session,
        make_seller: Callable[..., User],
        make_order: Callable[..., Order],
        make_return_payload: Callable[..., CreateReturnRequest],
    ) -> None:
        owner = make_seller("asha@example.com", "Asha")
        outsider = make_seller("ben@example.com", "Ben")
        order = make_order(owner)
        request = ret_svc.create_return(db, owner.id, make_return_payload(order))

        with pytest.raises(NotFoundError):
            ret_svc.create_return(db, outsider.id, make_return_payload(order))
        with pytest.raises(NotFoundError):
            ret_svc.get_return(db, outsider.id, request.id)
        with pytest.raises(NotFoundError):
            workflow.start_review(db, outsider.id, request.id)
        with pytest.raises(NotFoundError):
            workflow.approve_return(db, outsider.id, request.id, "")
        with pytest.raises(NotFoundError):
            workflow.reject_return(db, outsider.id, request.id, "no")

        assert ret_svc.list_returns(db, outsider.id) == []
        assert status_of(db, owner, request.id) == S.SUBMITTED  # untouched

    def test_unknown_ids_are_not_found(self, db: Session, seller: User) -> None:
        with pytest.raises(NotFoundError):
            ret_svc.get_return(db, seller.id, "ret_doesnotexist")

    def test_lists_can_be_filtered_by_status(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        first = ret_svc.create_return(db, seller.id, make_return_payload(order))
        ret_svc.create_return(db, seller.id, make_return_payload(order, sku="CABLE", amount="12.50"))
        workflow.start_review(db, seller.id, first.id)

        assert len(ret_svc.list_returns(db, seller.id)) == 2
        assert [r.id for r in ret_svc.list_returns(db, seller.id, S.UNDER_REVIEW)] == [first.id]
        assert ret_svc.list_returns(db, seller.id, S.APPROVED) == []


class TestStartReview:
    def test_moves_to_under_review_and_is_audited(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)

        assert status_of(db, seller, request.id) == S.UNDER_REVIEW
        entry = audit_rows(db, request.id)[-1]
        assert entry.event_type.value == "review_started"
        assert (entry.from_status, entry.to_status) == (S.SUBMITTED, S.UNDER_REVIEW)
        assert entry.actor_type == AuditActorType.SELLER
        assert entry.actor_id == seller.id

    def test_cannot_start_twice(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        with pytest.raises(InvalidTransitionError):
            workflow.start_review(db, seller.id, request.id)


class TestApprove:
    def test_cannot_skip_the_review_step(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        with pytest.raises(InvalidTransitionError) as caught:
            workflow.approve_return(db, seller.id, request.id, "")
        assert caught.value.message == 'A request that is "submitted" cannot be moved to "approved".'
        assert status_of(db, seller, request.id) == S.SUBMITTED

    def test_an_ineligible_request_cannot_be_approved(
        self, db: Session, seller: User, ineligible_order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(
            db, seller.id, make_return_payload(ineligible_order, sku="WATCH", amount="210.00")
        )
        workflow.start_review(db, seller.id, request.id)

        with pytest.raises(PolicyViolationError) as caught:
            workflow.approve_return(db, seller.id, request.id, "approve anyway")
        assert caught.value.status_code == 422
        assert caught.value.message == "This request failed the policy checks and cannot be approved."
        assert status_of(db, seller, request.id) == S.UNDER_REVIEW
        assert "return_approved" not in event_types(db, request.id)

    def test_approval_needs_a_stored_policy_result(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        db.execute(delete(PolicyEvaluation))
        db.commit()

        with pytest.raises(PolicyViolationError, match="No policy result"):
            workflow.approve_return(db, seller.id, request.id, "")
        assert status_of(db, seller, request.id) == S.UNDER_REVIEW

    def test_approves_an_eligible_request_with_a_trimmed_note(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        t0 = utcnow()
        request = ret_svc.create_return(db, seller.id, make_return_payload(order), now=t0)
        workflow.start_review(db, seller.id, request.id, now=t0 + timedelta(hours=1))
        approved = workflow.approve_return(
            db, seller.id, request.id, "  Looks good  ", now=t0 + timedelta(hours=2)
        )

        assert approved.status == S.APPROVED
        assert approved.decision_note == "Looks good"
        assert approved.decided_at == t0 + timedelta(hours=2)
        assert event_types(db, request.id) == [
            "return_submitted",
            "policy_evaluated",
            "review_started",
            "return_approved",
        ]

    @pytest.mark.parametrize("note", ["", "   "])
    def test_a_blank_note_is_stored_as_none(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest], note: str
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        assert workflow.approve_return(db, seller.id, request.id, note).decision_note is None

    def test_an_overlong_note_is_refused(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        with pytest.raises(InvalidInputError):
            workflow.approve_return(db, seller.id, request.id, "x" * 501)
        assert status_of(db, seller, request.id) == S.UNDER_REVIEW

    def test_approving_never_moves_money(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        workflow.approve_return(db, seller.id, request.id, "")

        refreshed = db.get(Order, order.id)
        assert refreshed is not None
        assert refreshed.refunded_minor == 0
        assert refreshed.payment_status == PaymentStatus.CAPTURED
        assert db.scalar(select(func.count()).select_from(Refund)) == 0

    def test_cannot_approve_twice(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        workflow.approve_return(db, seller.id, request.id, "")
        with pytest.raises(InvalidTransitionError):
            workflow.approve_return(db, seller.id, request.id, "")
        assert event_types(db, request.id).count("return_approved") == 1


class TestReject:
    def test_cannot_skip_the_review_step(
        self, db: Session, seller: User, ineligible_order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(
            db, seller.id, make_return_payload(ineligible_order, sku="WATCH", amount="210.00")
        )
        with pytest.raises(InvalidTransitionError):
            workflow.reject_return(db, seller.id, request.id, "Final sale")
        assert status_of(db, seller, request.id) == S.SUBMITTED

    @pytest.mark.parametrize("note", ["", "   "])
    def test_a_note_is_required(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest], note: str
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        with pytest.raises(InvalidInputError) as caught:
            workflow.reject_return(db, seller.id, request.id, note)
        assert caught.value.message == "A note is required when rejecting a return."
        assert status_of(db, seller, request.id) == S.UNDER_REVIEW

    def test_an_overlong_note_is_refused(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        with pytest.raises(InvalidInputError):
            workflow.reject_return(db, seller.id, request.id, "x" * 501)

    def test_an_ineligible_request_can_be_rejected(
        self, db: Session, seller: User, ineligible_order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(
            db, seller.id, make_return_payload(ineligible_order, sku="WATCH", amount="210.00")
        )
        workflow.start_review(db, seller.id, request.id)
        rejected = workflow.reject_return(db, seller.id, request.id, "  Final sale item  ")

        assert rejected.status == S.REJECTED
        assert rejected.decision_note == "Final sale item"
        assert rejected.decided_at is not None
        assert event_types(db, request.id)[-1] == "return_rejected"

    def test_closed_requests_cannot_be_reopened_or_decided_again(
        self, db: Session, seller: User, order: Order, make_return_payload: Callable[..., CreateReturnRequest]
    ) -> None:
        request = ret_svc.create_return(db, seller.id, make_return_payload(order))
        workflow.start_review(db, seller.id, request.id)
        workflow.reject_return(db, seller.id, request.id, "No")

        with pytest.raises(InvalidTransitionError):
            workflow.reject_return(db, seller.id, request.id, "Again")
        with pytest.raises(InvalidTransitionError):
            workflow.start_review(db, seller.id, request.id)
        with pytest.raises(InvalidTransitionError):
            workflow.approve_return(db, seller.id, request.id, "")
        assert status_of(db, seller, request.id) == S.REJECTED


class TestConcurrentDecisions:
    def test_two_simultaneous_decisions_cannot_both_win(self, tmp_path) -> None:
        # A file database, so two sessions really are two separate connections.
        engine = create_db_engine("sqlite:///" + (tmp_path / "concurrent.db").as_posix())
        Base.metadata.create_all(engine)
        Session_ = sessionmaker(bind=engine, expire_on_commit=False)
        a, b = Session_(), Session_()
        try:
            seller = auth_service.register(
                a,
                RegisterRequest.model_validate(
                    {"email": "asha@example.com", "password": "correct horse battery", "displayName": "Asha"}
                ),
            )
            customer = Customer(seller_id=seller.id, name="Aarav", email="aarav@example.com")
            a.add(customer)
            a.flush()
            now = utcnow()
            order = Order(
                seller_id=seller.id,
                customer_id=customer.id,
                order_number="RW-1",
                currency=Currency.USD,
                total_minor=7999,
                refunded_minor=0,
                payment_status=PaymentStatus.CAPTURED,
                placed_at=now - timedelta(days=13),
                delivered_at=now - timedelta(days=9),
            )
            order.items = [OrderItem(sku="EARBUDS", name="Earbuds", quantity=1, unit_price_minor=7999)]
            a.add(order)
            a.commit()

            payload = CreateReturnRequest.model_validate(
                {
                    "orderId": order.id,
                    "items": [{"orderItemId": order.items[0].id, "quantity": 1}],
                    "customerComment": "Broken",
                    "requestedAmount": "79.99",
                }
            )
            request = ret_svc.create_return(a, seller.id, payload)
            workflow.start_review(a, seller.id, request.id)

            ret_svc.get_return(b, seller.id, request.id)  # session b now holds an old snapshot
            workflow.approve_return(a, seller.id, request.id, "")  # session a decides first

            with pytest.raises(ConflictError) as caught:
                workflow.reject_return(b, seller.id, request.id, "too late")
            assert caught.value.code == "conflict"

            fresh = Session_()
            try:
                assert ret_svc.get_return(fresh, seller.id, request.id).status == S.APPROVED
            finally:
                fresh.close()
        finally:
            a.close()
            b.close()
            engine.dispose()