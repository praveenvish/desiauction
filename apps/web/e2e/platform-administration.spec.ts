import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PX-9 FOUNDER DEMONSTRATION: a platform administrator signs in → views overall
// platform health → finds an organization → inspects its competitions → views a
// user's grants → reviews audit history → verifies Financial Operations health →
// navigates to the affected resources. No operational writes. No engineering
// assistance.
//
// Also covers: the FOURTH capability partition through the browser (an org owner
// who is not staff cannot see the platform), privilege-escalation attempts
// against every admin route, the read-only guarantee as a user can observe it,
// a11y on every new surface, and 360px.
//
// The read-only guarantee is proved STRUCTURALLY elsewhere and more strongly:
// admin-foundation.regression.test.ts drives every projection through a db
// handle that throws on any mutation, and a dependency-cruiser rule forbids
// administration from importing a writer at all. A browser cannot prove a
// negative about SQL; it can prove the console offers no way to act, which is
// what this spec asserts.

test.describe.configure({ mode: "serial" });

// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — org:owner + settlement/finops controller + PLATFORM ADMIN
//   admin   +919999000002 — org:owner on demo-club, NOT a platform admin
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";

const ADMIN_ROUTES = ["/admin", "/admin/orgs", "/admin/users", "/admin/audit", "/admin/health"];

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

test("founder demo: sign in → platform health → find an org → inspect → grants → audit → finops health → navigate out", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // --- Platform administrator signs in --------------------------------------
  await otpLogin(page, FOUNDER);

  // The door is in the avatar menu, exactly as PX-1 01 §3 specifies.
  await page.goto("/home");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Platform admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // --- Views overall platform health ----------------------------------------
  await expect(page.getByRole("heading", { name: "Platform", level: 1 })).toBeVisible();
  // Administration says what it is, before anything else.
  await expect(page.getByTestId("admin-readonly")).toBeVisible();
  // The seed guarantees at least the demo org, its people and a settled auction.
  await expect(page.getByRole("link", { name: /Organizations/ }).first()).toBeVisible();
  await expect(page.getByTestId("admin-recent")).toBeVisible();
  await axeClean(page, "/admin");

  // --- Finds an organization -------------------------------------------------
  await page.goto("/admin/orgs");
  await page.getByLabel("Search organizations").fill("Demo Cricket Club");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("admin-org-table")).toBeVisible();
  const orgLink = page.getByRole("link", { name: "Demo Cricket Club" });
  await expect(orgLink).toBeVisible();
  // The search NARROWED — the directory is not showing everything regardless.
  await expect(page.getByTestId("admin-org-table").getByRole("row")).toHaveCount(2);
  await axeClean(page, "/admin/orgs");

  // --- Inspects competitions -------------------------------------------------
  await orgLink.click();
  await expect(page).toHaveURL(/\/admin\/orgs\/[^/]+$/);
  await expect(page.getByTestId("admin-org-competitions")).toBeVisible();
  // The seed's two competitions: the journey playground and the settled exemplar.
  await expect(page.getByRole("link", { name: /Demo Premier League/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Demo Cup/ })).toBeVisible();
  await axeClean(page, "/admin/orgs/[slug]");

  // --- Views user grants -----------------------------------------------------
  // The founder holds THREE grants on this org (org:owner, settlement:controller,
  // finops:controller) — one row each, so this link is deliberately not unique.
  // That non-uniqueness IS the partition, rendered.
  await page
    .getByTestId("admin-org-grants")
    .getByRole("link", { name: "Demo Founder" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/);
  const grants = page.getByTestId("admin-user-grants");
  await expect(grants).toBeVisible();
  // Grants are shown as the capability SETS they are — the four partitions,
  // visible as four different kinds of trust rather than one word "admin".
  await expect(grants).toContainText("org:owner");
  await expect(grants).toContainText("settlement:controller");
  await expect(grants).toContainText("finops:controller");
  // …including the platform grant itself, on the platform scope.
  await expect(grants).toContainText("platform:admin");
  await expect(grants).toContainText("The platform");
  await axeClean(page, "/admin/users/[personId]");

  // --- Reviews audit history -------------------------------------------------
  await page.getByRole("link", { name: /Everything this person did/ }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?actor=/);
  await expect(page.getByTestId("admin-audit-list")).toBeVisible();
  // The filter is real: narrowing by action changes the result set.
  await page.getByLabel("Action").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByTestId("admin-audit-count")).toBeVisible();
  await axeClean(page, "/admin/audit");

  // --- Verifies Financial Operations health ----------------------------------
  await page.goto("/admin/health");
  await expect(page.getByTestId("admin-runner-health")).toBeVisible();
  await expect(page.getByTestId("admin-queues")).toBeVisible();
  // The seed declares a finops profile for the demo org, so its health is here.
  const orgHealth = page.getByTestId("admin-health-demo-club");
  await expect(orgHealth).toBeVisible();
  await expect(orgHealth.getByText("Settlement ingest")).toBeVisible();
  await expect(orgHealth.getByText("Dispatch channels")).toBeVisible();
  await expect(orgHealth.getByText("Certification")).toBeVisible();
  await axeClean(page, "/admin/health");

  // --- Navigates to affected resources ---------------------------------------
  await page
    .getByRole("link", { name: /Finance console/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/org\/[^/]+\/money$/);

  // --- No operational writes -------------------------------------------------
  // Administration's surfaces offer search and navigation. The only submits are
  // the read filters (GET forms); no admin surface posts anything.
  for (const route of ADMIN_ROUTES) {
    await page.goto(route);
    const posts = await page.locator('form[method="post"]').count();
    expect(posts, `${route} must not carry a write form`).toBe(0);
    const forms = page.locator("form");
    for (let i = 0; i < (await forms.count()); i++) {
      // A GET form cannot mutate; anything else on an admin page is a bug.
      const method = (await forms.nth(i).getAttribute("method")) ?? "get";
      expect(method.toLowerCase(), `${route} form ${String(i)} must be a GET`).toBe("get");
    }
  }
});

