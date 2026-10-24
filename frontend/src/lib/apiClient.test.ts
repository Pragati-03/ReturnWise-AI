import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ReturnPolicy } from "@/types";

type Client = typeof import("./apiClient");
type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const BASE = "http://api.test";

let fetchMock: Mock<FetchFn>;

/** A fresh copy of the client: the base URL is read from the environment when it loads. */
async function loadClient(base: string = BASE): Promise<Client> {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", base);
  return import("./apiClient");
}

/** A minimal fake of a fetch Response. */
function reply(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as Response;
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the request to fail, but it succeeded");
}

/** A fetch that never answers, but rejects like the real one when its signal aborts. */
function hangingFetch(): FetchFn {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail);
    });
}

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("configuration", () => {
  it("strips trailing slashes from the base URL", async () => {
    const client = await loadClient("http://api.test///");
    expect(client.API_BASE_URL).toBe("http://api.test");
    expect(client.isApiConfigured).toBe(true);
  });

  it("is unconfigured when the URL is empty, and requests fail without calling fetch", async () => {
    const client = await loadClient("");
    expect(client.isApiConfigured).toBe(false);
    await expect(client.api.listOrders()).rejects.toMatchObject({ code: "not_configured", status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("building requests", () => {
  it("builds the URL and sends JSON headers, with no token by default", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(200, []));

    await client.api.listOrders();

    const { url, init, headers } = lastCall();
    expect(url).toBe("http://api.test/api/v1/orders");
    expect(init.method).toBe("GET");
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sends the bearer token when the provider has one", async () => {
    const client = await loadClient();
    client.setAuthTokenProvider(() => "tok-1");
    fetchMock.mockResolvedValue(reply(200, []));

    await client.api.listOrders();
    expect(lastCall().headers.Authorization).toBe("Bearer tok-1");

    client.setAuthTokenProvider(() => null);
    await client.api.listOrders();
    expect(lastCall().headers.Authorization).toBeUndefined();
  });

  it("never sends the token on login or register", async () => {
    const client = await loadClient();
    client.setAuthTokenProvider(() => "tok-1");
    fetchMock.mockResolvedValue(reply(200, {}));

    await client.api.login("asha@example.com", "correct horse battery");
    expect(lastCall().headers.Authorization).toBeUndefined();
    expect(lastCall().url).toBe("http://api.test/api/v1/auth/login");

    await client.api.register("asha@example.com", "correct horse battery", "Asha");
    expect(lastCall().headers.Authorization).toBeUndefined();
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      email: "asha@example.com",
      password: "correct horse battery",
      displayName: "Asha",
    });
  });

  it("builds query strings and leaves out missing values", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValue(reply(200, []));

    await client.api.listReturns({ status: "approved" });
    expect(lastCall().url).toBe("http://api.test/api/v1/returns?status=approved");

    await client.api.listReturns();
    expect(lastCall().url).toBe("http://api.test/api/v1/returns");

    await client.api.listAudit({ returnId: "ret_a", limit: 50 });
    expect(lastCall().url).toBe("http://api.test/api/v1/audit?returnId=ret_a&limit=50");

    await client.api.listAudit({ limit: 500 });
    expect(lastCall().url).toBe("http://api.test/api/v1/audit?limit=500");
  });

  it("encodes identifiers placed in the path", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValue(reply(200, {}));

    await client.api.getReturn("a/b c");
    expect(lastCall().url).toBe("http://api.test/api/v1/returns/a%2Fb%20c");
  });

  it("sends decisions as JSON POSTs with the note", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValue(reply(200, {}));

    await client.api.approveReturn("ret_1", "Looks good");
    expect(lastCall().url).toBe("http://api.test/api/v1/returns/ret_1/approve");
    expect(lastCall().init.method).toBe("POST");
    expect(lastCall().headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ note: "Looks good" });

    await client.api.rejectReturn("ret_1", "Final sale");
    expect(lastCall().url).toBe("http://api.test/api/v1/returns/ret_1/reject");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ note: "Final sale" });
  });

  it("starts a review with a POST and no body", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(200, {}));

    await client.api.startReview("ret_1");

    expect(lastCall().url).toBe("http://api.test/api/v1/returns/ret_1/start-review");
    expect(lastCall().init.method).toBe("POST");
    expect(lastCall().init.body).toBeUndefined();
    expect(lastCall().headers["Content-Type"]).toBeUndefined();
  });

  it("saves the policy with a PUT of exactly the policy fields", async () => {
    const client = await loadClient();
    const policy: ReturnPolicy = {
      returnWindowDays: 14,
      requirePaymentCaptured: true,
      allowPartialRefunds: false,
      manualReviewThreshold: "200.00",
      currency: "USD",
      restockingFeePercent: 2.5,
    };
    fetchMock.mockResolvedValueOnce(reply(200, policy));

    await client.api.updatePolicy(policy);

    expect(lastCall().url).toBe("http://api.test/api/v1/policy");
    expect(lastCall().init.method).toBe("PUT");
    expect(JSON.parse(lastCall().init.body as string)).toEqual(policy);
  });

  it("sends an Idempotency-Key header when asked to", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(200, {}));

    await client.request("/api/v1/x", { method: "POST", idempotencyKey: "key-1234567890123456" });

    expect(lastCall().headers["Idempotency-Key"]).toBe("key-1234567890123456");
  });
});

