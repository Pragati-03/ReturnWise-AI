import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/shared/FilterBar";
import { Pagination, paginate } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/StateViews";
import { Badge, ReturnStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, sortRows, type Column, type SortState } from "@/components/ui/Table";
import { useDemoStore } from "@/lib/demoStore";
import {
  REASON_CATEGORY_LABELS,
  RETURN_STATUS_LABELS,
  formatDate,
  formatMoney,
  toMinorUnits,
} from "@/lib/format";
import type { ReturnReasonCategory, ReturnRequest, ReturnStatus } from "@/types";

const PAGE_SIZE = 6;

/** A return joined with the data the table needs, so columns stay simple. */
interface ReturnRow {
  request: ReturnRequest;
  orderNumber: string;
  category: ReturnReasonCategory | null;
  /** null when no policy result exists yet. */
  eligible: boolean | null;
}

const STATUS_VALUES = Object.keys(RETURN_STATUS_LABELS);

function parseStatus(value: string | null): ReturnStatus | "" {
  return value && STATUS_VALUES.includes(value) ? (value as ReturnStatus) : "";
}

// Used only to order rows; never for financial math.
const moneyOrder = (value: string) => Number(toMinorUnits(value));

const COLUMNS: Column<ReturnRow>[] = [
  {
    key: "reference",
    header: "Return",
    cell: (row) => (
      <Link
        to={`/returns/${row.request.id}`}
        className="font-medium text-brand-700 hover:underline"
      >
        {row.request.reference}
      </Link>
    ),
    sortValue: (row) => row.request.reference,
    className: "whitespace-nowrap",
  },
  {
    key: "customer",
    header: "Customer",
    cell: (row) => (
      <div>
        <p className="text-slate-900">{row.request.customer.name}</p>
        <p className="text-xs text-slate-500">{row.request.customer.email}</p>
      </div>
    ),
    sortValue: (row) => row.request.customer.name,
  },
  {
    key: "order",
    header: "Order",
    cell: (row) => row.orderNumber,
    sortValue: (row) => row.orderNumber,
    className: "whitespace-nowrap",
  },
  {
    key: "reason",
    header: "Reason",
    cell: (row) => (row.category ? REASON_CATEGORY_LABELS[row.category] : "—"),
    sortValue: (row) => (row.category ? REASON_CATEGORY_LABELS[row.category] : ""),
  },
  {
    key: "amount",
    header: "Amount",
    cell: (row) => formatMoney(row.request.requestedAmount, row.request.currency),
    sortValue: (row) => moneyOrder(row.request.requestedAmount),
    align: "right",
    className: "whitespace-nowrap",
  },
  {
    key: "policy",
    header: "Policy",
    cell: (row) =>
      row.eligible === null ? (
        "—"
      ) : (
        <Badge tone={row.eligible ? "success" : "danger"} dot>
          {row.eligible ? "Eligible" : "Not eligible"}
        </Badge>
      ),
    sortValue: (row) => (row.eligible === null ? -1 : row.eligible ? 1 : 0),
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => <ReturnStatusBadge status={row.request.status} />,
    sortValue: (row) => RETURN_STATUS_LABELS[row.request.status],
  },
  {
    key: "submitted",
    header: "Submitted",
    cell: (row) => formatDate(row.request.submittedAt),
    sortValue: (row) => Date.parse(row.request.submittedAt),
    className: "whitespace-nowrap",
  },
];

const STATUS_OPTIONS = Object.entries(RETURN_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const CATEGORY_OPTIONS = Object.entries(REASON_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const POLICY_OPTIONS = [
  { value: "eligible", label: "Eligible" },
  { value: "not_eligible", label: "Not eligible" },
];

export function ReturnsPage() {
  const { returns, getOrder, getAnalysis, getEvaluation } = useDemoStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // The status filter is the URL's job, so links like /returns?status=submitted work.
  const status = parseStatus(searchParams.get("status"));

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [policy, setPolicy] = useState("");
  const [sort, setSort] = useState<SortState | null>({ key: "submitted", direction: "desc" });
  const [page, setPage] = useState(1);

  const rows = useMemo<ReturnRow[]>(
    () =>
      returns.map((request) => ({
        request,
        orderNumber: getOrder(request.orderId)?.orderNumber ?? "—",
        category: getAnalysis(request.id)?.category ?? null,
        eligible: getEvaluation(request.id)?.eligible ?? null,
      })),
    [returns, getOrder, getAnalysis, getEvaluation],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status && row.request.status !== status) return false;
      if (category && row.category !== category) return false;
      if (policy === "eligible" && row.eligible !== true) return false;
      if (policy === "not_eligible" && row.eligible !== false) return false;
      if (!query) return true;
      const haystack = [
        row.request.reference,
        row.request.customer.name,
        row.request.customer.email,
        row.orderNumber,
        row.request.customerComment,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, status, category, policy, search]);

  const sorted = useMemo(() => sortRows(filtered, COLUMNS, sort), [filtered, sort]);
  const pageRows = paginate(sorted, page, PAGE_SIZE);

  function setStatusParam(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setCategory("");
    setPolicy("");
    setStatusParam("");
  }

  const emptyState =
    returns.length === 0 ? (
      <EmptyState
        title="No return requests yet"
        description="Requests will appear here when customers submit them."
      />
    ) : (
      <EmptyState
        title="No matching returns"
        description="Try a different search or clear the filters."
        action={
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns"
        description="Review return requests, check the policy result and decide."
      />

      <Card flush>
        <div className="border-b border-slate-200 p-4">
          <FilterBar
            searchValue={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchLabel="Search returns"
            searchPlaceholder="Search return, customer, order or comment"
            filters={[
              {
                id: "status",
                label: "Filter by status",
                value: status,
                allLabel: "All statuses",
                options: STATUS_OPTIONS,
                onChange: setStatusParam,
              },
              {
                id: "reason",
                label: "Filter by reason",
                value: category,
                allLabel: "All reasons",
                options: CATEGORY_OPTIONS,
                onChange: (value) => {
                  setCategory(value);
                  setPage(1);
                },
              },
              {
                id: "policy",
                label: "Filter by policy result",
                value: policy,
                allLabel: "All policy results",
                options: POLICY_OPTIONS,
                onChange: (value) => {
                  setPolicy(value);
                  setPage(1);
                },
              },
            ]}
            onClear={clearFilters}
            resultLabel={`${filtered.length} ${filtered.length === 1 ? "return" : "returns"}`}
          />
        </div>

        <DataTable
          columns={COLUMNS}
          rows={pageRows}
          getRowKey={(row) => row.request.id}
          caption="Return requests"
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          empty={emptyState}
        />

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={sorted.length}
          onPageChange={setPage}
          itemLabel="returns"
        />
      </Card>
    </div>
  );
}