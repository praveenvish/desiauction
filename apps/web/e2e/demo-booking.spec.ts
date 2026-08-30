import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { E2E_MARK, clearTestDemoData, publishTestAvailability } from "./demo-availability";

/**
 * DEMO-1 — the whole journey an anonymous stranger lives, in a real browser.
 *
 * Nobody signs in anywhere in this file, and that is the point being asserted:
 * a person who has never heard of us fills in a form, picks a time, gets a
 * link, and can move or cancel their own call — with no account, no tenant and
 * no session at any step.
 *
 * The suite is SERIAL because the second half books a real slot, and two
 * workers racing for the same half-hour is the one thing the database is
 * designed to refuse. Testing the refusal is a separate, deliberate case below.
 */

test.describe.configure({ mode: "serial" });

// Residue from an earlier run is not inert here: demo requests are rate-limited
// per IP per hour, and every local run comes from the same address. Starting
// clean is what keeps a second run of this file behave like the first.
test.beforeAll(async () => {
  await clearTestDemoData();
});

/** A number that is valid, and that no other suite in this repo uses. */
function freshPhone(): string {
  return `98${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

async function axeClean(page: Page, surface: string): Promise<void> {
  await page.waitForFunction(() => document.title.length > 0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

async function fillDemoForm(page: Page, phone: string): Promise<void> {
  await page.getByLabel("Your name").fill("Ravi Kumar");
  await page.getByLabel("Mobile number").fill(phone);
  // The mark MUST be in the org name: it is what cleanup matches on. Without it
  // every run left its requests behind, and after ten of them in an hour the
  // per-IP throttle started silently swallowing submissions from localhost —
  // which looks exactly like a broken form and is in fact the throttle working.
  await page.getByLabel("Tournament or club").fill(`${E2E_MARK} Sunday Warriors`);
  await page.getByLabel("How many teams?").selectOption("8-16");
  await page.getByLabel("Best time to talk").selectOption("weekend-evening");
  await page.getByLabel("Anything else?").fill("We run 12 teams every March.");
}

test("a stranger asks for a demo and is told what happens next", async ({ page }) => {
  await page.goto("/schedule-demo");

  // The page must say what the demo IS before asking for a phone number.
  await expect(page.getByRole("heading", { level: 1, name: "Schedule a demo" })).toBeVisible();
  await axeClean(page, "/schedule-demo");

  await fillDemoForm(page, freshPhone());
  await page.getByRole("button", { name: "Request a demo" }).click();

  const done = page.getByTestId("demo-request-done");
  await expect(done).toBeVisible();
  // The CONTRACT is the on-screen confirmation — it must stand alone, with no
  // mail provider configured and nothing else required of the person.
  await expect(done).toContainText("we have your request");
  await axeClean(page, "/schedule-demo (submitted)");
});

test("the form refuses what it should, in the field that is wrong", async ({ page }) => {
  await page.goto("/schedule-demo");

  await page.getByLabel("Your name").fill("Ravi Kumar");
  await page.getByLabel("Mobile number").fill("12345");
  await page.getByLabel("Tournament or club").fill("E2E Warriors");
  await page.getByRole("button", { name: "Request a demo" }).click();

  // The message rides the field, is announced, and the control is marked — the
  // Field primitive's contract, asserted here because a hand-rolled error
  // paragraph would have satisfied a screenshot and none of this.
  // Scoped to the FIELD's own alert, not `getByRole("alert")` at large: Next
  // renders a permanently-mounted route announcer carrying the same role, so
  // the bare query is ambiguous on every page in the app. Resolving the
  // control's `aria-describedby` is also the stronger assertion — it proves the
  // message is actually associated with the input, which is the half a screen
  // reader depends on and a text match alone would never have checked.
  const phone = page.getByLabel("Mobile number");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await phone.getAttribute("aria-describedby")) ?? "";
  // An attribute selector, not `#id`: React's generated ids are not guaranteed
  // to be valid CSS identifiers and `CSS.escape` does not exist in the runner.
  const message = page.locator(`[id="${describedBy.split(" ")[0] ?? "none"}"]`);
  await expect(message).toHaveAttribute("role", "alert");
  await expect(message).toContainText("10-digit Indian mobile");
});

test("native validation blocks an empty submit without a round trip", async ({ page }) => {
  await page.goto("/schedule-demo");
  await page.getByRole("button", { name: "Request a demo" }).click();
  // Still on the form, nothing submitted: `required` reaches the DOM.
  await expect(page.getByTestId("demo-request-done")).toHaveCount(0);
  await expect(page.getByLabel("Your name")).toHaveJSProperty("validity.valueMissing", true);
});