describe("responses", () => {
  it("returns the parsed JSON body", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(200, [{ id: "ord_1" }]));
    await expect(client.api.listOrders()).resolves.toEqual([{ id: "ord_1" }]);
  });

  it("returns undefined for 204 without reading a body", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(204));
    await expect(client.request("/api/v1/x")).resolves.toBeUndefined();
  });

  it("reports an unreadable success response", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(200)); // json() throws
    await expect(client.request("/api/v1/x")).rejects.toMatchObject({
      code: "invalid_response",
      message: "The server returned an unreadable response.",
    });
  });
});

const ERROR_CASES: Array<[label: string, status: number, body: unknown, message: string, code: string]> = [
  [
    "a string detail with a server code",
    409,
    { detail: 'A request that is "submitted" cannot be moved to "approved".', code: "invalid_transition" },
    'A request that is "submitted" cannot be moved to "approved".',
    "invalid_transition",
  ],
  ["a string detail without a code", 403, { detail: "No." }, "No.", "forbidden"],
  [
    "validation problems",
    422,
    {
      detail: [
        { loc: ["body", "email"], msg: "value is not a valid email address" },
        { loc: ["body"], msg: "Field required" },
      ],
      code: "validation_error",
    },
    "email: value is not a valid email address Field required",
    "validation_error",
  ],
  ["problems without a location", 422, { detail: [{ msg: "Bad value" }] }, "Bad value", "validation_error"],
  [
    "problems with no usable message",
    422,
    { detail: [{ loc: ["body"] }, 5] },
    "Request failed (422).",
    "validation_error",
  ],
  ["an empty detail", 400, { detail: "  " }, "Request failed (400).", "http_error"],
  ["no detail at all", 404, {}, "Request failed (404).", "not_found"],
  ["rate limiting", 429, { detail: "Slow down." }, "Slow down.", "rate_limited"],
];

describe("errors", () => {
  it.each(ERROR_CASES)("maps %s", async (_label, status, body, message, code) => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(status, body));

    const error = await caught(client.api.listOrders());

    expect(error).toBeInstanceOf(client.ApiError);
    expect(error).toMatchObject({ status, message, code });
  });

  it("never shows server internals for 5xx responses", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(500, { detail: "secret internals: Traceback...", code: "boom" }));

    const error = (await caught(client.api.listOrders())) as InstanceType<Client["ApiError"]>;

    expect(error.message).toBe("The server ran into a problem. Please try again later.");
    expect(error.message).not.toContain("secret");
    expect(error.code).toBe("server_error");
    expect(error.status).toBe(500);
  });

  it("copes with an error body that is not JSON", async () => {
    const client = await loadClient();
    fetchMock.mockResolvedValueOnce(reply(404)); // json() throws

    const error = await caught(client.api.getReturn("ret_x"));

    expect(error).toMatchObject({ status: 404, code: "not_found", message: "Request failed (404)." });
  });

  it("turns a network failure into a friendly error", async () => {
    const client = await loadClient();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await caught(client.api.listOrders());

    expect(error).toBeInstanceOf(client.ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: "network_error",
      message: "Could not reach the server. Check your connection and try again.",
    });
  });

  it("times out slow requests", async () => {
    const client = await loadClient();
    fetchMock.mockImplementation(hangingFetch());
    vi.useFakeTimers();

    const assertion = expect(client.request("/api/v1/slow", { timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
      status: 0,
      message: "The server took too long to respond.",
    });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it("rethrows the original error when the caller aborts on purpose", async () => {
    const client = await loadClient();
    fetchMock.mockImplementation(hangingFetch());
    const controller = new AbortController();

    const pending = client.request("/api/v1/x", { signal: controller.signal });
    controller.abort();
    const error = await caught(pending);

    expect(error).not.toBeInstanceOf(client.ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });

  it("handles a signal that was already aborted", async () => {
    const client = await loadClient();
    fetchMock.mockImplementation(hangingFetch());
    const controller = new AbortController();
    controller.abort();

    const error = await caught(client.request("/api/v1/x", { signal: controller.signal }));

    expect(error).not.toBeInstanceOf(client.ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});

describe("session expiry hook", () => {
  const EXPIRED = { detail: "Invalid or expired token.", code: "unauthorized" };

  it("fires once for a 401 on an authenticated call", async () => {
    const client = await loadClient();
    const handler = vi.fn();
    client.setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(reply(401, EXPIRED));

    const error = await caught(client.api.me());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ status: 401, code: "unauthorized", message: "Invalid or expired token." });
  });

  it("does not fire for a wrong password on login", async () => {
    const client = await loadClient();
    const handler = vi.fn();
    client.setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(
      reply(401, { detail: "Incorrect email or password.", code: "unauthorized" }),
    );

    const error = await caught(client.api.login("asha@example.com", "wrong password here"));

    expect(handler).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 401, message: "Incorrect email or password." });
  });

  it.each([403, 404, 409, 422])("does not fire for a %i", async (status) => {
    const client = await loadClient();
    const handler = vi.fn();
    client.setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(reply(status, { detail: "Nope." }));

    await caught(client.api.listOrders());

    expect(handler).not.toHaveBeenCalled();
  });

  it("still throws a clean error when no handler is registered", async () => {
    const client = await loadClient();
    client.setUnauthorizedHandler(null);
    fetchMock.mockResolvedValueOnce(reply(401, EXPIRED));

    await expect(client.api.me()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });
});

describe("describeError", () => {
  it("shows API errors as they are and hides everything else", async () => {
    const client = await loadClient();
    expect(client.describeError(new client.ApiError("Nope.", 409, "conflict"))).toBe("Nope.");

    const generic = "Something unexpected went wrong. Please try again.";
    expect(client.describeError(new Error("secret detail"))).toBe(generic);
    expect(client.describeError("a string")).toBe(generic);
    expect(client.describeError(undefined)).toBe(generic);
  });
});