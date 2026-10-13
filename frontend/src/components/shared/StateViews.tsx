import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Info, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DEMO_NOTICE } from "@/data/demoData";

/* ---------- Loading ---------- */

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-slate-500"
    >
      <Loader2 size={28} className="animate-spin text-brand-600" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Placeholder rows shown while a table's data loads. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-slate-100">
      <span className="sr-only">Loading table data</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex items-center gap-4 px-4 py-4">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Empty ---------- */

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Optional call to action, e.g. a "Clear filters" button. */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500"
      >
        {icon ?? <Inbox size={22} />}
      </span>
      <h3 className="mt-2 text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ---------- Error ---------- */

interface ErrorStateProps {
  title?: string;
  message: string;
  /** When provided, a "Try again" button is shown. */
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600"
      >
        <AlertTriangle size={22} />
      </span>
      <h3 className="mt-2 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      )}
    </div>
  );
}

/* ---------- Demo notice ---------- */

export function DemoBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{DEMO_NOTICE}</p>
    </div>
  );
}