test("the honeypot is invisible to a person and fatal to a filler", async ({ page }) => {
  await page.goto("/schedule-demo");

  const trap = page.locator("#company_website");

  // NOT `toBeHidden()`. The trap is positioned off-screen rather than
  // `display: none`, deliberately — some bots skip anything the CSSOM reports
  // as hidden, and this field wants to be filled in. Playwright counts an
  // off-screen element as visible, so the assertion has to be the property that
  // actually matters: no person can see it, reach it, or hear it.
  const box = await trap.boundingBox();
  expect(box?.x ?? 0, "the trap must sit outside the viewport").toBeLessThan(0);
  // Never reachable by keyboard, and never announced to assistive technology.
  await expect(trap).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[aria-hidden="true"] > #company_website')).toHaveCount(1);

  await fillDemoForm(page, freshPhone());
  await trap.fill("https://spam.example", { force: true });
  await page.getByRole("button", { name: "Request a demo" }).click();

  // Indistinguishable from success: telling a bot which submissions were binned
  // is telling it how to stop being binned.
  await expect(page.getByTestId("demo-request-done")).toBeVisible();
});

test("an unknown booking link is not found, and does not hint that it is close", async ({
  page,
}) => {
  const response = await page.goto("/demo/thisisnotarealbookingtokenatall");
  expect(response?.status()).toBe(404);
});

test("a demo request page carries its attribution without echoing it", async ({ page }) => {
  // `?from=` is attacker-controlled on a public page and lands in an operator's
  // console. It must be accepted only from the closed list, and never rendered.
  await page.goto("/schedule-demo?from=%3Cscript%3Ealert(1)%3C/script%3E");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("alert(1)");
  await expect(page.locator('input[name="source"]')).toHaveValue("schedule-demo");

  await page.goto("/schedule-demo?from=pricing");
  await expect(page.locator('input[name="source"]')).toHaveValue("pricing");
});

test("the pricing and landing CTAs lead to the demo", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("link", { name: "See it run first" })).toHaveAttribute(
    "href",
    "/schedule-demo?from=pricing",
  );

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Watch it run with us" })).toHaveAttribute(
    "href",
    "/schedule-demo?from=landing",
  );
});

test("the demo desk is invisible without the grant", async ({ page }) => {
  // Not "forbidden" — not found. A locked door that announces itself is a map.
  const response = await page.goto("/admin/demos");
  expect(response?.status()).toBe(404);
});

test("the reminder sweep endpoint is closed without its secret", async ({ request }) => {
  const response = await request.post("/api/jobs/demo-reminders");
  expect(response.status()).toBe(404);
});

test("the demo form works at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/schedule-demo");

  // The page must never scroll sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Every control is a real target. Axe does not check this, which is exactly
  // why it is asserted from computed geometry instead.
  for (const name of ["Your name", "Mobile number", "Tournament or club"]) {
    const box = await page.getByLabel(name).boundingBox();
    expect(box?.height ?? 0, `${name} is too short to hit`).toBeGreaterThanOrEqual(44);
  }
  const submit = await page.getByRole("button", { name: "Request a demo" }).boundingBox();
  expect(submit?.height ?? 0).toBeGreaterThanOrEqual(44);

  await axeClean(page, "/schedule-demo at 360px");
});

/**
 * THE SECOND HALF — booking a real time.
 *
 * Availability is published straight into the database rather than through the
 * operator UI: that screen sits behind `platform:demo`, a grant RLS makes
 * uninsertable by the application role, and driving it here would turn every
 * booking test into a test of the grant model.
 */
