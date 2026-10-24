import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ErrorState, LoadingState } from "@/components/shared/StateViews";
import { Button } from "@/components/ui/Button";
import { API_BASE_URL, api, describeError } from "@/lib/apiClient";
import { DemoStoreContext, type ActionResult, type DemoStore } from "@/lib/demoStore";
import type {
  AuditEntry,
  DashboardMetrics,
  Order,
  PolicyEvaluation,
  RefundRecord,
  RefundStatus,
  RefundStepStatus,
  RefundTimelineStep,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

const EVALUATION_CONCURRENCY = 6;
const AUDIT_LIMIT = 500;
const REFUNDS_UNAVAILABLE = "Refunds are not available yet. They arrive with the PayPal integration.";

interface Snapshot {
  orders: Order[];
  returns: ReturnRequest[];
  policy: ReturnPolicy;
  audit: AuditEntry[];
  metrics: DashboardMetrics;
  loadedAt: Date;
}

type Evaluations = Record<string, PolicyEvaluation>;

/* ---------- Refund timeline, derived from the real return status ---------- */

const REFUND_STATUS: Record<ReturnStatus, RefundStatus> = {
  submitted: "not_started",
  under_review: "not_started",
  approved: "not_started",
  rejected: "not_started",
  refund_pending: "pending",
  refunded: "completed",
  refund_failed: "failed",
};

/**
 * The backend has no refund endpoint yet, so the timeline is built from the return's status.
 * It never invents a PayPal refund ID: that only exists after a real sandbox refund.
 */
export function deriveRefundRecord(request: ReturnRequest): RefundRecord {
  const step = (
    n: number,
    title: string,
    description: string,
    status: RefundStepStatus,
    occurredAt: string | null = null,
  ): RefundTimelineStep => ({ id: `${request.id}_step_${n}`, title, description, status, occurredAt });

  const submitted = step(1, "Return submitted", "Customer submitted the request.", "complete", request.submittedAt);
  const approved = step(2, "Seller decision", "Approved by the seller.", "complete", request.updatedAt);
  const initiateLater = step(3, "Refund initiated", "Starts after the seller approves.", "upcoming");
  const confirmLater = step(4, "Refund confirmed", "Confirmed once PayPal reports success.", "upcoming");

  function build(): { steps: RefundTimelineStep[]; failureReason: string | null } {
    switch (request.status) {
      case "submitted":
        return {
          steps: [submitted, step(2, "Seller decision", "Waiting for the seller to review.", "current"), initiateLater, confirmLater],
          failureReason: null,
        };
      case "under_review":
        return {
          steps: [submitted, step(2, "Seller decision", "Under review by the seller.", "current"), initiateLater, confirmLater],
          failureReason: null,
        };
      case "approved":
        return {
          steps: [submitted, approved, step(3, "Refund initiated", "Available once the PayPal integration is added.", "upcoming"), confirmLater],
          failureReason: null,
        };
      case "rejected":
        return {
          steps: [submitted, step(2, "Seller decision", "Rejected by the seller. No refund will be issued.", "complete", request.updatedAt)],
          failureReason: null,
        };
      case "refund_pending":
        return {
          steps: [submitted, approved, step(3, "Refund initiated", "Refund requested from PayPal.", "complete"), step(4, "Refund confirmed", "Waiting for PayPal to confirm.", "current")],
          failureReason: null,
        };
      case "refunded":
        return {
          steps: [submitted, approved, step(3, "Refund initiated", "Refund requested from PayPal.", "complete"), step(4, "Refund confirmed", "Confirmed by PayPal.", "complete", request.updatedAt)],
          failureReason: null,
        };
      case "refund_failed":
        return {
          steps: [submitted, approved, step(3, "Refund initiated", "Refund requested from PayPal.", "complete"), step(4, "Refund confirmed", "The refund did not go through.", "failed", request.updatedAt)],
          failureReason: "The refund did not go through.",
        };
    }
  }

  const { steps, failureReason } = build();
  return {
    returnId: request.id,
    status: REFUND_STATUS[request.status],
    amount: request.status === "rejected" ? "0.00" : request.requestedAmount,
    currency: request.currency,
    paypalRefundId: null,
    failureReason,
    steps,
  };
}

/* ---------- Loading ---------- */

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Loads everything the pages need. There is no bulk endpoint for policy results, so each
 * return's evaluation is fetched once (a few at a time) and cached, because a stored result
 * never changes.
 */
async function fetchAll(
  cache: Evaluations,
  signal?: AbortSignal,
): Promise<{ snapshot: Snapshot; evaluations: Evaluations }> {
  const read = signal ? { signal } : undefined;
  const [orders, returns, policy, audit, metrics] = await Promise.all([
    api.listOrders(read),
    api.listReturns(undefined, read),
    api.getPolicy(read),
    api.listAudit({ limit: AUDIT_LIMIT }, read),
    api.getMetrics(read),
  ]);

  const missing = returns.filter((item) => !cache[item.id]);
  const fetched = await mapWithLimit(missing, EVALUATION_CONCURRENCY, async (item) => {
    try {
      return await api.getEvaluation(item.id, read);
    } catch {
      return null; // shown as "no policy result", which also blocks approval
    }
  });

  const evaluations: Evaluations = { ...cache };
  for (const evaluation of fetched) {
    if (evaluation) evaluations[evaluation.returnId] = evaluation;
  }
  return { snapshot: { orders, returns, policy, audit, metrics, loadedAt: new Date() }, evaluations };
}

/* ---------- Provider ---------- */

type Phase = "loading" | "ready" | "error";

interface ApiStoreProviderProps {
  children: ReactNode;
  onUseDemo: () => void;
  onSignOut: () => void;
}

function StatusScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="card w-full max-w-md">{children}</div>
    </main>
  );
}

