import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEMO_NOW_ISO,
  computeDashboardMetrics,
  demoAiAnalyses,
  demoAuditLog,
  demoOrders,
  demoPolicy,
  demoPolicyEvaluations,
  demoRefundRecords,
  demoReturns,
} from "@/data/demoData";
import {
  RETURN_STATUS_LABELS,
  compareMoney,
  refundableBalance,
  toMinorUnits,
} from "@/lib/format";
import type {
  AiAnalysis,
  AuditActorType,
  AuditEntry,
  AuditEventType,
  DashboardMetrics,
  Order,
  PolicyEvaluation,
  RefundRecord,
  RefundTimelineStep,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

/* ---------- Workflow rules ---------- */

/**
 * Allowed status transitions. "refund_pending" -> "refunded" / "refund_failed"
 * exist for the real backend only; the demo store never completes a refund,
 * because nothing here talks to PayPal.
 */
export const ALLOWED_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: ["refund_pending"],
  rejected: [],
  refund_pending: ["refunded", "refund_failed"],
  refunded: [],
  refund_failed: ["refund_pending"],
};

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const MAX_NOTE_LENGTH = 500;
const SELLER_NAME = "Demo Seller";

/* ---------- State ---------- */

interface DemoState {
  returns: ReturnRequest[];
  orders: Order[];
  evaluations: Record<string, PolicyEvaluation>;
  analyses: Record<string, AiAnalysis>;
  refunds: Record<string, RefundRecord>;
  audit: AuditEntry[];
  policy: ReturnPolicy;
}

// State is only ever replaced, never mutated, so the module-level demo data stays pristine.
function createInitialState(): DemoState {
  return {
    returns: demoReturns,
    orders: demoOrders,
    evaluations: demoPolicyEvaluations,
    analyses: demoAiAnalyses,
    refunds: demoRefundRecords,
    audit: demoAuditLog,
    policy: demoPolicy,
  };
}

const nowIso = () => new Date().toISOString();

let auditCounter = 0;

function makeAudit(
  returnId: string | null,
  eventType: AuditEventType,
  actorType: AuditActorType,
  description: string,
  fromStatus: ReturnStatus | null,
  toStatus: ReturnStatus | null,
  occurredAt: string,
): AuditEntry {
  auditCounter += 1;
  return {
    id: `aud_demo_${auditCounter}`,
    returnId,
    eventType,
    actorType,
    actorName: SELLER_NAME,
    description,
    fromStatus,
    toStatus,
    occurredAt,
  };
}

function findCase(state: DemoState, returnId: string) {
  const ret = state.returns.find((item) => item.id === returnId);
  const refund = state.refunds[returnId];
  return ret && refund ? { ret, refund } : null;
}

function patchStep(
  record: RefundRecord,
  index: number,
  patch: Partial<RefundTimelineStep>,
): RefundRecord {
  if (!record.steps[index]) return record;
  return {
    ...record,
    steps: record.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
  };
}

function withReturnUpdate(
  state: DemoState,
  returnId: string,
  update: Partial<ReturnRequest>,
  refund: RefundRecord,
  entry: AuditEntry,
): DemoState {
  return {
    ...state,
    returns: state.returns.map((item) => (item.id === returnId ? { ...item, ...update } : item)),
    refunds: { ...state.refunds, [returnId]: refund },
    audit: [...state.audit, entry],
  };
}

/* ---------- Public store shape ---------- */

/**
 * Phase 3 replaces this with an API-backed implementation of the same
 * interface, so pages should only depend on `useDemoStore()`'s shape.
 */
export interface DemoStore {
  returns: ReturnRequest[];
  orders: Order[];
  policy: ReturnPolicy;
  auditLog: AuditEntry[];
  metrics: DashboardMetrics;
    /** "demo" = in-memory sample data, "api" = the real backend. Pages adjust wording by it. */
  mode: "demo" | "api";
  /** The clock pages use for relative dates and return-window math. */
  now: Date;
  /** False until the PayPal phase: hides refund actions that have no backend yet. */
  refundsAvailable: boolean;
  
  
  getOrder: (orderId: string) => Order | null;
  getReturn: (returnId: string) => ReturnRequest | null;
  getEvaluation: (returnId: string) => PolicyEvaluation | null;
  getAnalysis: (returnId: string) => AiAnalysis | null;
  getRefund: (returnId: string) => RefundRecord | null;
  getAuditForReturn: (returnId: string) => AuditEntry[];

