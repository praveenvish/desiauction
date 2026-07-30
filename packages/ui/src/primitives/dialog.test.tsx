import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("opens as a modal with an accessible title", () => {
    render(
      <Dialog open onClose={() => undefined} title="Remove player?">
        <p>This cannot be undone.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Remove player?");
    expect(screen.getByText("This cannot be undone.")).toBeVisible();
  });

  it("renders footer actions", () => {
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="Confirm"
        footer={<Button variant="danger">Remove</Button>}
      >
        body
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  /**
   * A click on the dialog's own padding — or the gap beside a footer button —
   * also targets the <dialog> element, so targeting alone cannot tell a
   * backdrop click from a near-miss. Dismissing on a near-miss threw away a
   * half-filled Add-player form when the click landed a few pixels short.
   */
  it("closes on a click OUTSIDE its box, not on a near-miss inside it", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 400,
      top: 100,
      bottom: 400,
      x: 100,
      y: 100,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    });

    fireEvent.click(dialog, { clientX: 250, clientY: 380 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Escape and a backdrop click used to be the only two exits, and a phone has
   * neither: at 390px the dialog is min(480px, 100vw - 32px), so the backdrop
   * is a ~16px strip down each side, and there is no Escape key on touch. The
   * header button is the exit a touch user can actually see and hit.
   */
  it("closes from the header button", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Remove player?">
        body
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close Remove player?" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The name carries the title because closed <dialog>s stay mounted (FormDialog
   * keeps its form in the DOM), so a bare "Close" would repeat once per dialog
   * on the page and go ambiguous the moment anything enumerates by name.
   */
  it("names the close button after the dialog it closes", () => {
    render(
      <>
        <Dialog open onClose={() => undefined} title="Add a team">
          body
        </Dialog>
        <Dialog open={false} onClose={() => undefined} title="Import fixtures">
          body
        </Dialog>
      </>,
    );
    expect(screen.getByLabelText("Close Add a team")).toBeInTheDocument();
    expect(screen.getByLabelText("Close Import fixtures")).toBeInTheDocument();
  });

  it("puts the close button first in the tab order", async () => {
    render(
      <Dialog open onClose={() => undefined} title="T" footer={<Button>Save</Button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close T" })).toHaveFocus();
  });

  it("fires onClose when the native dialog closes (Escape path)", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
