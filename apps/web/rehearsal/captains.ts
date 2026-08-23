import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE, latestOtp, resetOtpBudget, observe, type Observed } from "./lib";

export interface Captain {
  i: number;
  name: string;
  phone: string;
  team: string;
  ctx: BrowserContext;
  page: Page;
  observed: Observed;
}

/** Six independent devices, six independent cookie jars. */
export async function seatCaptains(
  b: Browser,
  slug: string,
  roster: { name: string; phone: string; team: string }[],
  viewport = { width: 390, height: 844 },
): Promise<Captain[]> {
  const out: Captain[] = [];
  for (let i = 0; i < roster.length; i++) {
    const r = roster[i] as { name: string; phone: string; team: string };
    await resetOtpBudget(r.phone);
    const ctx = await b.newContext({
      viewport,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500,
    });
    const page = await ctx.newPage();
    const observed = observe(page, r.name);
    await page.goto(`${BASE}/login?next=${encodeURIComponent(`/seasons/${slug}/auction/live`)}`);
    await page.getByLabel("Mobile number").fill(r.phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
      undefined,
      { timeout: 25_000 },
    );
    await page.getByLabel("6-digit code").fill(await latestOtp(r.phone));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.waitForURL((u) => u.pathname.includes("/auction/live"), { timeout: 30_000 });
    await page.waitForTimeout(1200);
    out.push({ i, ...r, ctx, page, observed });
  }
  return out;
}
