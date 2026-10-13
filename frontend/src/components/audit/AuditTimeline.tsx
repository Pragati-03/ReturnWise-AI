import { Link } from "react-router-dom";
import { Cpu, Sparkles, Store, User, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/StateViews";
import { RETURN_STATUS_LABELS, formatDateTime } from "@/lib/format";
import type { AuditActorType, AuditEntry, AuditEventType } from "@/types";

export const AUDIT_EVENT_LABELS: Record<AuditEventType, string> = {
  return_submitted: "Return submitted",
  policy_evaluated: "Policy evaluated",
  ai_analysis_generated: "AI analysis generated",
  review_started: "Review started",
  return_approved: "Return approved",
  return_rejected: "Return rejected",
  refund_initiated: "Refund initiated",
  refund_completed: "Refund completed",
  refund_failed: "Refund failed",
  policy_updated: "Policy updated",
};

export const AUDIT_ACTOR_LABELS: Record<AuditActorType, string> = {
  customer: "Customer",
  seller: "Seller",
  system: "System",
  ai: "AI",
};

const ACTOR_ICONS: Record<AuditActorType, LucideIcon> = {
  customer: User,
  seller: Store,
  system: Cpu,
  ai: Sparkles,
};

interface AuditTimelineProps {
  entries: AuditEntry[];
  /** When provided, entries link to their return using this reference (e.g. "RET-1004"). */
  getReturnReference?: (returnId: string) => string | undefined;
  emptyTitle?: string;
}

export function AuditTimeline({
  entries,
  getReturnReference,
  emptyTitle = "No audit entries",
}: AuditTimelineProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Actions on this case will be recorded here."
      />
    );
  }

  const sorted = [...entries].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );

  return (
    <ol aria-label="Audit history" className="divide-y divide-slate-100">
      {sorted.map((entry) => {
        const Icon = ACTOR_ICONS[entry.actorType];
        const reference =
          entry.returnId && getReturnReference ? getReturnReference(entry.returnId) : undefined;

        return (
          <li key={entry.id} className="flex gap-3 px-1 py-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"
            >
              <Icon size={16} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-slate-900">
                  {AUDIT_EVENT_LABELS[entry.eventType]}
                  {entry.returnId && reference && (
                    <>
                      {" "}
                      <Link
                        to={`/returns/${entry.returnId}`}
                        className="font-normal text-brand-700 hover:underline"
                      >
                        {reference}
                      </Link>
                    </>
                  )}
                </p>
                <time dateTime={entry.occurredAt} className="text-xs text-slate-400">
                  {formatDateTime(entry.occurredAt)}
                </time>
              </div>

              <p className="text-sm text-slate-600">{entry.description}</p>

              <p className="mt-0.5 text-xs text-slate-500">
                <span className="sr-only">Actor: </span>
                {entry.actorName} ({AUDIT_ACTOR_LABELS[entry.actorType]})
                {entry.toStatus && (
                  <>
                    {" · "}
                    <span className="sr-only">Status change: </span>
                    {entry.fromStatus ? RETURN_STATUS_LABELS[entry.fromStatus] : "New"}
                    {" → "}
                    {RETURN_STATUS_LABELS[entry.toStatus]}
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}