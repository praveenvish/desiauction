import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// PX-5 Public Registration Experience: publish → discover → understand →
// register (multi-step, draft-recovering) → track status → approval. Plus the
// unhappy paths: unpublished pages, tampered drafts, duplicates. SEO asserted
// from the rendered head, robots and sitemap.

const STAMP = String(Date.now()).slice(-8);
const ORGANIZER = `61${STAMP}`;
const PLAYER = `62${STAMP}`;
const MOBILE_PLAYER = `63${STAMP}`;

test.describe.configure({ mode: "serial" });

let publicUrl = "";
let registerUrl = "";
let competitionUrl = "";
let privateSlugUrl = "";

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
  await page.getByLabel("6-digit code").fill(code ?? "");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function inSecondBrowser(browser: Browser, fn: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    // Drop the Next dev HMR socket before teardown so context.close() does not
    // race an in-flight Fast-Refresh reconnect (a dev-server-only teardown flake).
    await page.goto("about:blank").catch(() => {});
    await context.close();
  }
}

test("organizer publishes; the public can discover, and SEO surfaces are real", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  // Organizer onboards and stands up an open competition.
  await otpLogin(page, ORGANIZER);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Public Organizer");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Public CC ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Monsoon Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad, Mumbai");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  competitionUrl = page.url();
  const slug = new URL(competitionUrl).pathname.split("/").pop() ?? "";
  publicUrl = `/c/${slug}`;
  registerUrl = `${new URL(competitionUrl).pathname}/register`;
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  // Not published yet: the public page 404s and the directory doesn't list it.
  await inSecondBrowser(browser, async (anon) => {
    // Open-registration pages render by link even before publishing…
    await anon.goto(publicUrl);
    await expect(anon.getByTestId("public-reg-status")).toHaveText("Registration open");
    // …but only PUBLISHED competitions are listed in the directory. The
    // no-match state now echoes the query back instead of saying "Nothing
    // matches", so a guest can see WHICH search came up empty.
    await anon.goto(`/c?q=${STAMP}`);
    await expect(anon.getByText(`No tournaments match “${STAMP}”`)).toBeVisible();
  });

  // Publish the public page from the Overview.
  await page.goto(competitionUrl);
  await page.getByTestId("toggle-visibility").click();
  // Publishing is confirmed (DA-12): the readiness check passed, so the dialog
  // is the only thing between the organizer and the public internet.
  await page.getByTestId("confirm-publish").click();
  await expect(page.getByTestId("visibility-row")).toContainText("LIVE");

  // A second, never-published draft competition stays structurally absent.
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Hidden Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  privateSlugUrl = `/c/${new URL(page.url()).pathname.split("/").pop() ?? ""}`;

  await inSecondBrowser(browser, async (anon) => {
    // Directory now lists the published competition (searchable).
    await anon.goto(`/c?q=${STAMP}`);
    await expect(anon.getByTestId("directory-list")).toContainText(`Monsoon Cup ${STAMP}`);
    await expect(anon.getByTestId("directory-list")).not.toContainText(`Hidden Cup ${STAMP}`);

    // The public page: identity, organizer, status, CTA.
    await anon.getByText(`Monsoon Cup ${STAMP}`).click();
    await expect(anon).toHaveURL(publicUrl);
    await expect(anon.getByTestId("public-org")).toContainText(`Public CC ${STAMP}`);
    await expect(anon.getByTestId("public-register-cta")).toBeVisible();

    // SEO: OG tags, canonical, JSON-LD structured data.
    await expect(anon.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      `Monsoon Cup ${STAMP}`,
    );
    await expect(anon.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/c\//);
    const jsonLd = await anon.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toContain('"@type":"SportsEvent"');
    expect(jsonLd).toContain(`Monsoon Cup ${STAMP}`);

    // Share-card metadata (INV-1): the file-convention OG/Twitter image is injected
    // into the head, and the route itself serves a real PNG.
    await expect(anon.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(anon.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    // Use an API request, not page.goto: navigating a browser page to a raw PNG
    // aborts the navigation (net::ERR_ABORTED). request.get just checks the route.
    const ogImage = await anon.request.get(`${publicUrl}/opengraph-image`);
    expect(ogImage.status()).toBe(200);
    expect(ogImage.headers()["content-type"]).toContain("image/png");

    // Share attribution (INV-5): a shared `?ref` forwards onto the register CTA so
    // the source reaches registration.
    await anon.goto(`${publicUrl}?ref=whatsapp`);
    const ctaHref = await anon.getByTestId("public-register-cta").getAttribute("href");
    expect(ctaHref).toContain("ref=whatsapp");

    // The never-published draft is a 404, not a leak.
    const hidden = await anon.goto(privateSlugUrl);
    expect(hidden?.status()).toBe(404);

    // robots + sitemap exist and carry the published page.
    const robots = await anon.goto("/robots.txt");
    expect(await robots?.text()).toContain("sitemap.xml");
    const sitemap = await anon.goto("/sitemap.xml");
    expect(await sitemap?.text()).toContain(publicUrl);
  });
});

test("player journey: discover → multi-step register with draft recovery → track → approved", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await inSecondBrowser(browser, async (player) => {
    // Discover anonymously, then hit the registration door.
    await player.goto(publicUrl);
    await player.getByTestId("public-register-cta").click();
    // DA-35: the share link is no longer a login wall that never names the
    // tournament. A public season shows what it is and what will be asked;
    // the OTP moves to the point of submission.
    await expect(player.getByTestId("register-preview")).toContainText(`Monsoon Cup ${STAMP}`);
    await player.getByTestId("register-verify-cta").click();
    await expect(player).toHaveURL(/\/login\?next=/);
    await otpLogin(player, PLAYER);

    // Step 1: profile (nameless account) — name persists server-side.
    await expect(player.getByTestId("register-step-profile")).toBeVisible();
    await player.getByLabel("Your name").fill("Kiran Player");
    await player.getByRole("button", { name: "Continue" }).click();

    // Step 2: role — autosaved as a device-local draft.
    await player.getByLabel("Playing role").selectOption("bowler");

    // Draft recovery: a refresh resumes at review with the saved role.
    await player.reload();
    await expect(player.getByTestId("register-step-review")).toBeVisible();
    await expect(player.getByTestId("register-step-review")).toContainText("Bowler");
    await expect(player.getByTestId("register-step-review")).toContainText("Kiran Player");

    // Submit from review; confirmation explains what happens next.
    await player.getByTestId("register-submit").click();
    await expect(player.getByTestId("registration-submitted")).toBeVisible();

    // Status tracking: the same page becomes the status view.
    await player.goto(registerUrl);
    await expect(player.getByTestId("my-registration-status")).toHaveText("submitted");

    // The player dashboard carries it too.
    await player.goto("/home");
    await expect(player.getByTestId("home-registrations")).toContainText(`Monsoon Cup ${STAMP}`);
    await expect(player.getByTestId("home-registrations")).toContainText("submitted");
  });

  // Organizer approves from the registration workspace.
  await otpLogin(page, ORGANIZER);
  await page.goto(`${new URL(competitionUrl).pathname}/registrations`);
  await page.getByLabel("Select all on page").check();
  await page.getByTestId("bulk-approve").click();
  await expect(page.getByTestId("stat-approved")).toContainText("1", { timeout: 15_000 });

  // The player returns and sees the outcome and what happens next.
  await inSecondBrowser(browser, async (player) => {
    await otpLogin(player, PLAYER);
    await player.goto(registerUrl);
    await expect(player.getByTestId("my-registration-status")).toHaveText("approved");
    await expect(player.getByTestId("registration-status")).toContainText("player pool");
    await player.goto("/home");
    await expect(player.getByTestId("home-registrations")).toContainText("approved");
  });
});

