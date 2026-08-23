import { type Browser, type Page } from "@playwright/test";
import { BASE, latestOtp, resetOtpBudget } from "./lib";

export interface PlayerSpec {
  phone: string; // 10-digit
  name: string;
  role: "batter" | "bowler" | "all_rounder" | "keeper";
  dateOfBirth?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  photo?: { name: string; mimeType: string; buffer: Buffer };
  viewport?: { width: number; height: number };
}

export interface RegisterOutcome {
  ok: boolean;
  finalUrl: string;
  finalText: string;
  errors: string[];
  ms: number;
}

const ROLE_VALUE: Record<string, string> = {
  batter: "batter",
  bowler: "bowler",
  all_rounder: "all_rounder",
  keeper: "keeper",
};

/** Drive one player, in their own browser context, exactly as a phone would. */
export async function registerPlayer(browser: Browser, spec: PlayerSpec): Promise<RegisterOutcome> {
  const started = Date.now();
  const errors: string[] = [];
  const ctx = await browser.newContext({
    viewport: spec.viewport ?? { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p: Page = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  p.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  try {
    const slug = process.env["REHEARSAL_SLUG"] as string;
    await resetOtpBudget(spec.phone);
    await p.goto(`${BASE}/seasons/${slug}/register`);
    const cta = p.getByRole("link", { name: "Verify my mobile and register" });
    if (await cta.isVisible().catch(() => false)) await cta.click();
    await p.waitForURL(/\/login/, { timeout: 20_000 });
    await p.getByLabel("Mobile number").fill(spec.phone);
    await p.getByRole("button", { name: "Send code" }).click();
    await p.waitForFunction(
      () =>
        document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
      undefined,
      { timeout: 25_000 },
    );
    await p.getByLabel("6-digit code").fill(await latestOtp(spec.phone));
    await p.getByRole("button", { name: "Verify and continue" }).click();
    await p.waitForURL((u) => u.pathname.includes("/register"), { timeout: 30_000 });

    // step 1 — name
    const profile = p.getByTestId("register-step-profile");
    if (await profile.isVisible().catch(() => false)) {
      await p.getByLabel("Your name").fill(spec.name);
      await profile.getByRole("button", { name: "Continue" }).click();
    }
    // step 2 — role
    const role = p.getByTestId("register-step-role");
    await role.waitFor({ timeout: 25_000 });
    await p.getByLabel("Playing role").selectOption(ROLE_VALUE[spec.role] as string);
    if (spec.dateOfBirth) await p.getByLabel("Date of birth (optional)").fill(spec.dateOfBirth);
    if (spec.battingStyle)
      await p.getByLabel("Batting style (optional)").selectOption(spec.battingStyle);
    if (spec.bowlingStyle)
      await p.getByLabel("Bowling style (optional)").selectOption(spec.bowlingStyle);
    await p.getByTestId("register-continue").click();

    // step 3 — review, consent, submit
    await p.getByRole("button", { name: "Submit registration" }).waitFor({ timeout: 25_000 });
    if (spec.photo) {
      await p.locator('input[type="file"]').first().setInputFiles(spec.photo);
      await p.waitForTimeout(2500);
    }
    await p.getByRole("checkbox").first().check();
    await p.getByRole("button", { name: "Submit registration" }).click();
    await p.waitForTimeout(3000);
    const text = await p.locator("main").innerText();
    return {
      ok: /Registration submitted|You.re in the player pool|withdraw/i.test(text),
      finalUrl: p.url(),
      finalText: text.slice(0, 900),
      errors,
      ms: Date.now() - started,
    };
  } catch (e) {
    errors.push(`THREW: ${(e as Error).message.split("\n")[0]}`);
    return {
      ok: false,
      finalUrl: p.url(),
      finalText: await p
        .locator("body")
        .innerText()
        .catch(() => ""),
      errors,
      ms: Date.now() - started,
    };
  } finally {
    await ctx.close();
  }
}