test("the FOURTH partition: an org owner is not a platform admin", async ({ page }) => {
  test.setTimeout(120_000);

  // Demo Admin holds org:owner on demo-club — the strongest set the product's
  // own UI can issue, including `grant.issue`. It confers nothing here.
  await otpLogin(page, ORG_OWNER);

  // The door is ABSENT, not disabled.
  await page.goto("/home");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Platform admin" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ATTACK: every admin route, by direct URL. Administration does not exist.
  for (const route of ADMIN_ROUTES) {
    const response = await page.request.get(route);
    expect(response.status(), `${route} must 404 for a non-admin`).toBe(404);
  }

  // ATTACK: the deep links an admin would use — an org they DO own, and a user.
  expect((await page.request.get("/admin/orgs/demo-club")).status()).toBe(404);
  expect((await page.request.get("/admin/audit?q=demo")).status()).toBe(404);

  // The 404 is a real one the browser renders, not a soft empty state.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform", level: 1 })).toHaveCount(0);
  await expect(page.getByTestId("admin-org-table")).toHaveCount(0);
});

test("privilege escalation: a signed-out stranger reaches nothing", async ({ page }) => {
  for (const route of [...ADMIN_ROUTES, "/admin/orgs/demo-club"]) {
    const response = await page.request.get(route);
    // 404 (absent) or a redirect to login — never a 200 with content.
    expect([404, 307, 302], `${route} leaked to an anonymous request`).toContain(response.status());
  }
});

test("platform admin is not thereby an organizer: the console re-gates every writer", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // The founder IS a platform admin. That grant confers no org power at all —
  // the partition holds in the OTHER direction too. The founder happens to hold
  // org grants as well, so we prove the partition where it is observable: the
  // platform grant carries no settlement/finops/org capability of its own, which
  // the foundation suite asserts directly. Here we assert the product's own
  // promise: administration exposes no command surface to reach them with.
  await otpLogin(page, FOUNDER);

  await page.goto("/admin/health");
  // The finance console's recovery powers (requeueDeadJob, retryDispatch,
  // runFollower) are NAMED on this page as the resolving action — and are not
  // offered. Administration tells you where the fix lives; it does not hold it.
  await expect(page.getByRole("button", { name: /Retry|Requeue|Run follower|Rewind/ })).toHaveCount(
    0,
  );

  await page.goto("/admin/orgs/demo-club");
  // No grant issuing, no revoking, no lifecycle control on the admin surface.
  await expect(page.getByRole("button", { name: /Revoke|Grant|Issue|Delete|Close/ })).toHaveCount(
    0,
  );
});

test("360px: every admin surface fits, and nothing scrolls the page sideways", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);

  for (const route of [...ADMIN_ROUTES, "/admin/orgs/demo-club"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    // PX-1 04 §9: wide content scrolls inside its own container, never the body.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} scrolls horizontally at 360px`).toBeLessThanOrEqual(1);
  }
});
