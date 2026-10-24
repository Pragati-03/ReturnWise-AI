import { useState, type FormEvent } from "react";

import { Brand } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/FormField";
import { API_BASE_URL } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

type Mode = "signin" | "signup";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72; // bcrypt's limit, enforced by the backend too
const MAX_NAME_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Form {
  email: string;
  password: string;
  displayName: string;
}

type Errors = Partial<Record<keyof Form, string>>;

function validate(mode: Mode, form: Form): Errors {
  const errors: Errors = {};

  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Enter a valid email address.";

  if (mode === "signin") {
    if (form.password === "") errors.password = "Enter your password.";
  } else {
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (new TextEncoder().encode(form.password).length > MAX_PASSWORD_BYTES) {
      errors.password = `Use at most ${MAX_PASSWORD_BYTES} bytes (shorter if it has accented or non-Latin characters).`;
    }
    const name = form.displayName.trim();
    if (name === "") errors.displayName = "Enter a name.";
    else if (name.length > MAX_NAME_LENGTH) errors.displayName = `Use at most ${MAX_NAME_LENGTH} characters.`;
  }
  return errors;
}

interface LoginPageProps {
  onUseDemo: () => void;
}

export function LoginPage({ onUseDemo }: LoginPageProps) {
  const { signIn, signUp, notice } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [form, setForm] = useState<Form>({ email: "", password: "", displayName: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof Form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const found = validate(mode, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const email = form.email.trim();
    // Passwords are never trimmed or altered.
    const result =
      mode === "signin"
        ? await signIn(email, form.password)
        : await signUp(email, form.password, form.displayName.trim());

    // On success this page is replaced, so only an error needs handling here.
    if (!result.ok) {
      setBusy(false);
      setFormError(result.error);
    }
  }

  const signingIn = mode === "signin";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Brand />
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {signingIn ? "Sign in" : "Create your seller account"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {signingIn
              ? "Sign in to manage your returns and refunds."
              : "Accounts are for sellers. Your data stays private to your account."}
          </p>

          {notice && (
            <p
              role="status"
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {notice}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {!signingIn && (
              <Input
                label="Your name"
                autoComplete="name"
                value={form.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                error={errors.displayName}
              />
            )}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              error={errors.email}
            />
            <Input
              label="Password"
              type="password"
              autoComplete={signingIn ? "current-password" : "new-password"}
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              error={errors.password}
              hint={signingIn ? undefined : `At least ${MIN_PASSWORD_LENGTH} characters.`}
            />

            {formError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {formError}
              </p>
            )}

            <Button type="submit" loading={busy} className="w-full">
              {signingIn ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Button variant="ghost" size="sm" onClick={() => switchMode(signingIn ? "signup" : "signin")}>
              {signingIn ? "Need an account? Create one" : "Already have an account? Sign in"}
            </Button>
          </div>
        </div>

        <div className="space-y-2 text-center">
          <Button variant="secondary" onClick={onUseDemo}>
            Use demo data instead
          </Button>
          <p className="text-xs text-slate-500">
            No account needed. Sample data only, and nothing is sent to the server.
          </p>
          <p className="text-xs text-slate-400">Backend: {API_BASE_URL}</p>
        </div>
      </div>
    </main>
  );
}