  startReview: (returnId: string) => Promise<ActionResult>;
  approveReturn: (returnId: string, note: string) => Promise<ActionResult>;
  rejectReturn: (returnId: string, note: string) => Promise<ActionResult>;
  initiateRefund: (returnId: string) => Promise<ActionResult>;
  updatePolicy: (next: ReturnPolicy) => Promise<ActionResult>;
  resetDemo: () => void;
}

export const DemoStoreContext = createContext<DemoStore | null>(null);

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(createInitialState);

  // Actions read the latest state from a ref, so rapid double-clicks cannot
  // run the same transition twice with stale data.
  const stateRef = useRef(state);
  const commit = useCallback((next: DemoState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const actions = useMemo(() => {
    async function startReview(returnId: string): Promise<ActionResult> {
      const s = stateRef.current;
      const found = findCase(s, returnId);
      if (!found) return fail("Return request not found.");
      const { ret, refund } = found;
      if (!canTransition(ret.status, "under_review")) {
        return fail(`A request that is "${RETURN_STATUS_LABELS[ret.status]}" cannot be moved to review.`);
      }

      const at = nowIso();
      commit(
        withReturnUpdate(
          s,
          returnId,
          { status: "under_review", updatedAt: at },
          patchStep(refund, 1, {
            description: "Under review by the seller.",
            status: "current",
            occurredAt: at,
          }),
          makeAudit(returnId, "review_started", "seller", "Review started.", ret.status, "under_review", at),
        ),
      );
      return OK;
    }

    async function approveReturn(returnId: string, note: string): Promise<ActionResult> {
      const s = stateRef.current;
      const found = findCase(s, returnId);
      if (!found) return fail("Return request not found.");
      const { ret, refund } = found;
      if (!canTransition(ret.status, "approved")) {
        return fail(`A request that is "${RETURN_STATUS_LABELS[ret.status]}" cannot be approved.`);
      }
      if (!s.evaluations[returnId]?.eligible) {
        return fail("This request failed the policy checks and cannot be approved.");
      }
      if (note.length > MAX_NOTE_LENGTH) {
        return fail(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      }

      const at = nowIso();
      const withDecision = patchStep(refund, 1, {
        description: "Approved by the seller.",
        status: "complete",
        occurredAt: at,
      });
      commit(
        withReturnUpdate(
          s,
          returnId,
          { status: "approved", updatedAt: at, decisionNote: note || null },
          patchStep(withDecision, 2, {
            description: "Ready for the seller to start the refund.",
            status: "current",
            occurredAt: null,
          }),
          makeAudit(returnId, "return_approved", "seller", "Return approved.", ret.status, "approved", at),
        ),
      );
      return OK;
    }

    async function rejectReturn(returnId: string, note: string): Promise<ActionResult> {
      const s = stateRef.current;
      const found = findCase(s, returnId);
      if (!found) return fail("Return request not found.");
      const { ret, refund } = found;
      if (!canTransition(ret.status, "rejected")) {
        return fail(`A request that is "${RETURN_STATUS_LABELS[ret.status]}" cannot be rejected.`);
      }
      if (note.trim().length === 0) return fail("A note is required when rejecting a return.");
      if (note.length > MAX_NOTE_LENGTH) {
        return fail(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      }

      const at = nowIso();
      const closed = patchStep(refund, 1, {
        description: "Rejected by the seller. No refund will be issued.",
        status: "complete",
        occurredAt: at,
      });
      commit(
        withReturnUpdate(
          s,
          returnId,
          { status: "rejected", updatedAt: at, decisionNote: note },
          { ...closed, amount: "0.00", steps: closed.steps.slice(0, 2) },
          makeAudit(returnId, "return_rejected", "seller", "Return rejected.", ret.status, "rejected", at),
        ),
      );
      return OK;
    }

    async function initiateRefund(returnId: string): Promise<ActionResult> {
      const s = stateRef.current;
      const found = findCase(s, returnId);
      if (!found) return fail("Return request not found.");
      const { ret, refund } = found;
      if (!canTransition(ret.status, "refund_pending")) {
        return fail(`A request that is "${RETURN_STATUS_LABELS[ret.status]}" cannot start a refund.`);
      }
      if (!s.evaluations[returnId]?.eligible) {
        return fail("This request failed the policy checks, so it cannot be refunded.");
      }
      const order = s.orders.find((item) => item.id === ret.orderId);
      if (!order) return fail("The related order was not found.");
      if (order.paymentStatus !== "captured" && order.paymentStatus !== "partially_refunded") {
        return fail("The order's payment has not been captured, so it cannot be refunded.");
      }
      if (compareMoney(ret.requestedAmount, refundableBalance(order.total, order.refundedAmount)) === 1) {
        return fail("The requested amount is more than the remaining refundable balance.");
      }

      // Demo only: this records an intent. No PayPal request is sent and nothing confirms it.
      const at = nowIso();
      const initiated = patchStep(refund, 2, {
        description: "Demo only: no PayPal request was sent.",
        status: "complete",
        occurredAt: at,
      });
      const waiting = patchStep(initiated, 3, {
        description: "Demo only: nothing will confirm this refund. Real sandbox refunds arrive with the PayPal integration.",
        status: "current",
        occurredAt: null,
      });
      commit(
        withReturnUpdate(
          s,
          returnId,
          { status: "refund_pending", updatedAt: at },
          { ...waiting, status: "pending", failureReason: null },
          makeAudit(
            returnId,
            "refund_initiated",
            "seller",
            "Refund marked pending (demo state, no PayPal request sent).",
            ret.status,
            "refund_pending",
            at,
          ),
        ),
      );
      return OK;
    }

    async function updatePolicy(next: ReturnPolicy): Promise<ActionResult> {
      const s = stateRef.current;
      if (!Number.isInteger(next.returnWindowDays) || next.returnWindowDays < 1 || next.returnWindowDays > 365) {
        return fail("Return window must be a whole number of days between 1 and 365.");
      }
      if (!Number.isFinite(next.restockingFeePercent) || next.restockingFeePercent < 0 || next.restockingFeePercent > 100) {
        return fail("Restocking fee must be between 0 and 100 percent.");
      }
      try {
        if (toMinorUnits(next.manualReviewThreshold) < 0n) throw new Error("negative");
      } catch {
        return fail("Manual review threshold must be a valid amount like 150.00.");
      }

      const at = nowIso();
      const description =
        next.returnWindowDays !== s.policy.returnWindowDays
          ? `Return window changed from ${s.policy.returnWindowDays} to ${next.returnWindowDays} days.`
          : "Return policy updated.";
      commit({
        ...s,
        policy: next,
        audit: [...s.audit, makeAudit(null, "policy_updated", "seller", description, null, null, at)],
      });
      return OK;
    }

    function resetDemo() {
      commit(createInitialState());
    }

    return { startReview, approveReturn, rejectReturn, initiateRefund, updatePolicy, resetDemo };
  }, [commit]);

  const metrics = useMemo(
    () =>
      computeDashboardMetrics(state.returns, state.audit, state.policy.currency, new Date(DEMO_NOW_ISO)),
    [state.returns, state.audit, state.policy.currency],
  );

  const value = useMemo<DemoStore>(
    () => ({
      returns: state.returns,
      orders: state.orders,
      policy: state.policy,
      auditLog: state.audit,
      metrics,
      mode: "demo",
      now: new Date(DEMO_NOW_ISO),
      refundsAvailable: true,
      getOrder: (id) => state.orders.find((item) => item.id === id) ?? null,
      getReturn: (id) => state.returns.find((item) => item.id === id) ?? null,
      getEvaluation: (id) => state.evaluations[id] ?? null,
      getAnalysis: (id) => state.analyses[id] ?? null,
      getRefund: (id) => state.refunds[id] ?? null,
      getAuditForReturn: (id) => state.audit.filter((entry) => entry.returnId === id),
      ...actions,
    }),
    [state, metrics, actions],
  );

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>;
}

export function useDemoStore(): DemoStore {
  const store = useContext(DemoStoreContext);
  if (!store) {
    throw new Error("useDemoStore must be used inside <DemoStoreProvider>");
  }
  return store;
}