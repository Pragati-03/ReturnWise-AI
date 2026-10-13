import type {
  CurrencyCode,
  MoneyString,
  PaymentStatus,
  RefundStatus,
  ReturnReasonCategory,
  ReturnStatus,
  SuggestedAction,
} from "@/types";

/* ======================================================================
 * Money (decimal-safe)
 * Amounts are decimal strings ("49.99"). All math runs on integer minor
 * units (cents) using BigInt, so there is no floating-point drift.
 * ====================================================================== */

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** Convert "49.99" to 4999n. Throws on malformed input. */
export function toMinorUnits(value: MoneyString): bigint {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new Error(`Invalid money amount: "${value}"`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

/** Convert 4999n back to "49.99". */
export function fromMinorUnits(minor: bigint): MoneyString {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${cents}`;
}

export function addMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

export function subtractMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/** Multiply a unit price by an integer quantity. */
export function multiplyMoney(a: MoneyString, quantity: number): MoneyString {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  return fromMinorUnits(toMinorUnits(a) * BigInt(quantity));
}

/** Returns -1, 0 or 1, like a standard comparator. */
export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  const x = toMinorUnits(a);
  const y = toMinorUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Remaining refundable balance for an order (never below zero). */
export function refundableBalance(
  total: MoneyString,
  refunded: MoneyString,
): MoneyString {
  const remaining = toMinorUnits(total) - toMinorUnits(refunded);
  return fromMinorUnits(remaining < 0n ? 0n : remaining);
}

/** Display format, e.g. "$1,249.50". Falls back to "—" on bad input. */
export function formatMoney(value: MoneyString, currency: CurrencyCode): string {
  try {
    const minor = toMinorUnits(value);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const cents = (abs % 100n).toString().padStart(2, "0");
    return `${negative ? "-" : ""}${CURRENCY_SYMBOLS[currency]}${whole}.${cents}`;
  } catch {
    return "—";
  }
}

/* ======================================================================
 * Dates
 * ====================================================================== */

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string | null | undefined): string {
  const date = parseDate(iso);
  return date ? dateFormatter.format(date) : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  const date = parseDate(iso);
  return date ? dateTimeFormatter.format(date) : "—";
}

/** e.g. "2 hours ago", "yesterday". `now` is injectable for tests. */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(iso);
  if (!date) return "—";
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeFormatter.format(diffSeconds, "second");
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");
}

const MS_PER_DAY = 86_400_000;

/** Whole days elapsed from `iso` to `now` (0 if the date is invalid). */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number {
  const date = parseDate(iso);
  if (!date) return 0;
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}

/**
 * Days left in the return window, counted from delivery.
 * Negative means the window has expired. Returns null if not yet delivered.
 */
export function returnWindowDaysLeft(
  deliveredAt: string | null,
  windowDays: number,
  now: Date = new Date(),
): number | null {
  if (!parseDate(deliveredAt)) return null;
  return windowDays - daysSince(deliveredAt, now);
}

/* ======================================================================
 * Labels
 * ====================================================================== */

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  refund_failed: "Refund failed",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  captured: "Captured",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  failed: "Failed",
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  not_started: "Not started",
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
};

export const REASON_CATEGORY_LABELS: Record<ReturnReasonCategory, string> = {
  damaged: "Damaged item",
  wrong_item: "Wrong item sent",
  not_as_described: "Not as described",
  size_fit: "Size or fit",
  changed_mind: "Changed mind",
  late_delivery: "Late delivery",
  other: "Other",
};

export const SUGGESTED_ACTION_LABELS: Record<SuggestedAction, string> = {
  approve: "Suggest approval",
  reject: "Suggest rejection",
  request_more_info: "Request more info",
  manual_review: "Needs manual review",
};

/* ======================================================================
 * Badge tones (Tailwind classes; full strings so Tailwind can detect them)
 * ====================================================================== */

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export const RETURN_STATUS_TONES: Record<ReturnStatus, Tone> = {
  submitted: "info",
  under_review: "warning",
  approved: "success",
  rejected: "neutral",
  refund_pending: "warning",
  refunded: "success",
  refund_failed: "danger",
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, Tone> = {
  pending: "warning",
  captured: "success",
  partially_refunded: "info",
  refunded: "neutral",
  failed: "danger",
};

export const REFUND_STATUS_TONES: Record<RefundStatus, Tone> = {
  not_started: "neutral",
  pending: "warning",
  completed: "success",
  failed: "danger",
};