import { launch, signIn, log, BASE, latestOtp, resetOtpBudget } from "./lib";
import { seatCaptains } from "./captains";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
const { slug, teams } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));
const roster = JSON.parse(readFileSync("rehearsal/artifacts/captains.json", "utf8")).map(
  (c: any) => ({ name: c.name, phone: c.phone, team: c.team }),
);

async function probe(p: Page, path: string): Promise<string> {
  const res = await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => null);
  await p.waitForTimeout(400);
  const status = res?.status() ?? 0;
  const url = new URL(p.url()).pathname;
  const body = (
    await p
      .locator("body")
      .innerText()
      .catch(() => "")
  )
    .slice(0, 120)
    .replace(/\n+/g, " ");
  return `${status} → ${url} :: ${body}`;
}

async function main() {
  const b = await launch(true);
  const caps = await seatCaptains(b, slug, roster.slice(0, 2), { width: 1440, height: 900 });
  const cap1 = caps[0]!; // Chargers
  const cap2 = caps[1]!; // Rangers
  const rangersId = (teams as any[]).find((t) => t.name === "Sunrise Rangers").id;
  const chargersId = (teams as any[]).find((t) => t.name === "Sunrise Chargers").id;

  log("=== CAPTAIN 1 (team owner, no conduct grant) ===");
  for (const path of [
    `/seasons/${slug}/auction/cockpit`,
    `/seasons/${slug}/auction/ledger`,
    `/seasons/${slug}/auction/replay`,
    `/seasons/${slug}/auction/engine`,
    `/seasons/${slug}/money`,
    `/seasons/${slug}/registrations`,
    `/seasons/${slug}/teams?team=${rangersId}`,
    `/seasons/${slug}/readiness`,
    `/org/demo-club`,
    `/admin`,
    `/admin/users`,
  ])
    log(`  ${path.padEnd(56)} ${await probe(cap1.page, path)}`);

  // Does captain 1's live payload carry captain 2's purse?
  await cap1.page.goto(`${BASE}/seasons/${slug}/auction/live`);
  await cap1.page.waitForLoadState("networkidle");
  const html = await cap1.page.content();
  const own = (teams as any[]).find((t) => t.id === chargersId).name;
  log("\n=== PAYLOAD SEAL (captain 1 view-source) ===");
  log("  own team name present:", html.includes(own));
  log(
    "  rival team names present (expected, they are public):",
    (teams as any[]).filter((t) => t.id !== chargersId).every((t) => html.includes(t.name)),
  );
  // purse figures: only one 20,00,000 should be attributable; look for committed of others
  const purseHits = [...html.matchAll(/committed/g)].length;
  log("  occurrences of 'committed' in payload:", purseHits);
  log("  'purse sealed' present:", html.includes("purse sealed"));
  const roster2 = await cap1.page
    .getByTestId("squad-board")
    .innerText()
    .catch(() => "");
  log("  squad board visible to captain 1:", roster2.replace(/\n+/g, " | ").slice(0, 220));

  // Unauthenticated
  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon.newPage();
  log("\n=== UNAUTHENTICATED ===");
  for (const path of [
    `/seasons/${slug}/auction/live`,
    `/seasons/${slug}/auction/cockpit`,
    `/seasons/${slug}/registrations`,
    `/seasons/${slug}/money`,
    `/seasons/${slug}/auction/spectate`,
    `/seasons/${slug}/auction/board`,
    `/seasons/${slug}/auction/overlay`,
    `/c/${slug}`,
    `/admin`,
    `/dev/inbox`,
  ])
    log(`  ${path.padEnd(56)} ${await probe(ap, path)}`);

  // A signed-in stranger with no relationship to this season at all.
  const strangerPhone = "8805000001";
  await resetOtpBudget(strangerPhone);
  const sctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const sp = await sctx.newPage();
  await sp.goto(`${BASE}/login`);
  await sp.getByLabel("Mobile number").fill(strangerPhone);
  await sp.getByRole("button", { name: "Send code" }).click();
  await sp.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
    undefined,
    { timeout: 25000 },
  );
  await sp.getByLabel("6-digit code").fill(await latestOtp(strangerPhone));
  await sp.getByRole("button", { name: "Verify and continue" }).click();
  await sp.waitForTimeout(2000);
  const g = sp.getByLabel("What should we call you?");
  if (await g.isVisible().catch(() => false)) {
    await g.fill("Random Stranger");
    await sp.getByRole("button", { name: "Continue" }).click();
    await sp.waitForTimeout(1500);
  }
  log("\n=== SIGNED-IN STRANGER (no membership) ===");
  for (const path of [
    `/seasons/${slug}`,
    `/seasons/${slug}/auction/live`,
    `/seasons/${slug}/auction/spectate`,
    `/seasons/${slug}/registrations`,
    `/seasons/${slug}/teams`,
    `/c/${slug}`,
    `/admin`,
  ])
    log(`  ${path.padEnd(56)} ${await probe(sp, path)}`);

  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
