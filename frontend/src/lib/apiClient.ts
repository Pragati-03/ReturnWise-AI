import type {
  AiAnalysis,
  AuditEntry,
  DashboardMetrics,
  MoneyString,
  Order,
  PolicyEvaluation,
  RefundRecord,
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

/** Planned URL prefix. Adjust when the backend routes are finalized. */
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

async function readErrorMessage(response: Response): Promise<string> {
  // Don't surface server internals to the user.
  if (response.status >= 500) return "The server ran into a problem. Please try again later.";

  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown } | null)?.detail;

    if (typeof detail === "string" && detail.trim() !== "") return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => (item as { msg?: unknown } | null)?.msg)
        .filter((msg): msg is string => typeof msg === "string");
      if (messages.length > 0) return messages.join(" ");
    }
  } catch {
    // Non-JSON error body: fall through to the generic message.
  }
  return `Request failed (${response.status}).`;
}

/* ---------- Auth hook ---------- */

type TokenProvider = () => string | null;

let getAuthToken: TokenProvider = () => null;

/**
 * Registered by the auth layer once the backend has seller login (Phase 3).
 * Keep tokens in memory; don't store them in localStorage.
 */
export function setAuthTokenProvider(provider: TokenProvider): void {
  getAuthToken = provider;
}

/* ---------- Core request ---------- */

type QueryValue = string | number | undefined;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Sent as the Idempotency-Key header (used for refund creation). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
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
 * Responses are cast to T without runtime validation, so they are only as
 * trustworthy as the backend. The backend validates its own output with Pydantic.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiError("The API is not configured. Set VITE_API_BASE_URL.", 0, "not_configured");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
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
    throw new ApiError(await readErrorMessage(response), response.status, codeForStatus(response.status));
  }
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("The server returned an unreadable response.", response.status, "invalid_response");
  }
}

/* ---------- Planned endpoints ---------- */

/**
 * The route shapes below are the PLANNED contract. The backend does not exist
 * yet, so adjust paths and payloads to the real schemas in Phase 3.
 */

interface ReadOptions {
  signal?: AbortSignal;
}

export interface CreateReturnPayload {
  orderId: string;
  items: ReturnLineItem[];
  customerComment: string;
  requestedAmount: MoneyString;
}

const seg = encodeURIComponent;

export const api = {
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

  // Per-return details
  getEvaluation: (returnId: string, opts?: ReadOptions) =>
    request<PolicyEvaluation>(`${PREFIX}/returns/${seg(returnId)}/evaluation`, opts),
  getAnalysis: (returnId: string, opts?: ReadOptions) =>
    request<AiAnalysis>(`${PREFIX}/returns/${seg(returnId)}/analysis`, opts),
  getRefund: (returnId: string, opts?: ReadOptions) =>
    request<RefundRecord>(`${PREFIX}/returns/${seg(returnId)}/refund`, opts),

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
  /**
   * Reuse the same idempotencyKey when retrying one attempt (for example after a
   * timeout) so the backend can never issue the refund twice.
   */
  initiateRefund: (returnId: string, idempotencyKey: string = crypto.randomUUID()) =>
    request<RefundRecord>(`${PREFIX}/returns/${seg(returnId)}/refund`, {
      method: "POST",
      idempotencyKey,
    }),

  // Audit, policy and dashboard
  listAudit: (query?: { returnId?: string }, opts?: ReadOptions) =>
    request<AuditEntry[]>(`${PREFIX}/audit`, { query, ...opts }),
  getPolicy: (opts?: ReadOptions) => request<ReturnPolicy>(`${PREFIX}/policy`, opts),
  updatePolicy: (policy: ReturnPolicy) =>
    request<ReturnPolicy>(`${PREFIX}/policy`, { method: "PUT", body: policy }),
  getMetrics: (opts?: ReadOptions) => request<DashboardMetrics>(`${PREFIX}/dashboard/metrics`, opts),
};