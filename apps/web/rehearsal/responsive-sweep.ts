import { launch, log, BASE, latestOtp, resetOtpBudget } from "./lib";
import { readFileSync, writeFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
const ART = "rehearsal/artifacts";
const { slug } = JSON.parse(readFileSync(`${ART}/season.json`, "utf8"));
const cup = JSON.parse(readFileSync(`${ART}/cup.json`, "utf8"));
const caps0 = JSON.parse(readFileSync(`${ART}/captains.json`, "utf8"));

const WIDTHS = [
  { w: 375, h: 812, name: "iPhone SE/X" },
  { w: 390, h: 844, name: "iPhone 14" },
  { w: 412, h: 915, name: "Pixel 7" },
  { w: 768, h: 1024, name: "iPad portrait" },
  { w: 820, h: 1180, name: "iPad Air" },
  { w: 1024, h: 768, name: "iPad landscape" },
  { w: 1280, h: 800, name: "laptop" },
  { w: 1440, h: 900, name: "desktop" },
];

const SCREENS_ORG = [
  ["home", "/home"],
  ["season overview", `/seasons/${slug}`],
  ["teams", `/seasons/${slug}/teams`],
  ["registrations", `/seasons/${slug}/registrations`],
  ["auction setup", `/seasons/${slug}/auction`],
  ["cockpit", `/seasons/${cup.slug}/auction/cockpit`],
  ["ledger", `/seasons/${slug}/auction/ledger`],
  ["money", `/seasons/${slug}/money`],
  ["account", `/account`],
] as [string, string][];

const SCREENS_PUBLIC = [
  ["landing", "/"],
  ["public season", `/c/${slug}`],
  ["player page", `/c/${slug}/p/R3DT3P2`],
  ["directory", "/c"],
  ["register", `/seasons/${slug}/register`],
  ["login", "/login"],
  ["pricing", "/pricing"],
  ["help", "/help"],
  ["spectate", `/seasons/${slug}/auction/spectate`],
] as [string, string][];

interface Row {
  screen: string;
  w: number;
  overflowPx: number;
  smallTargets: number;
  consoleErrors: number;
  http4xx5xx: string[];
}

async function audit(
  p: Page,
  screen: string,
  path: string,
  w: number,
  h: number,
  rows: Row[],
  errs: { c: string[]; n: string[] },
) {
  errs.c.length = 0;
  errs.n.length = 0;
  await p.setViewportSize({ width: w, height: h });
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(700);
  const metrics = await p
    .evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      // interactive controls smaller than the 24×24 CSS-px floor (WCAG 2.2 SC 2.5.8)
      const els = [
        ...document.querySelectorAll(
          "a[href],button,input,select,textarea,[role=button],[role=tab]",
        ),
      ];
      let small = 0;
      const offenders: string[] = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // hidden
        const cs = getComputedStyle(el as Element);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        if (r.width < 24 || r.height < 24) {
          small++;
          if (offenders.length < 4)
            offenders.push(
              `${el.tagName.toLowerCase()}"${(el.textContent ?? "").trim().slice(0, 22)}"${Math.round(r.width)}x${Math.round(r.height)}`,
            );
        }
      }
      return { overflow, small, offenders };
    })
    .catch(() => ({ overflow: -1, small: -1, offenders: [] as string[] }));
  rows.push({
    screen,
    w,
    overflowPx: metrics.overflow,
    smallTargets: metrics.small,
    consoleErrors: errs.c.length,
    http4xx5xx: [...errs.n],
  });
  if (metrics.overflow > 0 || metrics.small > 0 || errs.c.length > 0 || errs.n.length > 0) {
    log(
      `  ${screen.padEnd(18)} ${String(w).padStart(4)}px  overflow=${metrics.overflow}px  small-targets=${metrics.small} ${JSON.stringify(metrics.offenders)}  console=${errs.c.length} http=${JSON.stringify(errs.n.slice(0, 3))}`,
    );
  }
}

async function main() {
  const b = await launch(true);
  const rows: Row[] = [];
  const errs = { c: [] as string[], n: [] as string[] };

  // signed-in organizer
  await resetOtpBudget("9999000001");
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("console", (m) => {
    if (m.type() === "error") errs.c.push(m.text());
  });
  p.on("pageerror", (e) => errs.c.push("pageerror: " + e.message));
  p.on("response", (r) => {
    if (r.status() >= 400) errs.n.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  });
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Mobile number").fill("9999000001");
  await p.getByRole("button", { name: "Send code" }).click();
  await p.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
    undefined,
    { timeout: 25000 },
  );
  await p.getByLabel("6-digit code").fill(await latestOtp("9999000001"));
  await p.getByRole("button", { name: "Verify and continue" }).click();
  await p.waitForTimeout(2500);

  log("=== ORGANIZER SCREENS (issues only) ===");
  for (const [screen, path] of SCREENS_ORG)
    for (const v of WIDTHS) await audit(p, screen, path, v.w, v.h, rows, errs);

  log("\n=== PUBLIC SCREENS (issues only) ===");
  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon.newPage();
  ap.on("console", (m) => {
    if (m.type() === "error") errs.c.push(m.text());
  });
  ap.on("pageerror", (e) => errs.c.push("pageerror: " + e.message));
  ap.on("response", (r) => {
    if (r.status() >= 400) errs.n.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  });
  for (const [screen, path] of SCREENS_PUBLIC)
    for (const v of WIDTHS) await audit(ap, screen, path, v.w, v.h, rows, errs);

  // the bidder's own room, on every width
  log("\n=== BIDDER LIVE ROOM (issues only) ===");
  await resetOtpBudget(caps0[0].phone);
  const bctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const bp = await bctx.newPage();
  bp.on("console", (m) => {
    if (m.type() === "error") errs.c.push(m.text());
  });
  bp.on("pageerror", (e) => errs.c.push("pageerror: " + e.message));
  bp.on("response", (r) => {
    if (r.status() >= 400) errs.n.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  });
  await bp.goto(`${BASE}/login?next=${encodeURIComponent(`/seasons/${cup.slug}/auction/live`)}`);
  await bp.getByLabel("Mobile number").fill(caps0[0].phone);
  await bp.getByRole("button", { name: "Send code" }).click();
  await bp.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
    undefined,
    { timeout: 25000 },
  );
  await bp.getByLabel("6-digit code").fill(await latestOtp(caps0[0].phone));
  await bp.getByRole("button", { name: "Verify and continue" }).click();
  await bp.waitForTimeout(2500);
  for (const v of WIDTHS)
    await audit(bp, "live room", `/seasons/${cup.slug}/auction/live`, v.w, v.h, rows, errs);

  writeFileSync(`${ART}/responsive.json`, JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflowPx > 0);
  const tiny = rows.filter((r) => r.smallTargets > 0);
  log(`\nSUMMARY: ${rows.length} screen×width combinations`);
  log(
    `  horizontal overflow: ${bad.length} (${[...new Set(bad.map((r) => `${r.screen}@${r.w}`))].join(", ") || "none"})`,
  );
  log(
    `  sub-24px targets:    ${tiny.length} (${[...new Set(tiny.map((r) => r.screen))].join(", ") || "none"})`,
  );
  log(`  console errors:      ${rows.reduce((a, r) => a + r.consoleErrors, 0)}`);
  log(`  4xx/5xx responses:   ${rows.reduce((a, r) => a + r.http4xx5xx.length, 0)}`);
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
