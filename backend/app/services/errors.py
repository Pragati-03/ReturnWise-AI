from __future__ import annotations


class DomainError(Exception):
    """Base class for expected business errors.

    `status_code` is the HTTP status the API layer should use. Messages are shown to
    users, so they must never include secrets, stack traces or provider response bodies.
    """

    status_code: int = 400
    code: str = "error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code

    def to_dict(self) -> dict[str, str]:
        # "detail" matches what the frontend apiClient already reads from error bodies.
        return {"detail": self.message, "code": self.code}


class InvalidInputError(DomainError):
    status_code = 422
    code = "invalid_input"


class AuthenticationError(DomainError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(DomainError):
    status_code = 403
    code = "forbidden"


class NotFoundError(DomainError):
    """Also used when a resource belongs to another seller, so its existence isn't revealed."""

    status_code = 404
    code = "not_found"


class ConflictError(DomainError):
    status_code = 409
    code = "conflict"


class InvalidTransitionError(ConflictError):
    code = "invalid_transition"

    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(
            f'A request that is "{_readable(from_status)}" cannot be moved to '
            f'"{_readable(to_status)}".'
        )
        self.from_status = from_status
        self.to_status = to_status


class PolicyViolationError(DomainError):
    """The return policy forbids the requested action (for example approving an ineligible request)."""

    status_code = 422
    code = "policy_violation"


class ExternalServiceError(DomainError):
    """A provider such as PayPal failed. Keep the message generic."""

    status_code = 502
    code = "external_service_error"


def _readable(status: str) -> str:
    return status.replace("_", " ")