export function ApiStoreProvider({ children, onUseDemo, onSignOut }: ApiStoreProviderProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluations>({});
  const [attempt, setAttempt] = useState(0);
  const evaluationsRef = useRef<Evaluations>({});

  const apply = useCallback((result: { snapshot: Snapshot; evaluations: Evaluations }) => {
    evaluationsRef.current = result.evaluations;
    setEvaluations(result.evaluations);
    setSnapshot(result.snapshot);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPhase("loading");
    fetchAll(evaluationsRef.current, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        apply(result);
        setPhase("ready");
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMessage(describeError(error));
        setPhase("error");
      },
    );
    return () => controller.abort();
  }, [attempt, apply]);

  /** Background refresh after an action. A failure keeps what is on screen. */
  const refresh = useCallback(async () => {
    try {
      apply(await fetchAll(evaluationsRef.current));
    } catch {
      // The change itself already succeeded and is shown. A reload will pick up the rest.
    }
  }, [apply]);

  const patchReturn = useCallback((updated: ReturnRequest) => {
    setSnapshot((prev) =>
      prev
        ? { ...prev, returns: prev.returns.map((item) => (item.id === updated.id ? updated : item)) }
        : prev,
    );
  }, []);

  const actions = useMemo(() => {
    async function perform<T>(run: () => Promise<T>, onSuccess: (result: T) => void): Promise<ActionResult> {
      try {
        onSuccess(await run());
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
      await refresh();
      return { ok: true };
    }

    return {
      startReview: (id: string) => perform(() => api.startReview(id), patchReturn),
      approveReturn: (id: string, note: string) => perform(() => api.approveReturn(id, note), patchReturn),
      rejectReturn: (id: string, note: string) => perform(() => api.rejectReturn(id, note), patchReturn),
      initiateRefund: async (): Promise<ActionResult> => ({ ok: false, error: REFUNDS_UNAVAILABLE }),
      updatePolicy: (next: ReturnPolicy) =>
        perform(
          () => api.updatePolicy(next),
          (policy) => setSnapshot((prev) => (prev ? { ...prev, policy } : prev)),
        ),
    };
  }, [patchReturn, refresh]);

  const value = useMemo<DemoStore | null>(() => {
    if (!snapshot) return null;
    return {
      returns: snapshot.returns,
      orders: snapshot.orders,
      policy: snapshot.policy,
      auditLog: snapshot.audit,
      metrics: snapshot.metrics,
      mode: "api",
      now: snapshot.loadedAt,
      refundsAvailable: false,
      getOrder: (id) => snapshot.orders.find((item) => item.id === id) ?? null,
      getReturn: (id) => snapshot.returns.find((item) => item.id === id) ?? null,
      getEvaluation: (id) => evaluations[id] ?? null,
      getAnalysis: () => null, // the AI analysis endpoint arrives in Phase 4
      getRefund: (id) => {
        const request = snapshot.returns.find((item) => item.id === id);
        return request ? deriveRefundRecord(request) : null;
      },
      getAuditForReturn: (id) => snapshot.audit.filter((entry) => entry.returnId === id),
      ...actions,
      resetDemo: () => undefined, // nothing to reset: this is real data
    };
  }, [snapshot, evaluations, actions]);

  if (phase === "error") {
    return (
      <StatusScreen>
        <ErrorState
          title="Couldn't load your data"
          message={errorMessage}
          onRetry={() => setAttempt((count) => count + 1)}
        />
        <div className="flex flex-wrap justify-center gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="secondary" onClick={onUseDemo}>
            Use demo data
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
        <p className="px-5 pb-4 text-center text-xs text-slate-400">Backend: {API_BASE_URL}</p>
      </StatusScreen>
    );
  }

  if (phase !== "ready" || value === null) {
    return (
      <StatusScreen>
        <LoadingState label="Loading your data..." />
      </StatusScreen>
    );
  }

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>;
}