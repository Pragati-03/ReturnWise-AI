import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";

export function getTotalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** Keeps a 1-based page number within the valid range. */
export function clampPage(page: number, totalItems: number, pageSize: number): number {
  return Math.min(Math.max(1, page), getTotalPages(totalItems, pageSize));
}

/** Returns the items for a 1-based page. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const current = clampPage(page, items.length, pageSize);
  const start = (current - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Used in the summary, e.g. "returns". */
  itemLabel?: string;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemLabel = "items",
}: PaginationProps) {
  if (totalItems === 0) return null;

  const totalPages = getTotalPages(totalItems, pageSize);
  const current = clampPage(page, totalItems, pageSize);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, totalItems);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row"
    >
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{from}</span> to{" "}
        <span className="font-medium text-slate-700">{to}</span> of{" "}
        <span className="font-medium text-slate-700">{totalItems}</span> {itemLabel}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
            icon={<ChevronLeft size={14} />}
          >
            Previous
          </Button>
          <span className="text-sm text-slate-600" aria-current="page">
            Page {current} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= totalPages}
          >
            Next
            <ChevronRight size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}