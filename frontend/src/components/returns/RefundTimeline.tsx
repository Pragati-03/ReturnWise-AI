import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";

import { EmptyState } from "@/components/shared/StateViews";
import { RefundStatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { RefundRecord, RefundStepStatus } from "@/types";

const STEP_STYLES: Record<RefundStepStatus, { icon: typeof Circle; color: string; sr: string }> = {
  complete: { icon: CheckCircle2, color: "text-emerald-600", sr: "Completed" },
  current: { icon: Clock, color: "text-amber-600", sr: "In progress" },
  upcoming: { icon: Circle, color: "text-slate-300", sr: "Upcoming" },
  failed: { icon: XCircle, color: "text-red-600", sr: "Failed" },
};

interface RefundTimelineProps {
  record: RefundRecord | null;
}

export function RefundTimeline({ record }: RefundTimelineProps) {
  if (!record) {
    return (
      <Card title="Refund status">
        <EmptyState
          title="No refund activity"
          description="Refund tracking starts after a return request is submitted."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Refund status"
      action={<RefundStatusBadge status={record.status} />}
    >
      <dl className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {formatMoney(record.amount, record.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            PayPal refund ID
          </dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-700">
            {record.paypalRefundId ?? "Not issued"}
          </dd>
        </div>
      </dl>

      {record.failureReason && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <span className="font-medium">Refund failed: </span>
          {record.failureReason}
        </div>
      )}

      <ol aria-label="Refund progress">
        {record.steps.map((step, index) => {
          const style = STEP_STYLES[step.status];
          const Icon = style.icon;
          const isLast = index === record.steps.length - 1;

          return (
            <li
              key={step.id}
              aria-current={step.status === "current" ? "step" : undefined}
              className="relative flex gap-3 pb-6 last:pb-0"
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-[9px] top-6 h-[calc(100%-1.5rem)] w-px bg-slate-200"
                />
              )}
              <Icon size={20} aria-hidden="true" className={`relative shrink-0 bg-white ${style.color}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {step.title}
                  <span className="sr-only">: {style.sr}</span>
                </p>
                <p className="text-sm text-slate-500">{step.description}</p>
                {step.occurredAt && (
                  <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(step.occurredAt)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}