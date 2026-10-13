import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  description?: string;
  /** Optional element on the right side of the header (e.g. a button). */
  action?: ReactNode;
  /** Remove body padding, e.g. for edge-to-edge tables. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({
  title,
  description,
  action,
  flush = false,
  className = "",
  children,
}: CardProps) {
  const hasHeader = Boolean(title || description || action);

  return (
    <section className={`card ${className}`.trim()}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  /** Short supporting text under the value. */
  hint?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}