# ReturnWise backend

FastAPI service for ReturnWise: AI-assisted returns and refunds management for e-commerce
sellers. This is the Phase 2 backend (orders, return requests, deterministic policy engine,
state machine, audit log, seller accounts). The Gemini AI analysis and PayPal Sandbox refund
flow are planned for later phases and are **not implemented yet**.

Everything here runs locally at no cost: Python, SQLite, FastAPI. No account, API key or
payment is needed to run or test it.

## Requirements

- Python 3.11 or newer
- Nothing else. SQLite ships with Python.

## Setup

From the `backend/` folder.

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

macOS or Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Then generate a secret and paste it after `JWT_SECRET=` in `.env` (no quotes):

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`.env` is ignored by Git. Never commit it. Leave the Gemini and PayPal values empty for now.

> **Tip (Windows):** keep the project outside OneDrive or another synced folder. Syncing can
> lock the SQLite file and its `-wal` and `-shm` companions, and it slows `pip` and `npm`.

## Configuration

All settings come from environment variables or `backend/.env`. Real environment variables
win over `.env`.

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `development` | `development`, `test` or `production`. Production requires a strong `JWT_SECRET`, turns on HSTS and disables `/docs`. |
| `LOG_LEVEL` | `INFO` | Standard Python level names. |
| `DATABASE_URL` | `sqlite:///./returnwise.db` | Relative SQLite paths resolve against `backend/`. |
| `JWT_SECRET` | `change-me` | At least 32 random characters in production. |
| `JWT_EXPIRE_MINUTES` | `60` | 1 to 1440. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated explicit origins. Wildcards are rejected. |
| `GEMINI_API_KEY` | empty | Phase 4. Free-tier key only. Empty means the rule-based fallback. |
| `GEMINI_TIMEOUT_SECONDS` | `10` | |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | empty | Phase 5. Sandbox credentials only. |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` | Must be a PayPal **sandbox** host over HTTPS. The live host is refused at startup. |

## Database and migrations

The schema is managed by Alembic (`migrations/`). Do not rely on `create_all` outside tests.

```bash
alembic upgrade head                              # create or update the database
alembic check                                     # confirm migrations match the models
alembic revision --autogenerate -m "describe it"  # after changing a model
alembic downgrade base                            # remove everything (local only)
```

Alembic logs to the error stream, so PowerShell shows its normal output in red.

## Demo data

```bash
python -m app.db.seed
```

Creates a demo seller (`demo@example.com`), 8 orders and 7 return requests built through the
real services, so policy results, audit entries and statuses are genuine. A random password
is printed once. To choose your own, set `SEED_DEMO_PASSWORD` (12 to 72 characters) first.

The seed never creates refunded money, PayPal IDs or capture IDs. Those only come from real
sandbox activity. To start over, stop the server, delete `returnwise.db` (and its `-wal` and
`-shm` files), run `alembic upgrade head`, then seed again.

## Run

```bash
uvicorn app.main:app --reload
```

- API: <http://localhost:8000/api/v1>
- Interactive docs (development only): <http://localhost:8000/docs>
- Health check: <http://localhost:8000/api/v1/health>

## Test

```bash
python -m pytest -q                  # everything
python -m pytest tests/test_auth.py  # one file
```

Tests use an in-memory SQLite database per test, test-only settings and fast password
hashing. They never read your `.env`, touch `returnwise.db` or call any external service.

## API at a glance

Authentication is `Authorization: Bearer <token>` from `POST /auth/login`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create a seller account |
| POST | `/auth/login` | Get an access token |
| GET | `/auth/me` | Current seller |
| GET | `/orders`, `/orders/{id}` | The seller's orders |
| GET | `/returns` (`?status=`), `/returns/{id}` | Return requests |
| POST | `/returns` | File a return request |
| GET | `/returns/{id}/evaluation` | Stored policy result |
| POST | `/returns/{id}/start-review` | submitted to under review |
| POST | `/returns/{id}/approve` | under review to approved (eligible requests only) |
| POST | `/returns/{id}/reject` | under review to rejected (note required) |
| GET, PUT | `/policy` | Return policy |
| GET | `/audit` | Audit log (`returnId`, `eventType`, `actorType`, `limit`) |
| GET | `/dashboard/metrics` | Dashboard numbers |
| GET | `/health` | Liveness and database check |

Conventions:

- JSON uses camelCase. Money is always a **decimal string** such as `"49.99"`. JSON numbers
  are rejected for money. Internally amounts are integer cents.
- Errors are `{"detail": ..., "code": ...}`. Validation errors list `loc` and `msg` only and
  never echo submitted values.
- IDs are opaque strings such as `ret_3f9a...`. Another seller's resource returns the same
  404 as a missing one.

## Security design

- **Ownership:** every query filters by the signed-in seller. Request bodies and query strings
  cannot name another seller, and unknown fields are rejected.
- **Passwords:** bcrypt, 72-byte limit enforced, login timing equalized for unknown accounts.
- **Tokens:** HS256 JWTs with a fixed algorithm allow-list, required claims and no personal
  data. The account is re-checked on every request, so disabling it takes effect immediately.
- **Approval rules:** approval requires a stored, passing policy result. Eligibility is
  decided by deterministic code and will never be overridden by AI.
- **Audit log:** written in the same transaction as the action it records, with fixed
  description templates and no customer text or contact details.
- **Concurrency:** optimistic version checks mean two simultaneous decisions cannot both win.
  The loser gets a 409.
- **HTTP:** security headers on API responses, request bodies capped at 128 KiB, chunked
  uploads refused, CORS limited to the listed origins, docs disabled in production.
- **PayPal:** configuration refuses any host except the PayPal sandbox.

## Project layout

```
backend/
  app/
    main.py            app factory, middleware, health check
    api/               routes and shared dependencies (thin: no business rules)
    core/              config, money helpers, security
    db/                engine and session, base model, seed script
    models/            SQLAlchemy models
    schemas/           Pydantic request and response schemas
    services/          business rules: policy engine, workflow, audit, auth, settings, dashboard
  migrations/          Alembic environment and versions
  tests/               pytest suite
```

## Known limitations

- **Not built yet:** AI case analysis (Phase 4) and PayPal Sandbox refunds and webhooks
  (Phase 5). There are no `/analysis` or `/refund` endpoints.
- **No rate limiting or lockout** on login, and registration is open. Fine for local
  development, but add limits before any public deployment. There are no refresh tokens, and
  a token stays valid until it expires unless the account is disabled.
- **Policy results are evaluated when a return is submitted.** Changing the policy affects
  new returns only. Checks that must be fresh (payment still captured, balance still
  available) will be repeated by the refund service.
- **SQLite** allows one writer at a time. A simultaneous writer receives a 409. PostgreSQL
  has not been tested. To try it, add `psycopg[binary]`, set `DATABASE_URL`, and expect to
  add row locking for the refund flow.
- **Audit log immutability** is enforced by the ORM only. Raw SQL can bypass it. Revoking
  `UPDATE` and `DELETE` on that table is the stronger fix on PostgreSQL.
- **Unexpected 500 responses** come from the framework's outermost layer, so they skip the
  security-header and CORS middleware. Framework 404 and 405 responses have `detail` but no
  `code`.