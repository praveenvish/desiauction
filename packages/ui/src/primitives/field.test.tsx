import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Select } from "./field";

describe("Field", () => {
  it("wires label, help and error to the input", () => {
    render(<Field label="Team name" help="Shown on the stage" error="Required" />);
    const input = screen.getByLabelText("Team name");
    expect(input).toHaveAccessibleDescription("Required Shown on the stage");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("is valid by default", () => {
    render(<Field label="Phone" />);
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-invalid");
  });

  it("marks required accessibly", () => {
    render(<Field label="Name" required />);
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("aria-required", "true");
  });
});

// --- Defect 1: `required` never reached the DOM ---------------------------------------
//
// It was swallowed and re-emitted as aria-required only, so the browser had no
// constraint to enforce: an empty required control reported valid, the form
// submitted, and the server did work the tab could have refused for free.

describe("Field · native constraint validation", () => {
  it("puts required on the control, so an empty one is genuinely invalid", () => {
    render(<Field label="Name" required />);
    const input = screen.getByLabelText<HTMLInputElement>(/Name/);
    expect(input).toBeRequired();
    expect(input.validity.valueMissing).toBe(true);
    expect(input.validity.valid).toBe(false);
    expect(input.checkValidity()).toBe(false);
  });

  it("leaves an unrequired control valid", () => {
    render(<Field label="Location" />);
    const input = screen.getByLabelText<HTMLInputElement>("Location");
    expect(input).not.toBeRequired();
    expect(input.validity.valid).toBe(true);
  });

  it("suppresses the UA bubble and renders the browser's own complaint instead", () => {
    render(<Field label="Name" required />);
    const input = screen.getByLabelText<HTMLInputElement>(/Name/);

    // checkValidity() fires `invalid` exactly as the form submission algorithm
    // does. Our handler must call preventDefault (that is what kills the
    // bubble) and lift the message into the component's own error slot.
    const invalid = new Event("invalid", { bubbles: false, cancelable: true });
    act(() => {
      input.dispatchEvent(invalid);
    });
    expect(invalid.defaultPrevented).toBe(true);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(input.validationMessage);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(input.validationMessage);
  });

  it("clears the native message once the control is repaired, not on every keystroke", () => {
    render(<Field label="Name" required />);
    const input = screen.getByLabelText<HTMLInputElement>(/Name/);
    act(() => {
      input.dispatchEvent(new Event("invalid", { cancelable: true }));
    });
    const message = screen.getByRole("alert").textContent;

    // Still empty after the event loop turns: message stands, unchanged node.
    fireEvent.input(input, { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toBe(message);

    fireEvent.input(input, { target: { value: "Meera" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a server error visible over any native one", () => {
    render(<Field label="Name" required error="That name is taken." />);
    expect(screen.getByRole("alert")).toHaveTextContent("That name is taken.");
  });

  // Cancelling `invalid` buys the bubble's silence at the price of the focus
  // move Chromium performed alongside it — measured in Chromium, where a
  // blocked submit left focus sitting on the button. The handler restores it.
  it("focuses the first failing control when the browser blocks the submit", () => {
    render(
      <form>
        <Field label="First" required />
        <Field label="Second" required />
      </form>,
    );
    const first = screen.getByLabelText<HTMLInputElement>(/First/);
    const second = screen.getByLabelText<HTMLInputElement>(/Second/);
    act(() => {
      // Document order, as the form submission algorithm walks them.
      first.dispatchEvent(new Event("invalid", { cancelable: true }));
      second.dispatchEvent(new Event("invalid", { cancelable: true }));
    });
    expect(first).toHaveFocus();
  });
});

// --- Defect 2: the error was wired by aria-describedby only ---------------------------
//
// describedby is read when focus ARRIVES at the control. With focus parked on
// <body> after a failed server action, that moment never came: a failed submit
// announced nothing at all.

describe("Field · error announcement", () => {
  it("announces the error as an alert when it appears", () => {
    const { rerender } = render(<Field label="Code" />);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<Field label="Code" error="That code didn't work." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That code didn't work.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    // Exactly one node carries it — no second live region echoing the same text.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("does not re-announce an unchanged message", () => {
    const { rerender } = render(<Field label="Code" error="That code didn't work." />);
    const first = screen.getByRole("alert");
    rerender(<Field label="Code" error="That code didn't work." />);
    // Same DOM node, untouched text: nothing for a live region to speak again.
    expect(screen.getByRole("alert")).toBe(first);
  });

  it("retires the alert when the error clears", () => {
    const { rerender } = render(<Field label="Code" error="That code didn't work." />);
    rerender(<Field label="Code" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// --- Defect 2b: focus ----------------------------------------------------------------
//
// An announced error the keyboard cannot reach is still broken.

describe("Field · focus after a failed submit", () => {
  function Form({ error }: { error?: string }) {
    return (
      <form>
        <Field label="Name" name="name" required {...(error !== undefined ? { error } : {})} />
        <button type="submit">Save</button>
      </form>
    );
  }

  it("pulls focus back from <body> when a submitted form comes back with an error", () => {
    const { rerender } = render(<Form />);
    const input = screen.getByLabelText<HTMLInputElement>(/Name/);
    // The submit Button disables itself while pending, which drops focus to
    // <body> — the exact state a returning server action re-renders into.
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(document.activeElement).toBe(document.body);

    rerender(<Form error="Enter your name." />);
    expect(input).toHaveFocus();
  });

  // The trap this walked into once: a submit re-renders immediately (pending
  // goes true) and the server's answer lands a render or two later. Treating
  // any error-free render as "the submit is answered" threw the memory of the
  // submit away before the error it belonged to ever arrived.
  it("survives the error-free renders between the submit and the server's answer", () => {
    const { rerender } = render(<Form />);
    const input = screen.getByLabelText(/Name/);
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    rerender(<Form />);
    rerender(<Form />);
    rerender(<Form error="Enter your name." />);
    expect(input).toHaveFocus();
  });

  it("never steals a caret the user placed somewhere else", () => {
    const { rerender } = render(
      <>
        <Form />
        <input aria-label="Elsewhere" />
      </>,
    );
    fireEvent.submit(screen.getByLabelText(/Name/).closest("form") as HTMLFormElement);
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();

    rerender(
      <>
        <Form error="Enter your name." />
        <input aria-label="Elsewhere" />
      </>,
    );
    expect(elsewhere).toHaveFocus();
  });

  it("stays put on renders that no submit caused", () => {
    const { rerender } = render(<Form />);
    rerender(<Form error="Enter your name." />);
    expect(document.activeElement).toBe(document.body);
  });

  it("gives the first failing control the focus, not the last", () => {
    function TwoUp({ failed }: { failed: boolean }) {
      const error = failed ? "Required." : undefined;
      return (
        <form>
          <Field label="First" {...(error !== undefined ? { error } : {})} />
          <Field label="Second" {...(error !== undefined ? { error } : {})} />
        </form>
      );
    }
    const { rerender } = render(<TwoUp failed={false} />);
    fireEvent.submit(screen.getByLabelText("First").closest("form") as HTMLFormElement);
    rerender(<TwoUp failed />);
    expect(screen.getByLabelText("First")).toHaveFocus();
  });
});

describe("Select", () => {
  it("is a labelled native select", () => {
    render(
      <Select label="Role">
        <option value="bat">Batter</option>
        <option value="bowl">Bowler</option>
      </Select>,
    );
    const select = screen.getByLabelText("Role");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Bowler" })).toBeInTheDocument();
  });

  it("carries required to the DOM too, so an unchosen option blocks a submit", () => {
    render(
      <Select label="Role" required>
        <option value="">Choose…</option>
        <option value="bat">Batter</option>
      </Select>,
    );
    const select = screen.getByLabelText<HTMLSelectElement>(/Role/);
    expect(select).toBeRequired();
    expect(select).toHaveAttribute("aria-required", "true");
    expect(select.validity.valueMissing).toBe(true);
  });

  it("announces its error as an alert", () => {
    const { rerender } = render(
      <Select label="Role">
        <option value="bat">Batter</option>
      </Select>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <Select label="Role" error="Choose a valid playing role.">
        <option value="bat">Batter</option>
      </Select>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a valid playing role.");
  });
});
