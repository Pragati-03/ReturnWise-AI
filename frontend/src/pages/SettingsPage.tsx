import { useEffect, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/FormField";
import { useDemoStore } from "@/lib/demoStore";
import { toMinorUnits } from "@/lib/format";
import type { ReturnPolicy } from "@/types";

interface PolicyForm {
  returnWindowDays: string;
  manualReviewThreshold: string;
  restockingFeePercent: string;
  requirePaymentCaptured: boolean;
  allowPartialRefunds: boolean;
}

type FormErrors = Partial<
  Record<"returnWindowDays" | "manualReviewThreshold" | "restockingFeePercent", string>
>;

function toForm(policy: ReturnPolicy): PolicyForm {
  return {
    returnWindowDays: String(policy.returnWindowDays),
    manualReviewThreshold: policy.manualReviewThreshold,
    restockingFeePercent: String(policy.restockingFeePercent),
    requirePaymentCaptured: policy.requirePaymentCaptured,
    allowPartialRefunds: policy.allowPartialRefunds,
  };
}

function validate(form: PolicyForm): FormErrors {
  const errors: FormErrors = {};

  const days = form.returnWindowDays.trim();
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) {
    errors.returnWindowDays = "Enter a whole number of days between 1 and 365.";
  }

  try {
    if (toMinorUnits(form.manualReviewThreshold) < 0n) throw new Error("negative");
  } catch {
    errors.manualReviewThreshold = "Enter a valid amount such as 150.00.";
  }

  const fee = Number(form.restockingFeePercent);
  if (form.restockingFeePercent.trim() === "" || !Number.isFinite(fee) || fee < 0 || fee > 100) {
    errors.restockingFeePercent = "Enter a percentage between 0 and 100.";
  }

  return errors;
}

export function SettingsPage() {
  const { policy, updatePolicy, resetDemo } = useDemoStore();

  const [form, setForm] = useState<PolicyForm>(() => toForm(policy));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Re-sync the form whenever the saved policy changes (after saving or a demo reset).
  useEffect(() => {
    setForm(toForm(policy));
    setErrors({});
  }, [policy]);

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(policy));

  function update<K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = await updatePolicy({
      ...policy,
      returnWindowDays: Number(form.returnWindowDays),
      manualReviewThreshold: form.manualReviewThreshold.trim(),
      restockingFeePercent: Number(form.restockingFeePercent),
      requirePaymentCaptured: form.requirePaymentCaptured,
      allowPartialRefunds: form.allowPartialRefunds,
    });
    setSaving(false);

    if (result.ok) setNotice("Policy saved and recorded in the audit log.");
    else setFormError(result.error);
  }

  function handleRevert() {
    setForm(toForm(policy));
    setErrors({});
    setFormError(null);
    setNotice(null);
  }

  function handleResetDemo() {
    resetDemo();
    setResetOpen(false);
    setNotice("Demo data was reset to its original state.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure the return policy used to check each request."
      />

      <Card
        title="Return policy"
        description="Demo mode: saving updates these settings and the audit log only. Demo eligibility results are fixed sample data and are not re-evaluated. The real policy engine arrives with the backend."
      >
        <form onSubmit={handleSubmit} noValidate className="max-w-xl space-y-5">
          <Input
            label="Return window (days)"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={form.returnWindowDays}
            onChange={(event) => update("returnWindowDays", event.target.value)}
            error={errors.returnWindowDays}
            hint="Days after delivery during which a return can be requested."
          />

          <Input
            label="Manual review threshold"
            inputMode="decimal"
            value={form.manualReviewThreshold}
            onChange={(event) => update("manualReviewThreshold", event.target.value)}
            error={errors.manualReviewThreshold}
            hint={`Amounts above this are flagged for manual review. Currency: ${policy.currency}.`}
          />

          <Input
            label="Restocking fee (%)"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            max={100}
            value={form.restockingFeePercent}
            onChange={(event) => update("restockingFeePercent", event.target.value)}
            error={errors.restockingFeePercent}
            hint="Saved for the future backend. It is not applied to demo refund amounts."
          />

          <div className="space-y-4">
            <Checkbox
              label="Require captured payment"
              hint="Refunds are only allowed when the order's payment has been captured."
              checked={form.requirePaymentCaptured}
              onChange={(event) => update("requirePaymentCaptured", event.target.checked)}
            />
            <Checkbox
              label="Allow partial refunds"
              hint="Let sellers refund part of an order instead of the full amount."
              checked={form.allowPartialRefunds}
              onChange={(event) => update("allowPartialRefunds", event.target.checked)}
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {formError}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              {notice}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving} disabled={!dirty}>
              Save changes
            </Button>
            <Button variant="secondary" onClick={handleRevert} disabled={!dirty || saving}>
              Discard changes
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Demo data"
        description="Everything in this demo lives in memory only, so a page refresh also resets it."
      >
        <Button variant="danger" onClick={() => setResetOpen(true)}>
          Reset demo data
        </Button>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        title="Reset demo data?"
        description="Decisions, refund states, audit entries and policy changes you made in this demo will be discarded."
        confirmLabel="Reset demo data"
        variant="danger"
        onConfirm={handleResetDemo}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}