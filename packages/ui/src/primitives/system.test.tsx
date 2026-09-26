import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { statusState } from "./console-kit";
import { EmptyState } from "./empty-state";
import { ListRow } from "./list-row";
import { Pager, pageWindow } from "./pager";

describe("Pager", () => {
  it("windows the pages around the current one", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(3, 12)).toEqual([1, 2, 3, 4, null, 12]);
  });

  it("says what is shown and links every page", () => {
    render(
      <Pager
        total={43}
        page={2}
        pageCount={2}
        pageSize={25}
        hrefFor={(n) => `/players?page=${String(n)}`}
        summaryTestId="summary"
      />,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("Showing 26–43 of 43");
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute("href", "/players?page=1");
    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
  });

  it("infers the window from the rows shown when the size is unknown", () => {
    render(
      <Pager total={30} page={3} pageCount={3} shown={6} hrefFor={(n) => `?p=${String(n)}`} />,
    );
    expect(screen.getByText("Showing 25–30 of 30")).toBeInTheDocument();
  });

  it("drives a client desk through onPage", () => {
    const onPage = vi.fn();
    render(<Pager total={60} page={1} pageCount={3} pageSize={25} onPage={onPage} />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onPage.mock.calls).toEqual([[2], [3]]);
  });

  it("pages a keyset list with First / Next", () => {
    render(<Pager total={349} shown={50} nextHref="/admin/orgs?after=x" firstHref={null} />);
    expect(screen.getByText("Showing 50 of 349")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/admin/orgs?after=x",
    );
  });
});

describe("EmptyState", () => {
  it("draws the tile, the title and both doors", () => {
    render(
      <EmptyState
        title="No pass requests"
        description="They appear here."
        action={<a href="/a">Primary</a>}
        secondaryAction={<a href="/b">Secondary</a>}
        testId="empty"
      />,
    );
    const empty = screen.getByTestId("empty");
    expect(screen.getByRole("heading", { name: "No pass requests" })).toBeInTheDocument();
    expect(empty.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});

describe("ListRow", () => {
  it("is a link when given an href", () => {
    render(<ListRow title="Sanjay" meta="Thane" figure="12" href="/u/1" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/u/1");
  });
});

describe("statusState", () => {
  it("gives every domain status one state", () => {
    expect(statusState("completed")).toBe("complete");
    expect(statusState("settled")).toBe("complete");
    expect(statusState("UNSOLD")).toBe("unsold");
    expect(statusState("waitlisted")).toBe("pending");
    expect(statusState("rejected")).toBe("error");
    expect(statusState("draft")).toBeNull();
  });
});
