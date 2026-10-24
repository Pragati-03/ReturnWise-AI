import { useParams } from "react-router-dom";

import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { AiAnalysisPanel } from "@/components/returns/AiAnalysisPanel";
import { DecisionPanel } from "@/components/returns/DecisionPanel";
import { PolicyChecklist } from "@/components/returns/PolicyChecklist";
import { RefundTimeline } from "@/components/returns/RefundTimeline";
import { EmptyState } from "@/components/shared/StateViews";
import { Badge, PaymentStatusBadge, ReturnStatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/Table";
import { useDemoStore } from "@/lib/demoStore";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  multiplyMoney,
  refundableBalance,
  returnWindowDaysLeft,
} from "@/lib/format";
import type { CurrencyCode } from "@/types";

interface ItemLine {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  ordered: number;
  unitPrice: string;
  lineTotal: string;
  returnable: boolean;
  currency: CurrencyCode;
}

const ITEM_COLUMNS: Column<ItemLine>[] = [
  {
    key: "item",
    header: "Item",
    cell: (line) => (
      <div>
        <p className="font-medium text-slate-900">{line.name}</p>
        <p className="font-mono text-xs text-slate-500">{line.sku}</p>
      </div>
    ),
  },
  {
    key: "quantity",
    header: "Returning",
    cell: (line) => `${line.quantity} of ${line.ordered}`,
    className: "whitespace-nowrap",
  },
  {
    key: "unitPrice",
    header: "Unit price",
    cell: (line) => formatMoney(line.unitPrice, line.currency),
    align: "right",
    className: "whitespace-nowrap",
  },
  {
    key: "lineTotal",
    header: "Line total",
    cell: (line) => formatMoney(line.lineTotal, line.currency),
    align: "right",
    className: "whitespace-nowrap",
  },
  {
    key: "returnable",
    header: "Policy",
    cell: (line) => (
      <Badge tone={line.returnable ? "success" : "danger"}>
        {line.returnable ? "Returnable" : "Final sale"}
      </Badge>
    ),
  },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ReturnDetailPage() {
  const { returnId } = useParams<{ returnId: string }>();
  const store = useDemoStore();

  const request = returnId ? store.getReturn(returnId) : null;

  if (!request) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Return not found"
          back={{ to: "/returns", label: "Back to returns" }}
        />
        <Card>
          <EmptyState
            title="We couldn't find that return request"
            description="It may have been removed, or the link may be wrong. Go back to the queue to pick another one."
          />
        </Card>
      </div>
    );
  }

  const order = store.getOrder(request.orderId);
  const evaluation = store.getEvaluation(request.id);
  const analysis = store.getAnalysis(request.id);
  const refund = store.getRefund(request.id);
  const auditEntries = store.getAuditForReturn(request.id);

  const lines: ItemLine[] = request.items.flatMap((requested) => {
    const item = order?.items.find((candidate) => candidate.id === requested.orderItemId);
    if (!item) return [];
    return [
      {
        id: item.id,
        name: item.name,
        sku: item.sku,
        quantity: requested.quantity,
        ordered: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: multiplyMoney(item.unitPrice, requested.quantity),
        returnable: item.returnable,
        currency: request.currency,
      },
    ];
  });

  const windowLeft = order
    ? returnWindowDaysLeft(order.deliveredAt, store.policy.returnWindowDays, store.now)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        meta={<ReturnStatusBadge status={request.status} />}
        description={`${request.customer.name} · submitted ${formatDateTime(request.submittedAt)}`}
        back={{ to: "/returns", label: "Back to returns" }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title="Customer request"
            description="Written by the customer and shown as plain text."
          >
            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
              {request.customerComment}
            </p>
            <p className="mt-4 text-sm text-slate-500">
              Requested refund:{" "}
              <span className="font-semibold text-slate-900">
                {formatMoney(request.requestedAmount, request.currency)}
              </span>
            </p>
          </Card>

          <Card title="Items in this return" flush>
            <DataTable
              columns={ITEM_COLUMNS}
              rows={lines}
              getRowKey={(line) => line.id}
              caption="Items in this return request"
              empty={
                <EmptyState
                  title="Item details unavailable"
                  description="The related order could not be loaded."
                />
              }
            />
          </Card>

          <Card title="Order and payment">
            {order ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order</dt>
                  <dd className="mt-1 font-medium text-slate-900">{order.orderNumber}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</dt>
                  <dd className="mt-1">
                    <PaymentStatusBadge status={order.paymentStatus} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivered</dt>
                  <dd className="mt-1 text-slate-900">{formatDate(order.deliveredAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order total</dt>
                  <dd className="mt-1 text-slate-900">{formatMoney(order.total, order.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Already refunded</dt>
                  <dd className="mt-1 text-slate-900">
                    {formatMoney(order.refundedAmount, order.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Refundable balance</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {formatMoney(refundableBalance(order.total, order.refundedAmount), order.currency)}
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Return window today ({plural(store.policy.returnWindowDays, "day")} from delivery)
                  </dt>
                  <dd
                    className={`mt-1 ${
                      windowLeft !== null && windowLeft < 0 ? "font-medium text-red-700" : "text-slate-900"
                    }`}
                  >
                    {windowLeft === null
                      ? "Not delivered yet"
                      : windowLeft >= 0
                        ? `${plural(windowLeft, "day")} left`
                        : `Expired ${plural(-windowLeft, "day")} ago`}
                  </dd>
                </div>
              </dl>
            ) : (
              <EmptyState title="Order unavailable" description="The related order could not be loaded." />
            )}
          </Card>

          <PolicyChecklist evaluation={evaluation} />
          <AiAnalysisPanel analysis={analysis} />
        </div>

        <div className="space-y-6">
          <DecisionPanel
            returnRequest={request}
            evaluation={evaluation}
            order={order}
            onStartReview={() => store.startReview(request.id)}
            onApprove={(note) => store.approveReturn(request.id, note)}
            onReject={(note) => store.rejectReturn(request.id, note)}
            onInitiateRefund={() => store.initiateRefund(request.id)}
            demo={store.mode === "demo"}
            refundsAvailable={store.refundsAvailable}
          />
          <RefundTimeline record={refund} />
          <Card title="Audit history">
            <AuditTimeline entries={auditEntries} />
          </Card>
        </div>
      </div>
    </div>
  );
}