import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, sortRows, toggleSort, type Column } from "./Table";

interface Row {
  id: string;
  name: string;
  amount: number;
  note: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Item 10", amount: 30, note: "x" },
  { id: "b", name: "Item 2", amount: 10, note: "y" },
  { id: "c", name: "Item 1", amount: 20, note: "z" },
  { id: "d", name: "Item 3", amount: 20, note: "w" },
];

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "amount", header: "Amount", cell: (r) => r.amount, sortValue: (r) => r.amount, align: "right" },
  { key: "note", header: "Note", cell: (r) => r.note },
];

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("toggleSort", () => {
  it("starts a new column ascending", () => {
    expect(toggleSort(null, "name")).toEqual({ key: "name", direction: "asc" });
    expect(toggleSort({ key: "amount", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });

  it("flips direction when the active column is clicked again", () => {
    expect(toggleSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(toggleSort({ key: "name", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  it("sorts numbers ascending and descending", () => {
    expect(ids(sortRows(ROWS, COLUMNS, { key: "amount", direction: "asc" }))).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(ids(sortRows(ROWS, COLUMNS, { key: "amount", direction: "desc" }))).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  it("sorts text in a number-aware way (Item 2 before Item 10)", () => {
    expect(ids(sortRows(ROWS, COLUMNS, { key: "name", direction: "asc" }))).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("keeps the original order for equal values (stable)", () => {
    // c and d both have amount 20; c comes first in the input.
    const result = ids(sortRows(ROWS, COLUMNS, { key: "amount", direction: "asc" }));
    expect(result.indexOf("c")).toBeLessThan(result.indexOf("d"));
  });

  it("does not mutate the input array", () => {
    const before = ids(ROWS);
    sortRows(ROWS, COLUMNS, { key: "amount", direction: "desc" });
    expect(ids(ROWS)).toEqual(before);
  });

  it("returns the rows unchanged when there is nothing to sort by", () => {
    expect(sortRows(ROWS, COLUMNS, null)).toBe(ROWS);
    expect(sortRows(ROWS, COLUMNS, { key: "note", direction: "asc" })).toBe(ROWS); // no sortValue
    expect(sortRows(ROWS, COLUMNS, { key: "missing", direction: "asc" })).toBe(ROWS);
  });
});

describe("DataTable", () => {
  it("renders a named table with a header row and one row per item", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} caption="Test rows" />);

    expect(screen.getByRole("table", { name: "Test rows" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(screen.getByText("Item 10")).toBeInTheDocument();
  });

  it("renders plain headers when sorting is not wired up", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} caption="Test rows" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("marks the sorted column with aria-sort and only sortable columns get buttons", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        caption="Test rows"
        sort={{ key: "amount", direction: "desc" }}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toHaveAttribute("aria-sort");
    expect(
      within(screen.getByRole("columnheader", { name: "Note" })).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("asks for the next sort state when a header button is clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        caption="Test rows"
        sort={null}
        onSortChange={onSortChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "asc" });

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        caption="Test rows"
        sort={{ key: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "desc" });
  });

  it("shows the empty content instead of a table when there are no rows", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        caption="Test rows"
        empty={<p>Nothing here</p>}
      />,
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});