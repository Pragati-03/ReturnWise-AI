import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listReturns: vi.fn(),
  getPolicy: vi.fn(),
  listAudit: vi.fn(),
  getMetrics: vi.fn(),
  getEvaluation: vi.fn(),
  startReview: vi.fn(),
  approveReturn: vi.fn(),
  rejectReturn: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  api: mockApi,
  API_BASE_URL: "http://api.test",
  describeError: (error: unknown) =>
    error instanceof Error ? error.message : "Something unexpected went wrong. Please try again.",
}));

import { ApiStoreProvider, deriveRefundRecord } from "@/lib/apiStore";
import { useDemoStore, type ActionResult } from "@/lib/demoStore";
import type {
  AuditEntry,
  DashboardMetrics,
  Order,
  PolicyEvaluation,
  RefundStatus,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

/* ---------- fixtures ---------- */

const CUSTOMER = { id: "cus_1", name: "Aarav", email: "aarav@example.com" };

function makeReturn(over: Partial<ReturnRequest> = {}): ReturnRequest {
  return {
    id: "ret_1",
    reference: "RET-1001",
    orderId: "ord_1",
    customer: CUSTOMER,
    status: "submitted",
    items: [{ orderItemId: "itm_1", quantity: 1 }],
    customerComment: "It stopped working.",
    requestedAmount: "79.99",
    currency: "USD",
    submittedAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    decisionNote: null,
    ...over,
  };
}

function makeOrder(): Order {
  return {
    id: "ord_1",
    orderNumber: "RW-2001",
    customer: CUSTOMER,
    items: [{ id: "itm_1", sku: "EARBUDS", name: "Earbuds", quantity: 1, unitPrice: "79.99", returnable: true }],
    currency: "USD",
    total: "79.99",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-25T09:00:00Z",
    deliveredAt: "2026-09-28T09:00:00Z",
  };
}

function makeEvaluation(returnId: string, eligible = true): PolicyEvaluation {
  return {
    returnId,
    eligible,
    evaluatedAt: "2026-10-01T09:01:00Z",
    checks: [
      {
        code: eligible ? "WITHIN_RETURN_WINDOW" : "RETURN_WINDOW_EXPIRED",
        label: "Within return window",
        passed: eligible,
        detail: "Delivered 3 days ago; policy allows 30 days.",
      },
    ],
  };
}

function makeAudit(id: string, returnId: string): AuditEntry {
  return {
    id,
    returnId,
    eventType: "return_submitted",
    actorType: "seller",
    actorName: "Asha",
    description: "Return request submitted.",
    fromStatus: null,
    toStatus: "submitted",
    occurredAt: "2026-10-01T09:00:00Z",
  };
}

const POLICY: ReturnPolicy = {
  returnWindowDays: 30,
  requirePaymentCaptured: true,
  allowPartialRefunds: true,
  manualReviewThreshold: "150.00",
  currency: "USD",
  restockingFeePercent: 0,
};

const METRICS: DashboardMetrics = {
  openReturns: 2,
  awaitingReview: 2,
  refundsPending: 0,
  refundedThisMonth: "0.00",
  currency: "USD",
  avgDecisionHours: 3,
  returnsByStatus: {
    submitted: 1,
    under_review: 1,
    approved: 0,
    rejected: 0,
    refund_pending: 0,
    refunded: 0,
    refund_failed: 0,
  },
};

interface World {
  orders: Order[];
  returns: ReturnRequest[];
  evaluations: Record<string, PolicyEvaluation>;
  audit: AuditEntry[];
  policy: ReturnPolicy;
}

/** A fake backend. Tests change `world` to change what the next request returns. */
function seed(): World {
  const world: World = {
    orders: [makeOrder()],
    returns: [makeReturn(), makeReturn({ id: "ret_2", reference: "RET-1002", status: "under_review" })],
    evaluations: { ret_1: makeEvaluation("ret_1"), ret_2: makeEvaluation("ret_2", false) },
    audit: [makeAudit("aud_1", "ret_1"), makeAudit("aud_2", "ret_2")],
    policy: { ...POLICY },
  };
  mockApi.listOrders.mockImplementation(async () => world.orders);
  mockApi.listReturns.mockImplementation(async () => world.returns);
  mockApi.getPolicy.mockImplementation(async () => world.policy);
  mockApi.listAudit.mockImplementation(async () => world.audit);
  mockApi.getMetrics.mockImplementation(async () => METRICS);
  mockApi.getEvaluation.mockImplementation(async (id: string) => {
    const found = world.evaluations[id];
    if (!found) throw new Error("No policy evaluation exists for this return yet.");
    return found;
  });
  return world;
}

function renderStore() {
  const onUseDemo = vi.fn();
  const onSignOut = vi.fn();
  const view = renderHook(() => useDemoStore(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ApiStoreProvider onUseDemo={onUseDemo} onSignOut={onSignOut}>
        {children}
      </ApiStoreProvider>
    ),
  });
  return { ...view, onUseDemo, onSignOut };
}

