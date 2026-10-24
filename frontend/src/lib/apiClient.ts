import type {
  AuditEntry,
  DashboardMetrics,
  MoneyString,
  Order,
  PolicyEvaluation,
  ReturnLineItem,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

/* ---------- Configuration ---------- */

/** Backend base URL without a trailing slash. Empty means "no API: use demo data". */
export const API_BASE_URL: string = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export const isApiConfigured = API_BASE_URL !== "";

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 15_000;

const PREFIX = "/api/v1";

/* ---------- Errors ---------- */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Safe, user-facing text for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something unexpected went wrong. Please try again.";
}

function codeForStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "http_error";
}

interface ErrorBody {
  message: string;
  code: string | null;
}

/** Turns the backend's {detail, code} error body into text that is safe to show. */
async function readError(response: Response): Promise<ErrorBody> {
  // Never surface server internals.
  if (response.status >= 500) {
    return { message: "The server ran into a problem. Please try again later.", code: null };
  }

  const fallback = `Request failed (${response.status}).`;
  try {
    const body = (await response.json()) as { detail?: unknown; code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : null;
    const detail = body?.detail;

    if (typeof detail === "string" && detail.trim() !== "") return { message: detail, code };

    if (Array.isArray(detail)) {
      const messages = detail.flatMap((item) => {
        const problem = item as { loc?: unknown; msg?: unknown } | null;
        if (typeof problem?.msg !== "string") return [];
        const field = Array.isArray(problem.loc) ? problem.loc[problem.loc.length - 1] : undefined;
        return [typeof field === "string" && field !== "body" ? `${field}: ${problem.msg}` : problem.msg];
      });
      if (messages.length > 0) return { message: messages.join(" "), code };
    }
    return { message: fallback, code };
  } catch {
    return { message: fallback, code: null };
  }
}

/* ---------- Auth hooks ---------- */

type TokenProvider = () => string | null;

let getAuthToken: TokenProvider = () => null;

/** Registered by the auth layer. Tokens live in memory only, never in localStorage. */
export function setAuthTokenProvider(provider: TokenProvider): void {
  getAuthToken = provider;
}

let onUnauthorized: (() => void) | null = null;

/** Called when an authenticated request gets a 401, so the app can return to the login page. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/* ---------- Core request ---------- */

type QueryValue = string | number | undefined;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Sent as the Idempotency-Key header (refund creation, Phase 5). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Login and register: no token is sent, and a 401 is just a wrong password. */
  public?: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

/**
 * Responses are cast to T without runtime validation, so they are only as trustworthy as
 * the backend. The backend validates its own output with Pydantic.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiError("The API is not configured. Set VITE_API_BASE_URL.", 0, "not_configured");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!options.public) {
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", forwardAbort);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new ApiError("The server took too long to respond.", 0, "timeout");
    if (options.signal?.aborted) throw error; // the caller cancelled on purpose
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, "network_error");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    const error = await readError(response);
    if (response.status === 401 && !options.public) onUnauthorized?.();
    throw new ApiError(error.message, response.status, error.code ?? codeForStatus(response.status));
  }
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("The server returned an unreadable response.", response.status, "invalid_response");
  }
}

/* ---------- Endpoints ---------- */

interface ReadOptions {
  signal?: AbortSignal;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: "bearer";
  /** Lifetime in seconds. */
  expiresIn: number;
}

export interface CreateReturnPayload {
  orderId: string;
  items: ReturnLineItem[];
  customerComment: string;
  requestedAmount: MoneyString;
}

const seg = encodeURIComponent;

/**
 * Only endpoints that exist on the backend are listed. The AI analysis (Phase 4) and refund
 * (Phase 5) endpoints are added when those phases land.
 */
export const api = {
  // Account
  login: (email: string, password: string) =>
    request<TokenResponse>(`${PREFIX}/auth/login`, {
      method: "POST",
      body: { email, password },
      public: true,
    }),
  register: (email: string, password: string, displayName: string) =>
    request<AuthUser>(`${PREFIX}/auth/register`, {
      method: "POST",
      body: { email, password, displayName },
      public: true,
    }),
  me: (opts?: ReadOptions) => request<AuthUser>(`${PREFIX}/auth/me`, opts),

  // Orders
  listOrders: (opts?: ReadOptions) => request<Order[]>(`${PREFIX}/orders`, opts),
  getOrder: (orderId: string, opts?: ReadOptions) =>
    request<Order>(`${PREFIX}/orders/${seg(orderId)}`, opts),

  // Returns
  listReturns: (query?: { status?: ReturnStatus }, opts?: ReadOptions) =>
    request<ReturnRequest[]>(`${PREFIX}/returns`, { query, ...opts }),
  getReturn: (returnId: string, opts?: ReadOptions) =>
    request<ReturnRequest>(`${PREFIX}/returns/${seg(returnId)}`, opts),
  createReturn: (payload: CreateReturnPayload) =>
    request<ReturnRequest>(`${PREFIX}/returns`, { method: "POST", body: payload }),
  getEvaluation: (returnId: string, opts?: ReadOptions) =>
    request<PolicyEvaluation>(`${PREFIX}/returns/${seg(returnId)}/evaluation`, opts),

  // Seller decisions
  startReview: (returnId: string) =>
    request<ReturnRequest>(`${PREFIX}/returns/${seg(returnId)}/start-review`, { method: "POST" }),
  approveReturn: (returnId: string, note: string) =>
    request<ReturnRequest>(`${PREFIX}/returns/${seg(returnId)}/approve`, {
      method: "POST",
      body: { note },
    }),
  rejectReturn: (returnId: string, note: string) =>
    request<ReturnRequest>(`${PREFIX}/returns/${seg(returnId)}/reject`, {
      method: "POST",
      body: { note },
    }),

  // Audit, policy and dashboard
  listAudit: (query?: { returnId?: string; limit?: number }, opts?: ReadOptions) =>
    request<AuditEntry[]>(`${PREFIX}/audit`, { query, ...opts }),
  getPolicy: (opts?: ReadOptions) => request<ReturnPolicy>(`${PREFIX}/policy`, opts),
  updatePolicy: (policy: ReturnPolicy) =>
    request<ReturnPolicy>(`${PREFIX}/policy`, { method: "PUT", body: policy }),
  getMetrics: (opts?: ReadOptions) =>
    request<DashboardMetrics>(`${PREFIX}/dashboard/metrics`, opts),
};