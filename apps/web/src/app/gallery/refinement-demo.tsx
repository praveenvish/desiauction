"use client";

import { Button, Field, TaskState, TaskWorkspace } from "@desiauction/ui";
import { useState } from "react";

/** Development-only gallery; the parent layout is absent outside development. */
export function RefinementDemo() {
  const [state, setState] = useState<"accepted" | "pending" | "rejected">("accepted");
  const [name, setName] = useState("");
  return (
    <section aria-labelledby="refinement-h" data-testid="refinement-gallery">
      <h2 id="refinement-h">Task workspace · retained input and honest acknowledgement</h2>
      <TaskWorkspace
        label="Example task"
        supportingLabel="Example evidence"
        supporting={
          <TaskState title="Supporting evidence">
            This panel never holds the only required action. On a phone it follows the work area.
          </TaskState>
        }
      >
        <TaskState
          title={
            state === "accepted"
              ? "Example accepted state"
              : state === "pending"
                ? "Example stored on device · not accepted"
                : "Example rejected · accepted state unchanged"
          }
          tone={state === "accepted" ? "neutral" : "attention"}
          announce
        >
          {state === "accepted"
            ? "Synthetic gallery state. No server write is performed."
            : "Your input stays here. The domain action must supply the actual acknowledgement."}
        </TaskState>
        <Field
          label="Example participant name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div>
          <Button
            type="button"
            onClick={() => {
              setState("pending");
            }}
          >
            Show pending example
          </Button>{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setState("rejected");
            }}
          >
            Show rejected example
          </Button>{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setState("accepted");
            }}
          >
            Reset example
          </Button>
        </div>
      </TaskWorkspace>
      <TaskState
        title="No eligible details"
        actions={<Button type="button">Review context</Button>}
      >
        Missing, private or delayed details are never displayed as zero.
      </TaskState>
      <TaskState title="Permission changed" tone="danger">
        Stop submitting. The existing claim and authority checks decide the next legal action.
      </TaskState>
    </section>
  );
}
