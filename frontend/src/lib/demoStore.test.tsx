import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReturnStatus } from "@/types";

import {
  ALLOWED_TRANSITIONS,
  DemoStoreProvider,
  canTransition,
  useDemoStore,
  type ActionResult,
  type DemoStore,
} from "./demoStore";

function setup() {
  const { result } = renderHook(() => useDemoStore(), { wrapper: DemoStoreProvider });

  /** Runs one store action inside act() and returns its result. */
  async function run(action: (store: DemoStore) => Promise<ActionResult>): Promise<ActionResult> {
    const holder: { value?: ActionResult } = {};
    await act(async () => {
      holder.value = await action(result.current);
    });
    if (!holder.value) throw new Error("Action did not complete");
    return holder.value;
  }

  return { store: () => result.current, run };
}

const statusOf = (store: DemoStore, id: string): ReturnStatus => {
  const item = store.getReturn(id);
  if (!item) throw new Error(`Missing return ${id}`);
  return item.status;
};

function expectFailure(result: ActionResult, message: RegExp) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(message);
}

describe("transition rules", () => {
  it("allows only the intended next steps", () => {
    expect(canTransition("submitted", "under_review")).toBe(true);
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("under_review", "rejected")).toBe(true);
    expect(canTransition("approved", "refund_pending")).toBe(true);
    expect(canTransition("refund_failed", "refund_pending")).toBe(true);
  });

  it("blocks skipping steps and leaving closed states", () => {
    expect(canTransition("submitted", "approved")).toBe(false);
    expect(canTransition("submitted", "rejected")).toBe(false);
    expect(canTransition("approved", "refunded")).toBe(false);
    expect(ALLOWED_TRANSITIONS.rejected).toEqual([]);
    expect(ALLOWED_TRANSITIONS.refunded).toEqual([]);
  });

  it("only reaches 'refunded' from 'refund_pending'", () => {
    const sources = (Object.keys(ALLOWED_TRANSITIONS) as ReturnStatus[]).filter((status) =>
      ALLOWED_TRANSITIONS[status].includes("refunded"),
    );
    expect(sources).toEqual(["refund_pending"]);
  });
});

describe("starting a review", () => {
  it("moves a submitted request to under review and records it", async () => {
    const { store, run } = setup();

    const result = await run((s) => s.startReview("ret_1001"));

    expect(result.ok).toBe(true);
    expect(statusOf(store(), "ret_1001")).toBe("under_review");
    expect(store().getAuditForReturn("ret_1001")).toContainEqual(
      expect.objectContaining({
        eventType: "review_started",
        fromStatus: "submitted",
        toStatus: "under_review",
      }),
    );
  });

  it("refuses to start a review twice", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));

    const second = await run((s) => s.startReview("ret_1001"));

    expectFailure(second, /cannot be moved to review/i);
    expect(statusOf(store(), "ret_1001")).toBe("under_review");
  });

  it("reports an unknown return", async () => {
    const { run } = setup();
    expectFailure(await run((s) => s.startReview("nope")), /not found/i);
  });
});

describe("approving", () => {
  it("cannot skip the review step", async () => {
    const { store, run } = setup();

    const result = await run((s) => s.approveReturn("ret_1001", ""));

    expectFailure(result, /cannot be approved/i);
    expect(statusOf(store(), "ret_1001")).toBe("submitted");
  });

  it("is blocked when the policy check failed", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1003")); // outside the return window

    const result = await run((s) => s.approveReturn("ret_1003", ""));

    expectFailure(result, /failed the policy checks/i);
    expect(statusOf(store(), "ret_1003")).toBe("under_review");
  });

  it("approves an eligible request, keeps the note and readies the refund step", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));

    const result = await run((s) => s.approveReturn("ret_1001", "Looks good"));

    expect(result.ok).toBe(true);
    const approved = store().getReturn("ret_1001");
    expect(approved?.status).toBe("approved");
    expect(approved?.decisionNote).toBe("Looks good");

    const refund = store().getRefund("ret_1001");
    expect(refund?.steps[1].status).toBe("complete");
    expect(refund?.steps[2].status).toBe("current");
    expect(refund?.status).toBe("not_started"); // approval alone moves no money
  });

  it("stores no note when none is given", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));
    await run((s) => s.approveReturn("ret_1001", ""));
    expect(store().getReturn("ret_1001")?.decisionNote).toBeNull();
  });

  it("rejects notes over 500 characters", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));

    const result = await run((s) => s.approveReturn("ret_1001", "x".repeat(501)));

    expectFailure(result, /500/);
    expect(statusOf(store(), "ret_1001")).toBe("under_review");
  });
});

