/**
 * Rehearsal harness — real Chromium, one independent browser context per human.
 *
 * This is NOT the e2e suite. The e2e suite proves the product does what it was
 * built to do. This drives it the way an auction night will: six people on six
 * devices, eighty players, one operator who will make mistakes, and a clock.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createDb, otpCodes, otpInbox } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

export const BASE = process.env["REHEARSAL_BASE"] ?? "http://127.0.0.1:3100";
export const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

export function db() {
  return createDb(DATABASE_URL);
}

/** Run one SQL-ish unit of work and always close the pool. */
export async function withDb<T>(fn: (d: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const handle = createDb(DATABASE_URL);
  try {
    return await fn(handle);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** The most recent code minted for a phone (dev inbox row, read from the DB). */
export async function latestOtp(phone: string, timeoutMs = 10_000): Promise<string> {
  const e164 = phone.startsWith("+") ? phone : `+91${phone}`;
  return withDb(async (h) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await h.db
        .select({ code: otpInbox.code })
        .from(otpInbox)
        .where(eq(otpInbox.phone, e164))
        .orderBy(desc(otpInbox.createdAt))
        .limit(1);
      if (row !== undefined) return row.code;
      if (Date.now() >= deadline) throw new Error(`no OTP minted for ${e164}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
}

/**
 * Clear the harness's own consumption of the 5-codes-per-hour budget.
 * The control itself is untouched in the product and is tested separately.
 */
export async function resetOtpBudget(phone: string): Promise<void> {
  const e164 = phone.startsWith("+") ? phone : `+91${phone}`;
  await withDb(async (h) => {
    await h.db.delete(otpCodes).where(eq(otpCodes.phone, e164));
  });
}

export interface Observed {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
}

/** Attach console/network observers to a page; returns the growing record. */
export function observe(page: Page, label: string): Observed {
  const rec: Observed = { consoleErrors: [], pageErrors: [], badResponses: [] };
  page.on("console", (m) => {
    if (m.type() === "error") rec.consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => rec.pageErrors.push(`[${label}] ${e.message}`));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400) rec.badResponses.push(`[${label}] ${s} ${r.request().method()} ${r.url()}`);
  });
  return rec;
}

export interface Human {
  name: string;
  phone: string; // 10-digit local
  context: BrowserContext;
  page: Page;
  observed: Observed;
}

export async function launch(headless = true): Promise<Browser> {
  return chromium.launch({ headless });
}

/**
 * Sign a person in through the real login form, in their own context.
 * Clears the name gate if it appears (a brand-new account meets it anywhere).
 */
export async function signIn(
  browser: Browser,
  name: string,
  phone: string,
  opts: { viewport?: { width: number; height: number }; next?: string } = {},
): Promise<Human> {
  await resetOtpBudget(phone);
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const observed = observe(page, name);
  await page.goto(`${BASE}/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByTestId("login-form").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
    undefined,
    { timeout: 15_000 },
  );
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  const gate = page.getByLabel("What should we call you?");
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 20_000 });
  }
  return { name, phone, context, page, observed };
}

export const log = (...args: unknown[]) => {
  console.log(new Date().toISOString().slice(11, 23), ...args);
};

export function summariseObserved(humans: Human[]): void {
  for (const h of humans) {
    const o = h.observed;
    if (o.consoleErrors.length || o.pageErrors.length || o.badResponses.length) {
      console.log(`\n--- observed: ${h.name} ---`);
      o.pageErrors.slice(0, 10).forEach((x) => console.log("  pageerror:", x));
      o.consoleErrors.slice(0, 10).forEach((x) => console.log("  console:", x));
      o.badResponses.slice(0, 20).forEach((x) => console.log("  http:", x));
    }
  }
}
