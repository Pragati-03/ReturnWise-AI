import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for rejections and other hard-to-undo actions. */
  variant?: "primary" | "danger";
  /** True while the confirmed action is running; blocks dismissing the dialog. */
  loading?: boolean;
  /** Disable confirm until required input (e.g. a rejection note) is valid. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional extra content, such as a note field or an amount summary. */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  function handleClose() {
    // Don't let Escape or a backdrop click interrupt a running action.
    if (!loading) onCancel();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      size="sm"
      closeOnBackdrop={!loading}
      footer={
        <>
          {/* Cancel gets initial focus so Enter never confirms by accident. */}
          <Button variant="secondary" onClick={handleClose} disabled={loading} data-autofocus>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}