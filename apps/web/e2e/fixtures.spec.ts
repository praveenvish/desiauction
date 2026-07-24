import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M-IP3-3 founder journey: create venue + grounds, generate a deterministic
// round-robin schedule, publish it, move a fixture INTO a conflict (refused with
// a warning), resolve by moving to a free slot, browse the calendar, export the
// fixtures CSV. Everything local.

const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `82${STAMP}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  // Await the send completing (data-step flips only after the action commits)
  // before reading the inbox — the login.spec idiom; a bare read races the mint.
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the scheduling journey: venue, grounds, generate, publish, conflict, resolve, calendar, export", async ({
  page,
}) => {
  test.setTimeout(120_000); // dev-mode compiles several new routes first-hit
  await otpLogin(page, PHONE_ORG);

  // Organization with a venue and two grounds.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Fixture Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.getByTestId("open-venues").click();
  await expect(page.getByTestId("venues-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByLabel("Venue name").fill("Azad Maidan");
  await page.getByLabel("City").fill("Mumbai");
  await page.getByTestId("add-venue").click();
  await expect(page.getByTestId("venue-name")).toHaveText("Azad Maidan", { timeout: 20_000 });
  for (const ground of ["Main Oval", "Side Strip"]) {
    await page.getByRole("button", { name: "Add a ground" }).click();
    await page.getByLabel("Ground name").fill(ground);
    await page.getByTestId("add-ground").click();
    await expect(page.getByRole("cell", { name: ground })).toBeVisible();
  }

  // Competition with dates and four teams.
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Fixture Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.goto(`${page.url()}/teams`);
  for (const team of ["Andheri Arrows", "Bandra Blasters", "Colaba Kings", "Dadar Daredevils"]) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(team);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(team);
  }

  // Generate the round robin onto both grounds.
  await page.getByTestId("open-fixtures").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("stat-total")).toContainText("0");
  await page.getByLabel("Start date").fill("2026-08-01");
  await page.getByLabel("Kickoff times").fill("18:00,20:00");
  await page.getByRole("checkbox", { name: /Main Oval/ }).check();
  await page.getByRole("checkbox", { name: /Side Strip/ }).check();
  await page.getByTestId("generate-fixtures").click();
  await expect(page.getByTestId("stat-total")).toContainText("6", { timeout: 20_000 });
  await expect(page.getByTestId("stat-draft")).toContainText("6");

  // Publish the schedule: drafts → scheduled → published, no hidden edges.
  await page.getByTestId("schedule-all").click();
  await expect(page.getByTestId("stat-scheduled")).toContainText("6");
  await page.getByTestId("publish-all").click();
  await expect(page.getByTestId("stat-published")).toContainText("6");

  // Move fixture F002 onto F001's slot -> the conflict engine refuses.
  const rowOne = page.getByTestId(/^fixture-.*F001$/);
  const kickoffOne = (await rowOne.locator("td").nth(3).textContent()) ?? "";
  const slotOne = kickoffOne.trim().replace(" ", "T");
  await page.getByTestId(/^move-.*F002$/).click();
  await page.getByLabel("New kickoff").fill(slotOne);
  // Same ground as F001: pick the ground F001 shows.
  const groundOne = ((await rowOne.locator("td").nth(4).textContent()) ?? "").trim();
  await page.getByLabel("New ground").selectOption({
    label: `Azad Maidan · ${groundOne.startsWith("Main") ? "Main Oval" : "Side Strip"}`,
  });
  await page.getByTestId(/^confirm-move-.*F002$/).click();
  // Conflict warning surfaces; the fixture did NOT move.
  await expect(page.getByText(/booked twice|hosts two fixtures/)).toBeVisible();

  // Resolve: move F002 to a free evening instead — accepted.
  await page.getByLabel("New kickoff").fill("2026-09-10T18:00");
  await page.getByTestId(/^confirm-move-.*F002$/).click();
  await expect(page.getByTestId(/^fixture-.*F002$/)).toContainText("2026-09-10 18:00");

  // Browse the calendar: day view shows opening day, timeline lists everything.
  await page.getByTestId("open-calendar").click();
  await expect(page.getByTestId("calendar-date")).toBeVisible({ timeout: 20_000 });
  await page.goto(page.url().split("?")[0] + "?view=day&date=2026-08-01");
  await expect(page.getByTestId("day-2026-08-01")).toBeVisible();
  await page.getByTestId("view-timeline").click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  await expect(page.getByTestId("timeline-view").getByTestId(/^cal-.*F001$/)).toBeVisible();

  // Export produces the fixtures CSV.
  await page.goto(`/seasons/${new URL(page.url()).pathname.split("/")[2] ?? ""}/fixtures`);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/fixtures\.csv$/);
});

test("fixtures dashboard and venues page: axe zero violations", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, `81${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Axe Fix Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.getByTestId("open-venues").click();
  await expect(page.getByTestId("venues-heading")).toBeVisible({ timeout: 20_000 });
  const venuesScan = await new AxeBuilder({ page }).analyze();
  expect(venuesScan.violations, JSON.stringify(venuesScan.violations, null, 2)).toEqual([]);

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Axe Fix Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await page.getByTestId("open-fixtures").click();
  await expect(page.getByTestId("stat-row")).toBeVisible({ timeout: 30_000 });
  const fixturesScan = await new AxeBuilder({ page }).analyze();
  expect(fixturesScan.violations, JSON.stringify(fixturesScan.violations, null, 2)).toEqual([]);
});
