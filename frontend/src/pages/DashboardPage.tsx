import { Link } from "react-router-dom";
import { Banknote, ClipboardCheck, Clock, Timer, Undo2 } from "lucide-react";

import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/StateViews";
import { Badge, ReturnStatusBadge } from "@/components/ui/Badge";
import { Card, StatCard } from "@/components/ui/Card";
import { DEMO_NOW_ISO } from "@/data/demoData";
import { useDemoStore } from "@/lib/demoStore";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import type { ReturnStatus } from "@/types";

const STATUS_ORDER: ReturnStatus[] = [
  "submitted",
  "under_review",
  "approved",
  "refund_pending",
  "refund_failed",
  "refunded",
  "rejected",
];

/** Statuses where the seller still has something to do. */
const ATTENTION_STATUSES: ReturnStatus[] = ["submitted", "under_review", "approved", "refund_failed"];

const DEMO_NOW = new Date(DEMO_NOW_ISO);

export function DashboardPage() {
  const { metrics, returns, auditLog, getEvaluation } = useDemoStore();

  const total = returns.length;

  const attention = returns
    .filter((item) => ATTENTION_STATUSES.includes(item.status))
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .slice(0, 5);

  const recentActivity = [...auditLog]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 6);

  const getReturnReference = (id: string) => returns.find((item) => item.id === id)?.reference;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Where your return requests and refunds stand right now."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Open returns"
          value={String(metrics.openReturns)}
          hint="Not yet rejected or refunded"
          icon={<Undo2 size={18} />}
        />
        <StatCard
          label="Awaiting review"
          value={String(metrics.awaitingReview)}
          hint="Submitted or under review"
          icon={<ClipboardCheck size={18} />}
        />
        <StatCard
          label="Refunds pending"
          value={String(metrics.refundsPending)}
          hint="Demo: nothing sent to PayPal"
          icon={<Clock size={18} />}
        />
        <StatCard
          label="Refunded this month"
          value={formatMoney(metrics.refundedThisMonth, metrics.currency)}
          hint="Demo data, not real transactions"
          icon={<Banknote size={18} />}
        />
        <StatCard
          label="Avg. decision time"
          value={metrics.avgDecisionHours > 0 ? `${metrics.avgDecisionHours} h` : "—"}
          hint="Submission to decision"
          icon={<Timer size={18} />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Needs your attention"
          description="Oldest requests first."
          className="lg:col-span-2"
          action={
            <Link to="/returns" className="btn-secondary px-2.5 py-1.5 text-xs">
              View all returns
            </Link>
          }
        >
          {attention.length === 0 ? (
            <EmptyState title="All caught up" description="No requests need action right now." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((item) => {
                const evaluation = getEvaluation(item.id);
                const failsPolicy =
                  evaluation !== null &&
                  !evaluation.eligible &&
                  (item.status === "submitted" || item.status === "under_review");

                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/returns/${item.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {item.reference}
                      </Link>
                      <p className="text-sm text-slate-500">
                        {item.customer.name} · {formatMoney(item.requestedAmount, item.currency)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {failsPolicy && <Badge tone="danger">Fails policy</Badge>}
                      <ReturnStatusBadge status={item.status} />
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(item.submittedAt, DEMO_NOW)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Returns by status" description="Select a status to filter the queue.">
          {total === 0 ? (
            <EmptyState title="No returns yet" />
          ) : (
            <ul className="space-y-1">
              {STATUS_ORDER.map((status) => {
                const count = metrics.returnsByStatus[status];
                const percent = Math.round((count / total) * 100);
                return (
                  <li key={status}>
                    <Link
                      to={`/returns?status=${status}`}
                      className="block rounded-lg px-2 py-2 hover:bg-slate-50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <ReturnStatusBadge status={status} />
                        <span className="text-sm font-medium text-slate-900">{count}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                      >
                        <span
                          className="block h-full rounded-full bg-brand-500"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        description="Latest entries from the audit history."
        action={
          <Link to="/audit" className="btn-secondary px-2.5 py-1.5 text-xs">
            Full audit log
          </Link>
        }
      >
        <AuditTimeline entries={recentActivity} getReturnReference={getReturnReference} />
      </Card>
    </div>
  );
}