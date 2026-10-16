import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

// HOW A SIGN-IN CODE GETS INTO THE FIELD (login-shared.tsx, submitWholeCode).
//
// A code that arrives WHOLE (pasted, or tapped in from the keyboard's "From
// Messages" suggestion) submits itself; digits TYPED one at a time wait for
// the button, so a mistyped sixth digit is never sent unseen.
//
// Every other spec types its code, because Playwright's `fill()` looks like
// typing in Chromium and like a paste in Firefox: the form submitted itself
// there, the spec then waited a minute to click a button that had gone, and
// the Firefox nightly failed nearly every sign-in for it. This spec is the one
// place each path is driven on purpose, on every engine.

async function toCodeStep(page: Page): Promise<string> {
  const phone = `7${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  await page.goto("/login?method=phone");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  return latestOtp(phone);
}

test("a pasted code submits itself", async ({ page }) => {
  const code = await toCodeStep(page);
  // A paste: one input event carrying all six digits, set through the native
  // setter so React sees the change as the browser would make it.
  await page.getByLabel("6-digit code").evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: value }),
    );
  }, code);
  // No click: the paste alone signs a new person in, to the one question.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
});

test("typed digits wait for the button, then the button signs in", async ({ page }) => {
  const code = await toCodeStep(page);
  await page.getByLabel("6-digit code").pressSequentially(code);
  const verify = page.getByRole("button", { name: "Verify and continue" });
  // Nothing was sent: still on the code step, and the button is free to press.
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  await expect(verify).toBeEnabled();
  await expect(verify).not.toHaveAttribute("aria-busy", "true");
  expect(new URL(page.url()).pathname).toBe("/login");
  await verify.click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
});
