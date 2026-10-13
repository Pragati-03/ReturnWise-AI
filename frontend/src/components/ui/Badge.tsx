import type { ReactNode } from "react";

import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONES,
  TONE_CLASSES,
  type Tone,
} from "@/lib/format";
import type { PaymentStatus, RefundStatus, ReturnStatus } from "@/types";

const DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-400",
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
};

interface BadgeProps {
  tone?: Tone;
  /** Show a small colored dot before the label. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The label text always carries the meaning; color is only reinforcement,
 * so status is never conveyed by color alone.
 */
export function Badge({ tone = "neutral", dot = false, className = "", children }: BadgeProps) {
  return (
    <span className={`badge ${TONE_CLASSES[tone]} ${className}`.trim()}>
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`}
        />
      )}
      {children}
    </span>
  );
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  return (
    <Badge tone={RETURN_STATUS_TONES[status]} dot>
      {RETURN_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge tone={PAYMENT_STATUS_TONES[status]} dot>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  return (
    <Badge tone={REFUND_STATUS_TONES[status]} dot>
      {REFUND_STATUS_LABELS[status]}
    </Badge>
  );
}