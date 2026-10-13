import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Renders the cell content for a row. */
  cell: (row: T) => ReactNode;
  /** Providing this makes the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  /** Extra classes for the body cells (e.g. "whitespace-nowrap"). */
  className?: string;
}

/** Click on the active column flips direction; a new column starts ascending. */
export function toggleSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}

/** Returns a sorted copy (stable). Columns without `sortValue` leave order unchanged. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column?.sortValue) return rows;

  const getValue = column.sortValue;
  const factor = sort.direction === "asc" ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((a, b) => {
      const result =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
      return result !== 0 ? result * factor : a.index - b.index;
    })
    .map((entry) => entry.row);
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Screen-reader description of the table (visually hidden). */
  caption: string;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  sort = null,
  onSortChange,
  empty,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <div>{empty}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue && onSortChange);
              const active = sort?.key === column.key;
              const ariaSort = active
                ? sort?.direction === "asc"
                  ? "ascending"
                  : "descending"
                : undefined;
              const SortIcon = active
                ? sort?.direction === "asc"
                  ? ArrowUp
                  : ArrowDown
                : ArrowUpDown;

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`table-th ${column.align === "right" ? "text-right" : ""}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(toggleSort(sort, column.key))}
                      className="inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-slate-900"
                    >
                      {column.header}
                      <SortIcon
                        size={12}
                        aria-hidden="true"
                        className={active ? "text-slate-900" : "text-slate-400"}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="hover:bg-slate-50">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`table-td ${column.align === "right" ? "text-right" : ""} ${
                    column.className ?? ""
                  }`.trim()}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}