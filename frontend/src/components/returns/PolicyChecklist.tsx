import { Check, X } from "lucide-react";

import { EmptyState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import type { PolicyEvaluation } from "@/types";

interface PolicyChecklistProps {
  evaluation: PolicyEvaluation | null;
}

export function PolicyChecklist({ evaluation }: PolicyChecklistProps) {
  if (!evaluation) {
    return (
      <Card title="Policy eligibility">
        <EmptyState
          title="No policy check yet"
          description="Eligibility is evaluated when a return request is submitted."
        />
      </Card>
    );
  }

  const passedCount = evaluation.checks.filter((check) => check.passed).length;

  return (
    <Card
      title="Policy eligibility"
      description="Deterministic rules from your return policy. AI cannot change this result."
      action={
        <Badge tone={evaluation.eligible ? "success" : "danger"} dot>
          {evaluation.eligible ? "Eligible" : "Not eligible"}
        </Badge>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {passedCount} of {evaluation.checks.length} checks passed
      </p>

      <ul className="divide-y divide-slate-100">
        {evaluation.checks.map((check) => (
          <li key={check.code} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                check.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              }`}
            >
              {check.passed ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {check.label}
                <span className="sr-only">: {check.passed ? "passed" : "failed"}</span>
              </p>
              <p className="text-sm text-slate-500">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-slate-400">
        Checked {formatDateTime(evaluation.evaluatedAt)}
      </p>
    </Card>
  );
}