import { useState } from "react";
import { Banknote, Check, ClipboardCheck, RotateCcw, X } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PaymentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/FormField";
import type { ActionResult } from "@/lib/demoStore";
import { formatMoney, refundableBalance } from "@/lib/format";
import type { Order, PolicyEvaluation, ReturnRequest } from "@/types";

type DialogKind = "approve" | "reject" | "refund";

interface DecisionPanelProps {
  returnRequest: ReturnRequest;
  evaluation: PolicyEvaluation | null;
  order: Order | null;
  onStartReview: () => Promise<ActionResult>;
  onApprove: (note: string) => Promise<ActionResult>;
  onReject: (note: string) => Promise<ActionResult>;
  onInitiateRefund: () => Promise<ActionResult>;
  /** Demo wording for refund actions. Phase 5 passes false for real sandbox refunds. */
  demo?: boolean;
}

const SUCCESS_MESSAGES: Record<DialogKind | "review", string> = {
  review: "Review started.",
  approve: "Return approved. The refund is a separate step.",
  reject: "Return rejected and recorded in the audit history.",
  refund: "Refund started.",
};

export function DecisionPanel({
  returnRequest,
  evaluation,
  order,
  onStartReview,
  onApprove,
  onReject,
  onInitiateRefund,
  demo = true,
}: DecisionPanelProps) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { status } = returnRequest;
  const eligible = evaluation?.eligible ?? false;
  const amount = formatMoney(returnRequest.requestedAmount, returnRequest.currency);

  function openDialog(kind: DialogKind) {
    setNote("");
    setError(null);
    setNotice(null);
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    setNote("");
    setError(null);
  }

  async function handleStartReview() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await onStartReview();
    setBusy(false);
    if (result.ok) setNotice(SUCCESS_MESSAGES.review);
    else setError(result.error);
  }

  async function handleConfirm() {
    if (!dialog) return;
    setBusy(true);
    setError(null);

    let result: ActionResult;
    if (dialog === "approve") result = await onApprove(note.trim());
    else if (dialog === "reject") result = await onReject(note.trim());
    else result = await onInitiateRefund();

    setBusy(false);
    if (result.ok) {
      setNotice(SUCCESS_MESSAGES[dialog]);
      closeDialog();
    } else {
      setError(result.error);
    }
  }

  const refundable = order ? refundableBalance(order.total, order.refundedAmount) : null;

  const dialogCopy = {
    approve: {
      title: "Approve this return?",
      description: `Approve ${returnRequest.reference} for ${amount}? Approving does not issue a refund; that is a separate step.`,
      confirmLabel: "Approve return",
      variant: "primary" as const,
    },
    reject: {
      title: "Reject this return?",
      description:
        "The request will be closed and no refund will be issued. Your note is saved in the audit history.",
      confirmLabel: "Reject return",
      variant: "danger" as const,
    },
    refund: {
      title: demo ? "Start refund (demo)?" : "Start refund?",
      description: demo
        ? `Demo mode: this marks a ${amount} refund as pending in the demo only. No PayPal request is sent and no money moves.`
        : `This sends a refund request for ${amount} to PayPal.`,
      confirmLabel: "Start refund",
      variant: "primary" as const,
    },
  };

  const activeCopy = dialog ? dialogCopy[dialog] : null;
  const showNoteField = dialog === "approve" || dialog === "reject";

  function renderBody() {
    switch (status) {
      case "submitted":
        return (
          <>
            <p className="text-sm text-slate-600">
              This request is waiting for you. Start the review to decide on it.
            </p>
            <Button
              onClick={handleStartReview}
              loading={busy}
              icon={<ClipboardCheck size={16} />}
            >
              Start review
            </Button>
          </>
        );

      case "under_review":
        return (
          <>
            {evaluation && !eligible && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Approval is unavailable because this request failed the policy checks. You can
                still reject it.
              </p>
            )}
            {!evaluation && (
              <p className="text-sm text-slate-600">
                No policy result is available, so approval is unavailable.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => openDialog("approve")}
                disabled={!eligible}
                icon={<Check size={16} />}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                onClick={() => openDialog("reject")}
                icon={<X size={16} />}
              >
                Reject
              </Button>
            </div>
          </>
        );

      case "approved":
      case "refund_failed":
        return (
          <>
            <p className="text-sm text-slate-600">
              {status === "approved"
                ? "Approved. Start the refund when you are ready."
                : "The last refund attempt failed. You can retry it."}
            </p>
            {order && refundable !== null && (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Order payment
                  </dt>
                  <dd className="mt-1">
                    <PaymentStatusBadge status={order.paymentStatus} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Refundable balance
                  </dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {formatMoney(refundable, order.currency)}
                  </dd>
                </div>
              </dl>
            )}
            <Button
              onClick={() => openDialog("refund")}
              icon={status === "approved" ? <Banknote size={16} /> : <RotateCcw size={16} />}
            >
              {status === "approved"
                ? demo ? "Start refund (demo)" : "Start refund"
                : demo ? "Retry refund (demo)" : "Retry refund"}
            </Button>
          </>
        );

      case "refund_pending":
        return (
          <p className="text-sm text-slate-600">
            {demo
              ? "Refund is pending. In demo mode nothing confirms it, because no PayPal request is sent. A verified sandbox refund is added in the PayPal integration phase."
              : "Refund is pending. It is marked complete only after PayPal confirms it."}
          </p>
        );

      case "refunded":
        return (
          <p className="text-sm text-slate-600">
            {demo
              ? "Closed. This refund is shown as completed in demo data only; no real PayPal transaction exists."
              : "Closed. The refund was confirmed by PayPal."}
          </p>
        );

      case "rejected":
        return <p className="text-sm text-slate-600">Closed. This request was rejected.</p>;
    }
  }

  return (
    <Card
      title="Seller decision"
      description="You decide. Policy checks and AI suggestions inform the decision but never approve or pay on your behalf."
    >
      <div className="space-y-4">
        {renderBody()}

        {returnRequest.decisionNote && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Decision note
            </p>
            {/* Plain text: notes are free-form input. */}
            <p className="mt-1 text-slate-700">{returnRequest.decisionNote}</p>
          </div>
        )}

        {notice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        {error && !dialog && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
      </div>

      {activeCopy && (
        <ConfirmDialog
          open
          title={activeCopy.title}
          description={activeCopy.description}
          confirmLabel={activeCopy.confirmLabel}
          variant={activeCopy.variant}
          loading={busy}
          confirmDisabled={dialog === "reject" && note.trim().length === 0}
          onConfirm={handleConfirm}
          onCancel={closeDialog}
        >
          <div className="space-y-3">
            {showNoteField && (
              <Textarea
                label={dialog === "reject" ? "Decision note (required)" : "Decision note (optional)"}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                hint="Saved with the decision. Do not include card numbers or other sensitive data."
              />
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}
          </div>
        </ConfirmDialog>
      )}
    </Card>
  );
}