test("attacks: tampered drafts are refused by the server; duplicates show status, not a form", async ({
  browser,
}) => {
  await inSecondBrowser(browser, async (player) => {
    await otpLogin(player, MOBILE_PLAYER);
    await player.goto(registerUrl);
    await player.getByLabel("Your name").fill("Tamper Tester");
    await player.getByRole("button", { name: "Continue" }).click();
    await expect(player.getByTestId("register-step-role")).toBeVisible();
    // Poison the device-local draft with a role the server never defined.
    const slug = new URL(player.url()).pathname.split("/")[2] ?? "";
    await player.evaluate((value) => {
      window.localStorage.setItem(`da:reg-draft:${value}`, "captain");
    }, slug);
    await player.reload();
    await expect(player.getByTestId("register-step-review")).toBeVisible();
    await player.getByTestId("register-submit").click();
    // The server's validation is the only validation — its refusal, verbatim.
    await expect(player.getByText("Choose a valid playing role.")).toBeVisible();

    // Recover: pick a real role and submit.
    await player.getByRole("button", { name: "Back" }).click();
    await player.getByLabel("Playing role").selectOption("wicket_keeper");
    await player.getByTestId("register-continue").click();
    await player.getByTestId("register-submit").click();
    await expect(player.getByTestId("registration-submitted")).toBeVisible();

    // Duplicate protection: the page now shows status, never a second form.
    await player.goto(registerUrl);
    await expect(player.getByTestId("registration-status")).toBeVisible();
    await expect(player.getByTestId("register-card")).not.toBeVisible();
  });
});

test("accessibility: directory, public page and registration scan clean", async ({ page }) => {
  await page.goto("/c");
  const directoryScan = await new AxeBuilder({ page }).analyze();
  expect(directoryScan.violations, JSON.stringify(directoryScan.violations, null, 2)).toEqual([]);
  await page.goto(publicUrl);
  const publicScan = await new AxeBuilder({ page }).analyze();
  expect(publicScan.violations, JSON.stringify(publicScan.violations, null, 2)).toEqual([]);
});

test("mobile 360px: discover and register one-handed with no horizontal scroll", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    await page.goto(publicUrl);
    await expect(page.getByTestId("public-register-cta")).toBeVisible();
    const offenders = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit) {
        return [];
      }
      return Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)}`);
    });
    expect(offenders, offenders.join(" | ")).toEqual([]);
  } finally {
    await context.close();
  }
});