async function loaded() {
  const view = renderStore();
  await waitFor(() => expect(view.result.current).not.toBeNull());
  return view;
}

function Probe() {
  const store = useDemoStore();
  return <p>Loaded {store.returns.length} returns</p>;
}

function renderProbe() {
  const onUseDemo = vi.fn();
  const onSignOut = vi.fn();
  render(
    <ApiStoreProvider onUseDemo={onUseDemo} onSignOut={onSignOut}>
      <Probe />
    </ApiStoreProvider>,
  );
  return { onUseDemo, onSignOut };
}

beforeEach(() => {
  vi.resetAllMocks();
});

/* ---------- loading and error screens ---------- */

describe("loading and error screens", () => {
  it("shows a loading state until everything has arrived", () => {
    seed();
    mockApi.listOrders.mockReturnValue(new Promise(() => undefined)); // never answers

    renderProbe();

    expect(screen.getByRole("status")).toHaveTextContent("Loading your data...");
    expect(screen.queryByText(/Loaded/)).not.toBeInTheDocument();
  });

  it("renders the app once the data is in", async () => {
    seed();
    renderProbe();
    expect(await screen.findByText("Loaded 2 returns")).toBeInTheDocument();
  });

  it("shows the error with the backend URL and the three ways out", async () => {
    seed();
    mockApi.listOrders.mockRejectedValue(
      new Error("Could not reach the server. Check your connection and try again."),
    );
    const { onUseDemo, onSignOut } = renderProbe();
    const user = userEvent.setup();

    expect(await screen.findByText("Couldn't load your data")).toBeInTheDocument();
    expect(
      screen.getByText("Could not reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Backend: http://api.test")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use demo data" }));
    expect(onUseDemo).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("retries from the error screen", async () => {
    seed();
    mockApi.listOrders.mockRejectedValueOnce(
      new Error("Could not reach the server. Check your connection and try again."),
    );
    renderProbe();
    const user = userEvent.setup();

    await screen.findByText("Couldn't load your data");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Loaded 2 returns")).toBeInTheDocument();
  });
});

/* ---------- the store interface ---------- */

describe("the store interface", () => {
  it("loads everything and exposes it the way the pages expect", async () => {
    const world = seed();
    const { result } = await loaded();
    const store = result.current;

    expect(store.mode).toBe("api");
    expect(store.refundsAvailable).toBe(false);
    expect(Math.abs(Date.now() - store.now.getTime())).toBeLessThan(60_000);

    expect(store.returns.map((item) => item.id)).toEqual(["ret_1", "ret_2"]);
    expect(store.orders).toEqual(world.orders);
    expect(store.policy).toEqual(POLICY);
    expect(store.metrics).toEqual(METRICS);
    expect(store.auditLog).toHaveLength(2);

    expect(store.getReturn("ret_1")?.reference).toBe("RET-1001");
    expect(store.getReturn("nope")).toBeNull();
    expect(store.getOrder("ord_1")?.orderNumber).toBe("RW-2001");
    expect(store.getOrder("nope")).toBeNull();
    expect(store.getEvaluation("ret_1")?.eligible).toBe(true);
    expect(store.getEvaluation("ret_2")?.eligible).toBe(false);
    expect(store.getEvaluation("nope")).toBeNull();
    expect(store.getAuditForReturn("ret_2").map((entry) => entry.id)).toEqual(["aud_2"]);
    expect(store.getAuditForReturn("nope")).toEqual([]);
  });

  it("asks for the audit log with the maximum limit", async () => {
    seed();
    await loaded();
    expect(mockApi.listAudit).toHaveBeenCalledWith({ limit: 500 }, expect.anything());
  });

  it("has no AI analysis yet", async () => {
    seed();
    const { result } = await loaded();
    expect(result.current.getAnalysis("ret_1")).toBeNull();
  });

  it("fetches each policy result once, a few at a time", async () => {
    const world = seed();
    world.returns = Array.from({ length: 20 }, (_, index) =>
      makeReturn({ id: `ret_${index + 1}`, reference: `RET-${1001 + index}` }),
    );
    world.evaluations = Object.fromEntries(
      world.returns.map((item) => [item.id, makeEvaluation(item.id)]),
    );
    let active = 0;
    let maxActive = 0;
    mockApi.getEvaluation.mockImplementation(async (id: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return world.evaluations[id];
    });

    const { result } = await loaded();

    expect(maxActive).toBeLessThanOrEqual(6);
    expect(maxActive).toBeGreaterThan(1);
    expect(mockApi.getEvaluation).toHaveBeenCalledTimes(20);
    for (const item of world.returns) {
      expect(result.current.getEvaluation(item.id)?.returnId).toBe(item.id);
    }
  });

  it("copes with a policy result that cannot be loaded", async () => {
    const world = seed();
    delete world.evaluations.ret_2;

    const { result } = await loaded();

    expect(result.current.getEvaluation("ret_1")).not.toBeNull();
    expect(result.current.getEvaluation("ret_2")).toBeNull(); // shown as "no policy result"
  });

  it("does nothing when asked to reset the demo", async () => {
    seed();
    const { result } = await loaded();
    expect(() => act(() => result.current.resetDemo())).not.toThrow();
    expect(result.current.returns).toHaveLength(2);
  });
});

/* ---------- actions ---------- */

async function perform(action: () => Promise<ActionResult>): Promise<ActionResult | undefined> {
  let outcome: ActionResult | undefined;
  await act(async () => {
    outcome = await action();
  });
  return outcome;
}

describe("actions", () => {
  it("starts a review: updates the return at once and refreshes in the background", async () => {
    const world = seed();
    const { result } = await loaded();
    const updated = makeReturn({ status: "under_review", updatedAt: "2026-10-02T10:00:00Z" });
    mockApi.startReview.mockResolvedValue(updated);
    world.returns = [updated, world.returns[1]];

    const outcome = await perform(() => result.current.startReview("ret_1"));

    expect(outcome).toEqual({ ok: true });
    expect(mockApi.startReview).toHaveBeenCalledWith("ret_1");
    expect(result.current.getReturn("ret_1")?.status).toBe("under_review");
    expect(mockApi.listReturns).toHaveBeenCalledTimes(2); // load, then refresh
    expect(mockApi.getEvaluation).toHaveBeenCalledTimes(2); // cached: nothing fetched again
  });

    it("approves and rejects with the note", async () => {
    const world = seed();
    const { result } = await loaded();

    // The fake server records each decision, like the real one, so the refresh agrees.
    const change = (id: string, patch: Partial<ReturnRequest>) => {
      const current = world.returns.find((item) => item.id === id);
      if (!current) throw new Error("Return request not found.");
      const updated = { ...current, ...patch };
      world.returns = world.returns.map((item) => (item.id === id ? updated : item));
      return updated;
    };
    mockApi.approveReturn.mockImplementation(async (id: string, note: string) =>
      change(id, { status: "approved", decisionNote: note }),
    );
    mockApi.rejectReturn.mockImplementation(async (id: string, note: string) =>
      change(id, { status: "rejected", decisionNote: note }),
    );

    expect(await perform(() => result.current.approveReturn("ret_1", "Looks good"))).toEqual({ ok: true });
    expect(mockApi.approveReturn).toHaveBeenCalledWith("ret_1", "Looks good");
    expect(result.current.getReturn("ret_1")?.status).toBe("approved");
    expect(result.current.getReturn("ret_1")?.decisionNote).toBe("Looks good");

    expect(await perform(() => result.current.rejectReturn("ret_2", "Final sale"))).toEqual({ ok: true });
    expect(mockApi.rejectReturn).toHaveBeenCalledWith("ret_2", "Final sale");
    expect(result.current.getReturn("ret_2")?.status).toBe("rejected");
    expect(result.current.getReturn("ret_2")?.decisionNote).toBe("Final sale");
  });

  it("returns the server's message when an action is refused, and changes nothing", async () => {
    seed();
    const { result } = await loaded();
    mockApi.approveReturn.mockRejectedValue(
      new Error("This request failed the policy checks and cannot be approved."),
    );
    const loadsBefore = mockApi.listReturns.mock.calls.length;

    const outcome = await perform(() => result.current.approveReturn("ret_2", ""));

    expect(outcome).toEqual({
      ok: false,
      error: "This request failed the policy checks and cannot be approved.",
    });
    expect(result.current.getReturn("ret_2")?.status).toBe("under_review");
    expect(mockApi.listReturns).toHaveBeenCalledTimes(loadsBefore); // no refresh after a failure
  });

  it("hides unexpected errors behind a generic message", async () => {
    seed();
    const { result } = await loaded();
    mockApi.startReview.mockRejectedValue("not an Error object");

    const outcome = await perform(() => result.current.startReview("ret_1"));

    expect(outcome).toEqual({
      ok: false,
      error: "Something unexpected went wrong. Please try again.",
    });
  });

  it("still reports success when only the background refresh fails", async () => {
    const world = seed();
    const { result } = await loaded();
    const updated = makeReturn({ status: "under_review" });
    mockApi.startReview.mockResolvedValue(updated);
    mockApi.listOrders.mockRejectedValue(new Error("down")); // the refresh will fail
    world.returns = [updated, world.returns[1]];

    const outcome = await perform(() => result.current.startReview("ret_1"));

    expect(outcome).toEqual({ ok: true });
    expect(result.current.getReturn("ret_1")?.status).toBe("under_review"); // patched locally
  });

  it("saves the policy and shows the saved values", async () => {
    const world = seed();
    const { result } = await loaded();
    const next: ReturnPolicy = { ...POLICY, returnWindowDays: 14, restockingFeePercent: 2.5 };
    mockApi.updatePolicy.mockResolvedValue(next);
    world.policy = next;

    const outcome = await perform(() => result.current.updatePolicy(next));

    expect(outcome).toEqual({ ok: true });
    expect(mockApi.updatePolicy).toHaveBeenCalledWith(next);
    expect(result.current.policy).toEqual(next);
  });

  it("keeps the old policy when saving is refused", async () => {
    seed();
    const { result } = await loaded();
    mockApi.updatePolicy.mockRejectedValue(new Error("The currency cannot be changed."));

    const outcome = await perform(() => result.current.updatePolicy({ ...POLICY, currency: "EUR" }));

    expect(outcome).toEqual({ ok: false, error: "The currency cannot be changed." });
    expect(result.current.policy).toEqual(POLICY);
  });

  it("refuses to start a refund, because the backend has none yet", async () => {
    seed();
    const { result } = await loaded();

    const outcome = await perform(() => result.current.initiateRefund("ret_1"));

    expect(outcome).toEqual({
      ok: false,
      error: "Refunds are not available yet. They arrive with the PayPal integration.",
    });
    expect(mockApi.startReview).not.toHaveBeenCalled();
    expect(mockApi.approveReturn).not.toHaveBeenCalled();
    expect(result.current.getReturn("ret_1")?.status).toBe("submitted");
  });
});

/* ---------- derived refund timeline ---------- */

const REFUND_CASES: Array<[ReturnStatus, RefundStatus, number]> = [
  ["submitted", "not_started", 4],
  ["under_review", "not_started", 4],
  ["approved", "not_started", 4],
  ["rejected", "not_started", 2],
  ["refund_pending", "pending", 4],
  ["refunded", "completed", 4],
  ["refund_failed", "failed", 4],
];

describe("deriveRefundRecord", () => {
  it.each(REFUND_CASES)("%s gives a %s refund with %i steps and no PayPal ID", (status, refund, count) => {
    const record = deriveRefundRecord(makeReturn({ status }));

    expect(record.returnId).toBe("ret_1");
    expect(record.status).toBe(refund);
    expect(record.steps).toHaveLength(count);
    expect(record.paypalRefundId).toBeNull(); // never invented
    expect(new Set(record.steps.map((step) => step.id)).size).toBe(count);
    expect(record.amount).toBe(status === "rejected" ? "0.00" : "79.99");
    expect(record.currency).toBe("USD");
    expect(record.failureReason !== null).toBe(status === "refund_failed");
  });

  it("marks the right step as current for each stage", () => {
    const stage = (status: ReturnStatus) =>
      deriveRefundRecord(makeReturn({ status })).steps.map((step) => step.status);

    expect(stage("submitted")).toEqual(["complete", "current", "upcoming", "upcoming"]);
    expect(stage("under_review")).toEqual(["complete", "current", "upcoming", "upcoming"]);
    expect(stage("approved")).toEqual(["complete", "complete", "upcoming", "upcoming"]);
    expect(stage("rejected")).toEqual(["complete", "complete"]);
    expect(stage("refund_pending")).toEqual(["complete", "complete", "complete", "current"]);
    expect(stage("refunded")).toEqual(["complete", "complete", "complete", "complete"]);
    expect(stage("refund_failed")).toEqual(["complete", "complete", "complete", "failed"]);
  });

  it("uses the real timestamps and says refunds are not available yet once approved", () => {
    const record = deriveRefundRecord(
      makeReturn({ status: "approved", updatedAt: "2026-10-02T10:00:00Z" }),
    );

    expect(record.steps[0].occurredAt).toBe("2026-10-01T09:00:00Z");
    expect(record.steps[1].occurredAt).toBe("2026-10-02T10:00:00Z");
    expect(record.steps[2].description).toBe("Available once the PayPal integration is added.");
    expect(record.steps[3].occurredAt).toBeNull();
  });

  it("is what the store returns for a return, and null for an unknown one", async () => {
    seed();
    const { result } = await loaded();

    expect(result.current.getRefund("ret_1")).toEqual(deriveRefundRecord(makeReturn()));
    expect(result.current.getRefund("nope")).toBeNull();
  });
});