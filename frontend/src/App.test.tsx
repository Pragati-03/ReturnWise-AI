import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App";

function renderApp(path = "/") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}

const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });

describe("navigation", () => {
  it("shows the dashboard with the demo notice", () => {
    renderApp("/");

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/demo data/i);
    expect(screen.getByText("Open returns")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
  });

  it("moves between pages from the sidebar", async () => {
    const { user } = renderApp("/");

    await user.click(within(primaryNav()).getByRole("link", { name: "Returns" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Returns" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Return requests" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RET-1001" })).toBeInTheDocument();

    await user.click(within(primaryNav()).getByRole("link", { name: "Orders" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Orders" })).toBeInTheDocument();
  });

  it("shows a friendly page for unknown routes and unknown returns", () => {
    const first = render(
      <MemoryRouter initialEntries={["/nope"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    first.unmount();

    renderApp("/returns/does-not-exist");
    expect(screen.getByRole("heading", { level: 1, name: "Return not found" })).toBeInTheDocument();
  });

  it("applies the status filter from the URL", () => {
    renderApp("/returns?status=rejected");

    expect(screen.getByRole("combobox", { name: "Filter by status" })).toHaveValue("rejected");
    expect(screen.getByRole("link", { name: "RET-1005" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "RET-1001" })).not.toBeInTheDocument();
  });
});

describe("return detail page", () => {
  it("shows the case with policy, AI analysis and the demo labels", () => {
    renderApp("/returns/ret_1001");

    expect(screen.getByRole("heading", { level: 1, name: "RET-1001" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy eligibility" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI case analysis" })).toBeInTheDocument();
    expect(screen.getByText("Demo content (no AI used)")).toBeInTheDocument();
  });

  it(
    "walks a return through review, approval and a demo refund, and records it in the audit log",
    { timeout: 20_000 },
    async () => {
      const { user } = renderApp("/returns/ret_1001");

      await user.click(screen.getByRole("button", { name: "Start review" }));
      await user.click(await screen.findByRole("button", { name: "Approve" }));

      const approveDialog = await screen.findByRole("dialog", { name: "Approve this return?" });
      await user.click(within(approveDialog).getByRole("button", { name: "Approve return" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(await screen.findByRole("button", { name: "Start refund (demo)" }));
      const refundDialog = await screen.findByRole("dialog", { name: "Start refund (demo)?" });
      await user.click(within(refundDialog).getByRole("button", { name: "Start refund" }));

      expect(await screen.findByText(/Refund is pending\. In demo mode/)).toBeInTheDocument();
      expect(screen.getByText("Refund started.")).toBeInTheDocument();
      // The demo must never show a completed refund.
      expect(screen.queryByText("Refunded")).not.toBeInTheDocument();

      // The state survives navigation and the action is in the audit log.
      await user.click(within(primaryNav()).getByRole("link", { name: "Audit log" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Audit log" })).toBeInTheDocument();
      await user.type(screen.getByRole("searchbox", { name: "Search audit log" }), "marked pending");
      expect(
        await screen.findByText("Refund marked pending (demo state, no PayPal request sent)."),
      ).toBeInTheDocument();
    },
  );

  it("blocks approval for a request that failed the policy check", async () => {
    const { user } = renderApp("/returns/ret_1003");

    await user.click(screen.getByRole("button", { name: "Start review" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/failed the policy checks/i)).toBeInTheDocument();
  });

  it("requires a note before a rejection can be confirmed", { timeout: 20_000 }, async () => {
    const { user } = renderApp("/returns/ret_1003");

    await user.click(screen.getByRole("button", { name: "Start review" }));
    await user.click(await screen.findByRole("button", { name: "Reject" }));

    const dialog = await screen.findByRole("dialog", { name: "Reject this return?" });
    const confirm = within(dialog).getByRole("button", { name: "Reject return" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/decision note/i), "Outside the return window");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(
      await screen.findByText("Return rejected and recorded in the audit history."),
    ).toBeInTheDocument();
  });
});

describe("mobile menu", () => {
  it("opens as a dialog, closes on Escape and returns focus to the menu button", async () => {
    const { user } = renderApp("/");

    const openButton = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(openButton);
    expect(await screen.findByRole("dialog", { name: "Navigation menu" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument(),
    );
    expect(openButton).toHaveFocus();
  });
});