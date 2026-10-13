import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/Button";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  id: string;
  /** Accessible name for the dropdown (visually hidden). */
  label: string;
  /** Current value; "" means "all". */
  value: string;
  /** Text for the empty option, e.g. "All statuses". */
  allLabel: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  onClear: () => void;
  /** e.g. "8 returns". Announced politely to screen readers when it changes. */
  resultLabel?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchLabel,
  searchPlaceholder = "Search...",
  filters = [],
  onClear,
  resultLabel,
}: FilterBarProps) {
  const hasActiveFilters = searchValue.trim() !== "" || filters.some((f) => f.value !== "");

  return (
    <div role="search" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:w-72">
          <label htmlFor="filter-search" className="sr-only">
            {searchLabel}
          </label>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            id="filter-search"
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="input pl-9"
          />
        </div>

        {filters.map((filter) => (
          <div key={filter.id}>
            <label htmlFor={`filter-${filter.id}`} className="sr-only">
              {filter.label}
            </label>
            <select
              id={`filter-${filter.id}`}
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
              className="input sm:w-auto"
            >
              <option value="">{filter.allLabel}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            icon={<X size={14} />}
          >
            Clear filters
          </Button>
        )}
      </div>

      {resultLabel && (
        <p aria-live="polite" className="text-xs text-slate-500">
          {resultLabel}
        </p>
      )}
    </div>
  );
}