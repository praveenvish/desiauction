import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskState, TaskWorkspace } from "./task-workspace";

describe("Task workspace semantics", () => {
  it("keeps the task and evidence separately named without adding a page heading", () => {
    render(
      <TaskWorkspace
        label="Record a delivery"
        supportingLabel="Accepted history"
        supporting="No deliveries yet"
      >
        <button type="button">Record four</button>
      </TaskWorkspace>,
    );
    expect(screen.getByRole("region", { name: "Record a delivery" })).toContainElement(
      screen.getByRole("button", { name: "Record four" }),
    );
    expect(screen.getByRole("complementary", { name: "Accepted history" })).toHaveTextContent(
      "No deliveries yet",
    );
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
  it("does not create an empty support landmark", () => {
    render(<TaskWorkspace label="Current task">Work</TaskWorkspace>);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
  it("announces a changed state only when requested and leaves recovery outside the live region", () => {
    const { rerender } = render(<TaskState title="Accepted">Last accepted sequence 12</TaskState>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <TaskState
        title="Stored on device"
        announce
        actions={<button type="button">Review pending</button>}
      >
        Not accepted by the server
      </TaskState>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Not accepted by the server");
    expect(screen.getByRole("status")).not.toContainElement(screen.getByRole("button"));
  });
});
