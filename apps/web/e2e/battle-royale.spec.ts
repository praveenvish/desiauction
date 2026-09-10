import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

/*
 * A SEASON WITH NO OPPONENTS.
 *
 * Every fixture this product has ever scheduled had two sides. Battle royale
 * has none: sixteen to twenty-five squads drop into ONE lobby and are scored on
 * where they finished plus what they did on the way. `esports.ts` recorded that
 * as the format India runs most and the one the platform could not express.
 *
 * Three things had to become true, and this walks all three:
 *
 *   · a fixture can be created with MANY squads and no home or away
 *     (`fixture_participants`, migration 0058);
 *   · the organizer screen can draw that — a lobby row, a squad checklist
 *     instead of two dropdowns, and a placement form instead of two scorelines;
 *   · the league table folds placements into points without a `fixture_results`
 *     row existing at all.
 *
 * The last one is the one worth a browser. The other two are provable in a unit
 * test; "the table adds up after an organizer typed it in" is not.
 */
const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `83${STAMP}`;

/** The four squads, and how the lobby finished. BGMI points in the comments. */
const SQUADS = [
  { name: `Alpha Squad ${STAMP}`, placement: "1", kills: "8", points: 18 }, // 10 + 8
  { name: `Bravo Squad ${STAMP}`, placement: "2", kills: "5", points: 11 }, //  6 + 5
  { name: `Charlie Squad ${STAMP}`, placement: "3", kills: "2", points: 7 }, //  5 + 2
  { name: `Delta Squad ${STAMP}`, placement: "4", kills: "0", points: 4 }, //  4 + 0
];

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

test("a battle royale season: one lobby, four squads, and a table built from placements", async ({
  page,
}) => {
  test.setTimeout(150_000); // dev-mode compiles several new routes first-hit
  await otpLogin(page, PHONE_ORG);

  // An org with somewhere to play. A lobby still needs a ground before it can
  // be scheduled — the transition rules are the same as any other fixture's.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`BR Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.getByRole("tab", { name: "Tournaments" }).click();
  await page.getByTestId("open-venues").click();
  await expect(page.getByTestId("venues-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByLabel("Venue name").fill("Erangel");
  await page.getByLabel("City").fill("Mumbai");
  await page.getByTestId("add-venue").click();
  await expect(page.getByTestId("venue-name")).toHaveText("Erangel", { timeout: 20_000 });
  await page.getByRole("button", { name: "Add a ground" }).click();
  await page.getByLabel("Ground name").fill("Pochinki");
  await page.getByTestId("add-ground").click();
  await expect(page.getByRole("cell", { name: "Pochinki" })).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`BR Cup ${STAMP}`);
  // THE LINE THIS FILE EXISTS FOR: the twelfth pack, and the first lobby sport.
  await page.getByLabel("Sport").selectOption("battle_royale");
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");

  await page.goto(`${page.url()}/teams`);
  for (const squad of SQUADS) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(squad.name);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(squad.name);
  }

  await page.getByTestId("open-fixtures").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });

  /*
   * THERE IS NOTHING TO GENERATE. A round robin is a pairing problem and a
   * lobby season has no pairs, so the generator is not merely disabled — it is
   * not offered, and the card says what to do instead.
   */
  await expect(page.getByRole("heading", { name: "Schedule lobbies" })).toBeVisible();
  await expect(page.getByTestId("generate-fixtures")).toHaveCount(0);

  // One lobby, four squads: a checklist, because the squads in a lobby are a
  // set — no first slot, no second, and no squad twice.
  await page.getByTestId("open-add-fixture").click();
  // Scoped to the dialog: a closed `<dialog>` keeps its form in the DOM, and
  // the CSV importer on the same page has its own "Kickoff"-labelled control.
  const lobbyForm = page.getByTestId("manual-panel");
  for (const squad of SQUADS) {
    await lobbyForm.getByRole("checkbox", { name: squad.name }).check();
  }
  await expect(page.getByTestId("squad-count")).toHaveText("4 squads selected");
  await lobbyForm.getByLabel("Kickoff").fill("2026-08-01T18:00");
  await lobbyForm.getByLabel("Map").selectOption({ label: "Erangel · Pochinki" });
  await page.getByTestId("add-fixture").click();

  // The row names the lobby by its size. "A vs B" is not a sentence about it.
  await expect(page.getByTestId("stat-total")).toContainText("1", { timeout: 20_000 });
  await expect(page.getByTestId(/^lobby-.*F001$/)).toContainText("4 squads");

  // Draft → scheduled → published → in progress → completed, the same gates
  // every other fixture passes through.
  for (const step of ["schedule", "publish", "start", "complete"]) {
    await page.getByTestId(new RegExp(`^${step}-.*F001$`)).click();
    await expect(page.getByTestId(new RegExp(`^${step}-.*F001$`))).toHaveCount(0, {
      timeout: 20_000,
    });
  }

  /*
   * THE PLACEMENT FORM. One block per squad in the lobby — not per team in the
   * season, which would invite a scorer to place a squad that never dropped.
   */
  await page.getByTestId(/^record-.*F001$/).click();
  await expect(page.getByTestId("lobby-form")).toBeVisible();
  for (const squad of SQUADS) {
    await page.getByLabel(`${squad.name} placement`, { exact: true }).fill(squad.placement);
    await page.getByLabel(`${squad.name} kills`, { exact: true }).fill(squad.kills);
  }
  await page.getByTestId("lobby-submit").click();
  await expect(page.getByText("Lobby recorded")).toBeVisible({ timeout: 20_000 });

  // A lobby writes no `fixture_results` row, so "scored" can only mean every
  // squad is placed. The worklist has to know that or it nags forever.
  await expect(page.getByTestId("results-outstanding")).toHaveText("All played matches scored", {
    timeout: 20_000,
  });

  /*
   * AND THE TABLE ADDS UP. Ten for the chicken dinner, then 6-5-4, plus one a
   * kill — the BGMI scoring every Indian circuit copies. Nothing in
   * `fixture_results` contributed a single one of these points.
   */
  await page.goto(page.url().replace("/fixtures", "/standings"));
  await expect(page.getByTestId("standings-completeness")).toHaveText("1 of 1 results in");
  const rows = page.getByTestId("standings-table").locator("tbody tr");
  for (const [index, squad] of SQUADS.entries()) {
    const row = rows.nth(index);
    await expect(row).toContainText(squad.name);
    // Columns: #, Team, P, W, L, T, NR, Pts, Kills.
    await expect(row.locator("td").nth(7)).toHaveText(String(squad.points));
  }
  // Only the winner has a win. Second place lost nothing — it was not beaten by
  // anybody in particular — and the fold leaves L and T at zero on purpose.
  await expect(rows.nth(0).locator("td").nth(3)).toHaveText("1");
  await expect(rows.nth(1).locator("td").nth(3)).toHaveText("0");
});
