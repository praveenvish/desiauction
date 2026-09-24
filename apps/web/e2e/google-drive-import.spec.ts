import { expect, test, type Page, type Route } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * THE GOOGLE ROUTE, WITHOUT GOOGLE.
 *
 * "Sync new players" and "Get photos from Google Drive" run in the organizer's
 * browser against three Google surfaces: the Identity Services loader (sign-in),
 * the Picker loader, and the Drive API. This suite replaces all three at the
 * network edge — the loaders with small scripts that define the same globals,
 * the API with canned responses — so everything of OURS runs for real: the
 * connect → export → mapping → preview → import → photo step chain, the exact
 * Drive-id matching, the shrink and the consent-recording upload.
 *
 * Google's own behaviour was proven once by hand, against the founder's real
 * Drive (2026-09-24); what this guards is our half, on every run.
 */

const COLD = { timeout: 30_000 } as const;

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SHEET_ID = "e2eSheet0000000000001";

/** The stand-in for Google's two loaders. Picks are answered by page globals. */
const FAKE_GSI = `
window.google = window.google || {};
window.__gsiRequests = 0;
window.google.accounts = { oauth2: { initTokenClient: function (config) {
  return { requestAccessToken: function () {
    window.__gsiRequests += 1;
    setTimeout(function () { config.callback({ access_token: "e2e-token", expires_in: 3600 }); }, 0);
  } };
} } };`;

const FAKE_GAPI = `
window.gapi = { load: function (name, callback) {
  window.google = window.google || {};
  function View(id) { this.id = id; this.fileIds = ""; }
  View.prototype.setIncludeFolders = function () { return this; };
  View.prototype.setMode = function () { return this; };
  View.prototype.setFileIds = function (ids) { this.fileIds = ids; return this; };
  function Builder() { this.views = []; }
  ["enableFeature","setOAuthToken","setDeveloperKey","setAppId","setTitle","setMaxItems"].forEach(function (m) {
    Builder.prototype[m] = function () { return this; };
  });
  Builder.prototype.addView = function (v) { this.views.push(v); return this; };
  Builder.prototype.setCallback = function (cb) { this.cb = cb; return this; };
  Builder.prototype.build = function () {
    var self = this;
    return { setVisible: function () {
      var view = self.views[0];
      window.__pickerOpened = (window.__pickerOpened || 0) + 1;
      setTimeout(function () {
        var docs = view.id === "sheets"
          ? [{ id: "${SHEET_ID}", name: "Club responses", mimeType: "application/vnd.google-apps.spreadsheet" }]
          : view.fileIds.split(",").filter(Boolean).map(function (id) {
              return { id: id, name: "IMG_" + id + " - Some Account.png", mimeType: "image/png" };
            });
        self.cb({ action: "picked", docs: docs });
      }, 50);
    } };
  };
  window.google.picker = {
    DocsView: View, PickerBuilder: Builder,
    ViewId: { DOCS: "docs", SPREADSHEETS: "sheets" },
    DocsViewMode: { GRID: "grid" },
    Feature: { MULTISELECT_ENABLED: "multiselect" },
    Action: { PICKED: "picked", CANCEL: "cancel" },
  };
  setTimeout(callback, 0);
} };`;

const CORS = { "access-control-allow-origin": "*" };

/** The Form's linked sheet — a Google Form export's shape, photos as Drive links. */
function sheetCsv(stamp: string, rows: number): string {
  const lines = ["Timestamp,Player's Name,Mobile Number,Player Type,Upload your photo"];
  for (let i = 1; i <= rows; i++) {
    lines.push(
      `2026/09/24 10:0${String(i)}:00,Drive Player ${String(i)},6${stamp}${String(i)},🏏 Batsman,https://drive.google.com/open?id=e2ePhoto${stamp}${String(i)}`,
    );
  }
  return lines.join("\n");
}

async function fakeGoogle(page: Page, csv: () => string): Promise<void> {
  await page.route("https://accounts.google.com/gsi/client", (route: Route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_GSI }),
  );
  await page.route("https://apis.google.com/js/api.js", (route: Route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_GAPI }),
  );
  await page.route("https://www.googleapis.com/drive/v3/files/**", (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, "access-control-allow-headers": "authorization" },
      });
    }
    // The token our code sends must be the one the sign-in handed back.
    if (route.request().headers()["authorization"] !== "Bearer e2e-token") {
      return route.fulfill({ status: 401, headers: CORS });
    }
    if (url.pathname.endsWith(`/${SHEET_ID}/export`)) {
      return route.fulfill({ contentType: "text/csv", headers: CORS, body: csv() });
    }
    return route.fulfill({ contentType: "image/png", headers: CORS, body: PNG_1PX });
  });
}

async function organizerWithOpenSeason(page: Page, stamp: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(`77${stamp}`);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").fill(await latestOtp(`77${stamp}`));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Drive Org ${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible(COLD);
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Drive Cup ${stamp}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft", COLD);
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup", COLD);
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open", COLD);
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
}

test("a Form's Google Sheet syncs players, and their photos follow in the same sitting", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = String(Date.now()).slice(-8);
  let rows = 2;
  await fakeGoogle(page, () => sheetCsv(stamp, rows));
  await organizerWithOpenSeason(page, stamp);

  // --- First connect: pick the sheet, preview, import. ---------------------
  await page.getByTestId("open-import").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("sheet-connect").click();
  await expect(dialog.getByTestId("mapping-summary")).toContainText(
    "Upload your photo → Photo (Google Drive link)",
    COLD,
  );
  await expect(dialog.getByTestId("import-preview")).toContainText("2 valid players ready", COLD);
  await dialog.getByTestId("import-commit").click();

  // The photo step opens its own picker — no second click, no second sign-in —
  // and every photo lands by the Drive link in its player's row.
  await expect(dialog.getByTestId("photo-match-table")).toBeVisible(COLD);
  await expect(dialog.getByTestId("photo-match-table").getByText("by Drive link")).toHaveCount(2);
  await expect(dialog.getByTestId("photo-match-table")).toContainText("Drive Player 1");
  await expect(dialog.getByTestId("photo-match-table")).toContainText("Drive Player 2");
  expect(
    await page.evaluate(() => (window as unknown as { __gsiRequests: number }).__gsiRequests),
  ).toBe(1);
  await dialog.getByTestId("photo-upload-all").click();
  await expect(page.getByText("2 photos uploaded")).toBeVisible(COLD);

  // --- A week later: one more registration arrives in the sheet. -----------
  rows = 3;
  await page.getByTestId("open-import").click();
  await expect(dialog.getByTestId("sheet-sync")).toContainText("Google Sheet: Club responses");
  await expect(dialog.getByTestId("sheet-sync")).toContainText("last synced");
  await dialog.getByTestId("sheet-sync-btn").click();
  await expect(dialog.getByTestId("import-diff-counts")).toContainText("1 new", COLD);
  await expect(dialog.getByTestId("import-diff-counts")).toContainText("2 unchanged");
  await dialog.getByTestId("import-commit").click();
  // Only the newcomer's photo is offered: the other two already have theirs.
  await expect(dialog.getByTestId("photo-match-table")).toBeVisible(COLD);
  await expect(dialog.getByTestId("photo-match-table").getByText("by Drive link")).toHaveCount(1);
  await expect(dialog.getByTestId("photo-match-table")).toContainText("Drive Player 3");
  await dialog.getByTestId("photo-upload-all").click();
  await expect(page.getByText("1 photo uploaded")).toBeVisible(COLD);
  await expect(page.getByTestId("stat-total")).toContainText("3");
});