test.describe("with times published", () => {
  test.beforeAll(async () => {
    await clearTestDemoData();
    await publishTestAvailability();
  });

  test.afterAll(async () => {
    await clearTestDemoData();
  });

  test("the page offers to book once there is something to offer", async ({ page }) => {
    await page.goto("/schedule-demo");
    // With availability published, the promise CHANGES — the page stops saying
    // "we'll come back to you" and starts saying "pick a time".
    await expect(page.getByText("Pick a time that suits you.")).toBeVisible();
  });

  test("request → pick a time → confirmed → move it → cancel it", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/schedule-demo");
    await fillDemoForm(page, freshPhone());
    await page.getByRole("button", { name: "Request a demo" }).click();

    await page.getByRole("link", { name: "Or pick a time yourself" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pick a time" })).toBeVisible();
    // The timezone is stated, never guessed.
    await expect(page.getByText("All times are Indian Standard Time (IST).")).toBeVisible();
    await axeClean(page, "/schedule-demo/pick");

    // The submit stays disabled until a time is actually chosen.
    const book = page.getByRole("button", { name: "Book this time" });
    await expect(book).toBeDisabled();

    const firstSlot = page.locator("label.demo-slot").first();
    const chosenLabel = (await firstSlot.textContent())?.trim() ?? "";
    await firstSlot.click();
    await expect(book).toBeEnabled();
    await book.click();

    // Booking lands on the person's OWN page, behind a token.
    await expect(page).toHaveURL(/\/demo\/[A-Za-z0-9_-]{32}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your demo" })).toBeVisible();
    await expect(page.getByText(chosenLabel.replace(/\s+/g, " "))).toBeVisible();
    await expect(page.getByRole("link", { name: "Add it to your calendar" })).toBeVisible();
    await axeClean(page, "/demo/[token]");

    const bookingUrl = page.url();

    // The calendar file is real, and is served under the same token.
    const ics = await page.request.get(`${bookingUrl}/invite.ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const body = await ics.text();
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:DesiAuction demo");

    // Move it — the link must keep working, because it is already in a mailbox.
    await page.getByRole("button", { name: "Move this demo" }).click();
    const newSlot = page.locator("label.demo-slot").nth(2);
    await newSlot.click();
    await page.getByRole("button", { name: "Move to this time" }).click();
    await expect(page).toHaveURL(bookingUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Your demo" })).toBeVisible();

    // Cancel it — one press, no dialog arguing them out of it.
    //
    // The action revalidates this very path, so the whole route re-renders and
    // the person lands on the cancelled page rather than on an inline notice.
    // That is the outcome worth asserting: the inline notice is only what shows
    // in the window before the server tree swaps in.
    await page.getByRole("button", { name: "Cancel the demo" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("cancelled", {
      timeout: 15_000,
    });

    // And it still says so on a fresh load — the link keeps working and
    // explains itself, rather than 404ing on somebody holding a stale mail.
    await page.goto(bookingUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("cancelled");
    await expect(page.getByRole("link", { name: "Ask for a demo again" })).toBeVisible();
  });

  test("a taken slot is gone from the next person's list", async ({ page, browser }) => {
    test.setTimeout(120_000);

    // First person books the earliest slot.
    await page.goto("/schedule-demo");
    await fillDemoForm(page, freshPhone());
    await page.getByRole("button", { name: "Request a demo" }).click();
    await page.getByRole("link", { name: "Or pick a time yourself" }).click();
    const taken = page.locator("label.demo-slot").first();
    const takenLabel = (await taken.textContent())?.trim() ?? "";
    const takenFor = await taken.getAttribute("for");
    await taken.click();
    await page.getByRole("button", { name: "Book this time" }).click();
    await expect(page).toHaveURL(/\/demo\//);

    // A second person, in a clean context, is never offered it.
    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await secondPage.goto("/schedule-demo");
    await fillDemoForm(secondPage, freshPhone());
    await secondPage.getByRole("button", { name: "Request a demo" }).click();
    await secondPage.getByRole("link", { name: "Or pick a time yourself" }).click();

    // The derivation subtracts it: the slot is absent, not merely disabled.
    await expect(secondPage.locator(`label[for="${takenFor ?? "none"}"]`)).toHaveCount(0);
    await expect(secondPage.locator("label.demo-slot").first()).not.toHaveText(takenLabel);
    await second.close();
  });

  test("one request cannot hold two times at once", async ({ page }) => {
    await page.goto("/schedule-demo");
    await fillDemoForm(page, freshPhone());
    await page.getByRole("button", { name: "Request a demo" }).click();

    const pick = page.getByRole("link", { name: "Or pick a time yourself" });
    const pickUrl = (await pick.getAttribute("href")) ?? "";
    await pick.click();
    await page.locator("label.demo-slot").first().click();
    await page.getByRole("button", { name: "Book this time" }).click();
    await expect(page).toHaveURL(/\/demo\//);

    // Going back to the picker for the SAME request must not offer a second
    // booking — two open calls for one lead is a double entry in the day.
    await page.goto(pickUrl);
    await expect(page).toHaveURL(/\/schedule-demo\/booked$/);
  });
});
