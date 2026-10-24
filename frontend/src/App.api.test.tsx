import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
  listOrders: vi.fn(),
  listReturns: vi.fn(),
  getPolicy: vi.fn(),
  listAudit: vi.fn(),
  getMetrics: vi.fn(),
  getEvaluation: vi.fn(),
  startReview: vi.fn(),
  approveReturn: vi.fn(),
  rejectReturn: vi.fn(),
  updatePolicy: vi.fn(),
  setAuthTokenProvider: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  isApiConfigured: true,
  API_BASE_URL: "http://api.test",
  api: {
    login: mocks.login,
    register: mocks.register,
    me: mocks.me,
    listOrders: mocks.listOrders,
    listReturns: mocks.listReturns,
    getPolicy: mocks.getPolicy,
    listAudit: mocks.listAudit,
    getMetrics: mocks.getMetrics,
    getEvaluation: mocks.getEvaluation,
    startReview: mocks.startReview,
    approveReturn: mocks.approveReturn,
    rejectReturn: mocks.rejectReturn,
    updatePolicy: mocks.updatePolicy,
  },
  describeError: (error: unknown) =>
    error instanceof Error ? error.message : "Something unexpected went wrong. Please try again.",
  setAuthTokenProvider: mocks.setAuthTokenProvider,
  setUnauthorizedHandler: mocks.setUnauthorizedHandler,
}));

import App from "./App";
import type {
  AuditEntry,
  DashboardMetrics,
  Order,
  PolicyEvaluation,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

/* ---------- fake backend ---------- */

const PASSWORD = "correct horse battery";
const USER = { id: "usr_1", email: "asha@example.com", displayName: "Asha" };
const CUSTOMER = { id: "cus_1", name: "Aarav", email: "aarav@example.com" };
const POLICY: ReturnPolicy = {
  returnWindowDays: 30,
  requirePaymentCaptured: true,
  allowPartialRefunds: true,
  manualReviewThreshold: "150.00",
  currency: "USD",
  restockingFeePercent: 0,
};

function makeReturn(over: Partial<ReturnRequest>): ReturnRequest {
  return {
    id: "ret_1",
    reference: "RET-1001",
    orderId: "ord_1",
    customer: CUSTOMER,
    status: "submitted",
    items: [{ orderItemId: "itm_1", quantity: 1 }],
    customerComment: "It stopped working.",
    requestedAmount: "79.99",
    currency: "USD",
    submittedAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    decisionNote: null,
    ...over,
  };
}

function makeOrder(id: string, number: string, itemId: string, name: string): Order {
  return {
    id,
    orderNumber: number,
    customer: CUSTOMER,
    items: [{ id: itemId, sku: name.toUpperCase(), name, quantity: 1, unitPrice: "79.99", returnable: true }],
    currency: "USD",
    total: "79.99",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-10T09:00:00Z",
    deliveredAt: "2026-09-12T09:00:00Z",
  };
}

function makeEvaluation(returnId: string, eligible: boolean): PolicyEvaluation {
  return {
    returnId,
    eligible,
    evaluatedAt: "2026-10-01T09:01:00Z",
    checks: [
      {
        code: eligible ? "WITHIN_RETURN_WINDOW" : "RETURN_WINDOW_EXPIRED",
        label: "Within return window",
        passed: eligible,
        detail: eligible ? "Delivered 19 days ago; policy allows 30 days." : "Delivered 51 days ago; policy allows 30 days.",
      },
    ],
  };
}

function metricsFor(returns: ReturnRequest[]): DashboardMetrics {
  const byStatus: Record<ReturnStatus, number> = {
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    refund_pending: 0,
    refunded: 0,
    refund_failed: 0,
  };
  for (const item of returns) byStatus[item.status] += 1;
  return {
    openReturns: returns.filter((item) => item.status !== "rejected" && item.status !== "refunded").length,
    awaitingReview: byStatus.submitted + byStatus.under_review,
    refundsPending: byStatus.refund_pending,
    refundedThisMonth: "0.00",
    currency: "USD",
    avgDecisionHours: 0,
    returnsByStatus: byStatus,
  };
}

interface Server {
  returns: ReturnRequest[];
  orders: Order[];
  evaluations: Record<string, PolicyEvaluation>;
  audit: AuditEntry[];
  policy: ReturnPolicy;
}

let server: Server;

function change(id: string, patch: Partial<ReturnRequest>): ReturnRequest {
  const index = server.returns.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Return request not found.");
  const updated = { ...server.returns[index], ...patch, updatedAt: new Date().toISOString() };
  server.returns[index] = updated;
  return updated;
}

beforeEach(() => {
  vi.resetAllMocks();

  server = {
    returns: [
      makeReturn({}),
      makeReturn({ id: "ret_2", reference: "RET-1002", orderId: "ord_2", items: [{ orderItemId: "itm_2", quantity: 1 }] }),
    ],
    orders: [makeOrder("ord_1", "RW-2001", "itm_1", "Earbuds"), makeOrder("ord_2", "RW-2002", "itm_2", "Watch")],
    evaluations: { ret_1: makeEvaluation("ret_1", true), ret_2: makeEvaluation("ret_2", false) },
    audit: [
      {
        id: "aud_1",
        returnId: "ret_1",
        eventType: "return_submitted",
        actorType: "seller",
        actorName: "Asha",
        description: "Return request RET-1001 submitted.",
        fromStatus: null,
        toStatus: "submitted",
        occurredAt: "2026-10-01T09:00:00Z",
      },
    ],
    policy: { ...POLICY },
  };

  mocks.login.mockImplementation(async (email: string, password: string) => {
    if (email !== USER.email || password !== PASSWORD) throw new Error("Incorrect email or password.");
    return { accessToken: "tok-1", tokenType: "bearer", expiresIn: 3600 };
  });
  mocks.register.mockImplementation(async (email: string, _password: string, displayName: string) => ({
    id: "usr_1",
    email,
    displayName,
  }));
  mocks.me.mockImplementation(async () => USER);
  mocks.listOrders.mockImplementation(async () => server.orders);
  mocks.listReturns.mockImplementation(async () => server.returns);
  mocks.getPolicy.mockImplementation(async () => server.policy);
  mocks.listAudit.mockImplementation(async () => server.audit);
  mocks.getMetrics.mockImplementation(async () => metricsFor(server.returns));
  mocks.getEvaluation.mockImplementation(async (id: string) => server.evaluations[id]);
  mocks.startReview.mockImplementation(async (id: string) => change(id, { status: "under_review" }));
  mocks.approveReturn.mockImplementation(async (id: string, note: string) =>
    change(id, { status: "approved", decisionNote: note || null }),
  );
  mocks.rejectReturn.mockImplementation(async (id: string, note: string) =>
    change(id, { status: "rejected", decisionNote: note }),
  );
  mocks.updatePolicy.mockImplementation(async (next: ReturnPolicy) => {
    server.policy = { ...next };
    return server.policy;
  });
});

/* ---------- helpers ---------- */

function renderApp(path = "/") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}

