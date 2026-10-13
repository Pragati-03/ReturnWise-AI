import { useMemo, useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/shared/FilterBar";
import { Pagination, paginate } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/StateViews";
import { PaymentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, sortRows, type Column, type SortState } from "@/components/ui/Table";
import { useDemoStore } from "@/lib/demoStore";
import {
  PAYMENT_STATUS_LABELS,
  formatDate,
  formatMoney,
  toMinorUnits,
} from "@/lib/format";
import type { Order } from "@/types";

const PAGE_SIZE = 6;

// Used only to order rows; never for financial math.
const moneyOrder = (value: string) => Number(toMinorUnits(value));

const COLUMNS: Column<Order>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="font-medium text-slate-900">{order.orderNumber}</span>,
    sortValue: (order) => order.orderNumber,
    className: "whitespace-nowrap",
  },
  {
    key: "customer",
    header: "Customer",
    cell: (order) => (
      <div>
        <p className="text-slate-900">{order.customer.name}</p>
        <p className="text-xs text-slate-500">{order.customer.email}</p>
      </div>
    ),
    sortValue: (order) => order.customer.name,
  },
  {
    key: "placed",
    header: "Placed",
    cell: (order) => formatDate(order.placedAt),
    sortValue: (order) => Date.parse(order.placedAt),
    className: "whitespace-nowrap",
  },
  {
    key: "delivered",
    header: "Delivered",
    cell: (order) => formatDate(order.deliveredAt),
    sortValue: (order) => (order.deliveredAt ? Date.parse(order.deliveredAt) : 0),
    className: "whitespace-nowrap",
  },
  {
    key: "items",
    header: "Items",
    cell: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0),
  },
  {
    key: "total",
    header: "Total",
    cell: (order) => formatMoney(order.total, order.currency),
    sortValue: (order) => moneyOrder(order.total),
    align: "right",
    className: "whitespace-nowrap",
  },
  {
    key: "refunded",
    header: "Refunded",
    cell: (order) => formatMoney(order.refundedAmount, order.currency),
    sortValue: (order) => moneyOrder(order.refundedAmount),
    align: "right",
    className: "whitespace-nowrap",
  },
  {
    key: "payment",
    header: "Payment",
    cell: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
    sortValue: (order) => PAYMENT_STATUS_LABELS[order.paymentStatus],
  },
];

const PAYMENT_OPTIONS = Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function OrdersPage() {
  const { orders } = useDemoStore();

  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [sort, setSort] = useState<SortState | null>({ key: "placed", direction: "desc" });
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (paymentStatus && order.paymentStatus !== paymentStatus) return false;
      if (!query) return true;
      const haystack = [
        order.orderNumber,
        order.customer.name,
        order.customer.email,
        ...order.items.flatMap((item) => [item.name, item.sku]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [orders, search, paymentStatus]);

  const sorted = useMemo(() => sortRows(filtered, COLUMNS, sort), [filtered, sort]);
  const pageRows = paginate(sorted, page, PAGE_SIZE);

  function clearFilters() {
    setSearch("");
    setPaymentStatus("");
    setPage(1);
  }

  const emptyState =
    orders.length === 0 ? (
      <EmptyState title="No orders yet" description="Orders will appear here once customers buy from you." />
    ) : (
      <EmptyState
        title="No matching orders"
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
        title="Orders"
        description="Orders with their payment status and how much has been refunded."
      />

      <Card flush>
        <div className="border-b border-slate-200 p-4">
          <FilterBar
            searchValue={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchLabel="Search orders"
            searchPlaceholder="Search order, customer or item"
            filters={[
              {
                id: "payment",
                label: "Filter by payment status",
                value: paymentStatus,
                allLabel: "All payment statuses",
                options: PAYMENT_OPTIONS,
                onChange: (value) => {
                  setPaymentStatus(value);
                  setPage(1);
                },
              },
            ]}
            onClear={clearFilters}
            resultLabel={`${filtered.length} ${filtered.length === 1 ? "order" : "orders"}`}
          />
        </div>

        <DataTable
          columns={COLUMNS}
          rows={pageRows}
          getRowKey={(order) => order.id}
          caption="Orders"
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
          itemLabel="orders"
        />
      </Card>
    </div>
  );
}