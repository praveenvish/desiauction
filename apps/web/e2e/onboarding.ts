import { expect, type Page } from "@playwright/test";

/**
 * CLEAR THE NAME GATE, WHEREVER IT APPEARS.
 *
 * `requireOnboarded` guards every console segment, so a brand-new account meets
 * it at whatever route it was heading for — including straight after accepting
 * an invitation, which is the one journey where the interruption is most
 * surprising. The gate carries the destination in `?next=`, so clearing it puts
 * the person back where they were going.
 *
 * Specs used to encode the pre-gate world: log in, then assert the destination
 * rendered. That has been wrong since the gate shipped (2026-07-30) and it is
 * why a third of the suite was red at the audit. This helper is deliberately
 * TOLERANT — it does nothing when the gate is not showing — so a spec can call
 * it after any navigation that might have crossed it, without knowing whether
 * this particular account has a name yet.
 */
export async function clearNameGate(page: Page, name = "E2E Tester"): Promise<void> {
  // WAIT FOR THE GATE, DO NOT SAMPLE FOR IT. Callers arrive straight off a
  // click that navigates, so an immediate `isVisible()` asks the question
  // before the answer exists: the helper returns "no gate here", the caller
  // waits for a control on the destination, and the gate renders a moment
  // later. The result is a 30-second timeout on a page showing "Welcome to
  // DesiAuction" — which is what happened to the owner-join journey.
  const field = page.getByLabel("What should we call you?");
  const appeared = await field
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    return;
  }
  await field.fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/onboarding/);
}