type User = ReturnType<typeof userEvent.setup>;

async function signIn(user: User, password: string = PASSWORD) {
  await user.type(screen.getByLabelText("Email"), USER.email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

async function signInAndWait(user: User) {
  await signIn(user);
  await screen.findByRole("button", { name: "Sign out" });
}

/* ---------- sign in ---------- */

describe("sign in", () => {
  it("shows the login page first, with the demo escape hatch", () => {
    renderApp();

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Backend: http://api.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use demo data instead" })).toBeInTheDocument();
    expect(mocks.listOrders).not.toHaveBeenCalled(); // no data is requested before signing in
  });

  it("checks the form before calling the server", async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("shows the server's message for a wrong password and stays on the page", async () => {
    const { user } = renderApp();

    await signIn(user, "wrong password here");

    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(mocks.listOrders).not.toHaveBeenCalled();
  });

  it("opens the dashboard in API mode: real data, no demo labels", async () => {
    const { user } = renderApp();

    await signInAndWait(user);

    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(mocks.login).toHaveBeenCalledWith(USER.email, PASSWORD);
    expect(mocks.me).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Connected to your account")).toBeInTheDocument();
    expect(screen.getByText("Waiting for PayPal to confirm")).toBeInTheDocument();
    expect(screen.queryByText(/Demo: nothing sent to PayPal/)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument(); // no demo banner
    expect(screen.queryByText("Demo mode")).not.toBeInTheDocument();
  });

  it("signs out and returns to the login page", async () => {
    const { user } = renderApp();
    await signInAndWait(user);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("returns to the login page with a notice when the session expires", async () => {
    const { user } = renderApp();
    await signInAndWait(user);

    const expire = mocks.setUnauthorizedHandler.mock.calls[0][0] as () => void;
    act(() => expire());

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Your session expired. Please sign in again.")).toBeInTheDocument();
  });
});

/* ---------- create account ---------- */

describe("create account", () => {
  async function openSignUp(user: User) {
    await user.click(screen.getByRole("button", { name: "Need an account? Create one" }));
    expect(screen.getByRole("heading", { level: 1, name: "Create your seller account" })).toBeInTheDocument();
  }

  it("enforces the password rules before calling the server", async () => {
    const { user } = renderApp();
    await openSignUp(user);

    await user.type(screen.getByLabelText("Your name"), "Asha");
    await user.type(screen.getByLabelText("Email"), USER.email);
    const password = screen.getByLabelText("Password");
    await user.type(password, "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();

    await user.clear(password);
    await user.type(password, "a".repeat(73));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/at most 72 bytes/)).toBeInTheDocument();

    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("creates the account and signs in", async () => {
    const { user } = renderApp();
    await openSignUp(user);

    await user.type(screen.getByLabelText("Your name"), "Asha");
    await user.type(screen.getByLabelText("Email"), USER.email);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(mocks.register).toHaveBeenCalledWith(USER.email, PASSWORD, "Asha");
    expect(mocks.login).toHaveBeenCalledWith(USER.email, PASSWORD);
  });
});

/* ---------- working a return ---------- */

describe("working a return", () => {
  it(
    "reviews and approves an eligible return, with no refund button and no PayPal ID",
    { timeout: 20_000 },
    async () => {
      const { user } = renderApp("/returns/ret_1");
      await signIn(user);
      expect(await screen.findByRole("heading", { level: 1, name: "RET-1001" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Start review" }));
      await user.click(await screen.findByRole("button", { name: "Approve" }));
      const dialog = await screen.findByRole("dialog", { name: "Approve this return?" });
      await user.click(within(dialog).getByRole("button", { name: "Approve return" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(mocks.startReview).toHaveBeenCalledWith("ret_1");
      expect(mocks.approveReturn).toHaveBeenCalledWith("ret_1", "");
      expect(
        await screen.findByText(
          "Approved. Refunds will be available when the PayPal integration is added.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
      expect(screen.getByText("Not issued")).toBeInTheDocument(); // no PayPal refund ID
      expect(screen.getByText("Available once the PayPal integration is added.")).toBeInTheDocument();
    },
  );

  it("does not let a request that failed the policy checks be approved", async () => {
    const { user } = renderApp("/returns/ret_2");
    await signIn(user);
    await screen.findByRole("heading", { level: 1, name: "RET-1002" });

    await user.click(screen.getByRole("button", { name: "Start review" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/failed the policy checks/)).toBeInTheDocument();
    expect(mocks.approveReturn).not.toHaveBeenCalled();
  });

  it("requires a note to reject", { timeout: 20_000 }, async () => {
    const { user } = renderApp("/returns/ret_2");
    await signIn(user);
    await screen.findByRole("heading", { level: 1, name: "RET-1002" });

    await user.click(screen.getByRole("button", { name: "Start review" }));
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject this return?" });
    const confirm = within(dialog).getByRole("button", { name: "Reject return" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/decision note/i), "Final sale item");
    await user.click(confirm);

    expect(await screen.findByText("Return rejected and recorded in the audit history.")).toBeInTheDocument();
    expect(mocks.rejectReturn).toHaveBeenCalledWith("ret_2", "Final sale item");
  });
});

/* ---------- settings ---------- */

describe("settings", () => {
  it("saves the policy in API mode, with no demo reset card", { timeout: 20_000 }, async () => {
    const { user } = renderApp("/settings");
    await signIn(user);
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    expect(
      screen.getByText(/Existing requests keep the result they were checked with/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset demo data" })).not.toBeInTheDocument();

    const days = screen.getByLabelText("Return window (days)");
    await user.clear(days);
    await user.type(days, "14");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Policy saved and recorded in the audit log.")).toBeInTheDocument();
    expect(mocks.updatePolicy).toHaveBeenCalledWith({
      returnWindowDays: 14,
      requirePaymentCaptured: true,
      allowPartialRefunds: true,
      manualReviewThreshold: "150.00",
      currency: "USD",
      restockingFeePercent: 0,
    });
  });
});

/* ---------- falling back to demo mode ---------- */

describe("demo mode fallback", () => {
  it("uses demo data from the login page, with the demo wording and reset card intact", async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole("button", { name: "Use demo data instead" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/demo data/i);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.listOrders).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Reset demo data" })).toBeInTheDocument();
  });

  it("offers demo data when the backend cannot be reached", async () => {
    mocks.listOrders.mockRejectedValue(
      new Error("Could not reach the server. Check your connection and try again."),
    );
    const { user } = renderApp();
    await signIn(user);

    expect(await screen.findByText("Couldn't load your data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use demo data" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/demo data/i);
  });
});