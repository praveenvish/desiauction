import { launch, signIn, log, BASE, withDb } from "./lib";
async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001", {
    viewport: { width: 1280, height: 900 },
  });
  const p = o.page;
  // a fresh season, then put it on the Free tier as GA would
  await p.goto(`${BASE}/tournaments`, { waitUntil: "networkidle" });
  await p.getByTestId("tg-mode-seasons").click();
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "+ New season" }).click();
  const d = p.getByRole("dialog");
  await d.waitFor();
  await d.getByLabel("Season name").fill("Free Tier Ceiling Test");
  await d.getByRole("button", { name: "Create season" }).click();
  await p.waitForURL(/\/seasons\/[^/]+$/, { timeout: 30000 });
  const slug = new URL(p.url()).pathname.split("/")[2] as string;
  await withDb(async (h) => h.sql`update competitions set tier='free' where slug=${slug}`);
  log("season:", slug, "tier: free");

  await p.goto(`${BASE}/seasons/${slug}/teams`, { waitUntil: "networkidle" });
  for (let n = 1; n <= 5; n++) {
    await p.getByTestId("open-add-team").or(p.getByTestId("open-add-team-empty")).first().click();
    const dlg = p.getByRole("dialog");
    await dlg.waitFor();
    await dlg.getByLabel("Team name").fill(`Ceiling Team ${n}`);
    await dlg.getByTestId("add-team-workspace").click();
    await p.waitForTimeout(1800);
    const err = await dlg
      .locator('[class*="error"], [role="alert"]')
      .first()
      .innerText()
      .catch(() => "");
    const stillOpen = await dlg.isVisible().catch(() => false);
    log(
      `team ${n}: ${stillOpen ? "REFUSED" : "created"}${err ? ` — "${err.replace(/\n/g, " ")}"` : ""}`,
    );
    if (stillOpen) {
      await p.screenshot({ path: "rehearsal/mobile/f-tier-block.png" });
      break;
    }
  }
  const count = await withDb(
    async (h) => h.sql`
    select count(*)::int as n from teams t join competitions c on c.id=t.competition_id where c.slug=${slug}`,
  );
  log("teams in db:", JSON.stringify(count));
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