describe("rejecting", () => {
  it("cannot skip the review step", async () => {
    const { store, run } = setup();
    expectFailure(await run((s) => s.rejectReturn("ret_1003", "Outside window")), /cannot be rejected/i);
    expect(statusOf(store(), "ret_1003")).toBe("submitted");
  });

  it("requires a non-blank note", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1003"));

    expectFailure(await run((s) => s.rejectReturn("ret_1003", "")), /note is required/i);
    expectFailure(await run((s) => s.rejectReturn("ret_1003", "   ")), /note is required/i);
    expect(statusOf(store(), "ret_1003")).toBe("under_review");
  });

  it("closes the request with a zero refund amount and no refund steps", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1003"));

    const result = await run((s) => s.rejectReturn("ret_1003", "Outside the return window"));

    expect(result.ok).toBe(true);
    expect(statusOf(store(), "ret_1003")).toBe("rejected");
    expect(store().getReturn("ret_1003")?.decisionNote).toBe("Outside the return window");
    expect(store().getRefund("ret_1003")?.amount).toBe("0.00");
    expect(store().getRefund("ret_1003")?.steps).toHaveLength(2);
  });
});

describe("starting a refund (demo)", () => {
  it("marks the refund pending without ever completing it or inventing a PayPal ID", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));
    await run((s) => s.approveReturn("ret_1001", ""));

    const result = await run((s) => s.initiateRefund("ret_1001"));

    expect(result.ok).toBe(true);
    expect(statusOf(store(), "ret_1001")).toBe("refund_pending");

    const refund = store().getRefund("ret_1001");
    expect(refund?.status).toBe("pending");
    expect(refund?.paypalRefundId).toBeNull();

    const entry = store()
      .getAuditForReturn("ret_1001")
      .find((item) => item.eventType === "refund_initiated");
    expect(entry?.description).toMatch(/demo/i);
  });

  it("is blocked before approval", async () => {
    const { store, run } = setup();
    expectFailure(await run((s) => s.initiateRefund("ret_1001")), /cannot start a refund/i);
    expect(statusOf(store(), "ret_1001")).toBe("submitted");
  });

  it("cannot run twice for the same request", async () => {
    const { store, run } = setup();
    await run((s) => s.initiateRefund("ret_1008")); // already approved in the demo data

    const second = await run((s) => s.initiateRefund("ret_1008"));

    expectFailure(second, /cannot start a refund/i);
    const refunds = store()
      .getAuditForReturn("ret_1008")
      .filter((item) => item.eventType === "refund_initiated");
    expect(refunds).toHaveLength(1);
  });

  it("can retry after a failed refund and clears the failure reason", async () => {
    const { store, run } = setup();
    expect(store().getRefund("ret_1007")?.failureReason).not.toBeNull();

    const result = await run((s) => s.initiateRefund("ret_1007"));

    expect(result.ok).toBe(true);
    expect(statusOf(store(), "ret_1007")).toBe("refund_pending");
    expect(store().getRefund("ret_1007")?.failureReason).toBeNull();
  });
});

describe("updating the policy", () => {
  it("saves a valid change and logs it", async () => {
    const { store, run } = setup();

    const result = await run((s) => s.updatePolicy({ ...s.policy, returnWindowDays: 14 }));

    expect(result.ok).toBe(true);
    expect(store().policy.returnWindowDays).toBe(14);
    expect(
      store().auditLog.some(
        (entry) =>
          entry.eventType === "policy_updated" &&
          entry.description === "Return window changed from 30 to 14 days.",
      ),
    ).toBe(true);
  });

  it.each([
    ["a window of 0 days", { returnWindowDays: 0 }],
    ["a window over 365 days", { returnWindowDays: 366 }],
    ["a fractional window", { returnWindowDays: 1.5 }],
    ["a restocking fee over 100%", { restockingFeePercent: 101 }],
    ["a negative restocking fee", { restockingFeePercent: -1 }],
    ["a non-numeric review threshold", { manualReviewThreshold: "abc" }],
    ["a negative review threshold", { manualReviewThreshold: "-5.00" }],
  ])("rejects %s and leaves the policy unchanged", async (_label, change) => {
    const { store, run } = setup();
    const before = store().policy;

    const result = await run((s) => s.updatePolicy({ ...s.policy, ...change }));

    expect(result.ok).toBe(false);
    expect(store().policy).toEqual(before);
  });
});

describe("derived metrics and reset", () => {
  it("keeps dashboard numbers in step with the workflow", async () => {
    const { store, run } = setup();
    const before = store().metrics;

    await run((s) => s.startReview("ret_1001"));
    expect(store().metrics.awaitingReview).toBe(before.awaitingReview);

    await run((s) => s.approveReturn("ret_1001", ""));
    expect(store().metrics.awaitingReview).toBe(before.awaitingReview - 1);

    await run((s) => s.initiateRefund("ret_1001"));
    expect(store().metrics.refundsPending).toBe(before.refundsPending + 1);
  });

  it("restores the original demo data on reset", async () => {
    const { store, run } = setup();
    await run((s) => s.startReview("ret_1001"));
    await run((s) => s.updatePolicy({ ...s.policy, returnWindowDays: 7 }));

    act(() => {
      store().resetDemo();
    });

    expect(statusOf(store(), "ret_1001")).toBe("submitted");
    expect(store().policy.returnWindowDays).toBe(30);
  });
});

describe("useDemoStore", () => {
  it("throws a clear error when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useDemoStore())).toThrow(/DemoStoreProvider/);
    spy.mockRestore();
  });
});