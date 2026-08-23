import { launch, signIn, log, BASE, withDb } from "./lib";
const T = { timeout: 3000 };
async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001", { viewport: { width: 1280, height: 900 } });
  const p = o.page;

  // 1 — an organizer on Free asks
  await p.goto(`${BASE}/tournaments`, { waitUntil: "networkidle" });
  await p.getByTestId("tg-mode-seasons").click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "+ New season" }).click();
  const d = p.getByRole("dialog"); await d.waitFor();
  await d.getByLabel("Season name").fill("Admin Grant Test");
  await d.getByRole("button", { name: "Create season" }).click();
  await p.waitForURL(/\/seasons\/[^/]+$/, { timeout: 30000 });
  const slug = new URL(p.url()).pathname.split("/")[2] as string;
  await withDb(async (h) => h.sql`update competitions set tier='free' where slug=${slug}`);
  await p.goto(`${BASE}/seasons/${slug}/teams`, { waitUntil: "networkidle" });
  for (let n = 1; n <= 4; n++) {
    await p.getByTestId("open-add-team").or(p.getByTestId("open-add-team-empty")).first().click();
    const dlg = p.getByRole("dialog"); await dlg.waitFor();
    await dlg.getByLabel("Team name").fill(`Grant Team ${n}`);
    await dlg.getByTestId("add-team-workspace").click();
    await p.waitForTimeout(1400);
  }
  await p.goto(`${BASE}/seasons/${slug}`, { waitUntil: "networkidle" });
  await p.getByTestId("open-pass-request").click();
  const rd = p.getByRole("dialog"); await rd.waitFor();
  await rd.getByLabel("What do you need it for? (optional)").fill("Ten teams; auction 20 Sep.");
  await rd.getByTestId("send-pass-request").click();
  await p.waitForTimeout(2500);
  log("organizer asked for:", slug);

  // 2 — the operator opens the queue
  await p.goto(`${BASE}/admin/passes`, { waitUntil: "networkidle" });
  log("\n=== /admin/passes ===");
  log((await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 900));
  await p.screenshot({ path: "rehearsal/mobile/f-admin-passes.png" });

  // 3 — grant it
  await p.getByTestId(`grant-${slug}`).click();
  await p.waitForTimeout(3000);
  log("\nTOAST: " + JSON.stringify((await p.locator("[role='status'],[role='alert']").allInnerTexts()).filter((t) => t.trim()).slice(0, 2)));
  await p.reload({ waitUntil: "networkidle" });
  log("QUEUE AFTER: " + (await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 400));

  // 4 — the organizer sees it
  await p.goto(`${BASE}/seasons/${slug}`, { waitUntil: "networkidle" });
  log("\nORGANIZER CARD: " + (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "));
  const rows = await withDb(async (h) => h.sql`
    select c.tier, r.outcome from competitions c
    left join pass_upgrade_requests r on r.competition_id=c.id where c.slug=${slug}`);
  log("DB: " + JSON.stringify(rows));
  log("SLUG: " + slug);
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
