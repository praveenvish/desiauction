import { launch, signIn, log, BASE, withDb } from "./lib";
const T = { timeout: 3000 };
async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001", {
    viewport: { width: 1280, height: 900 },
  });
  const p = o.page;
  await p.goto(`${BASE}/tournaments`, { waitUntil: "networkidle" });
  await p.getByTestId("tg-mode-seasons").click();
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "+ New season" }).click();
  const d = p.getByRole("dialog");
  await d.waitFor();
  await d.getByLabel("Season name").fill("Round Trip Test");
  await d.getByRole("button", { name: "Create season" }).click();
  await p.waitForURL(/\/seasons\/[^/]+$/, { timeout: 30000 });
  const slug = new URL(p.url()).pathname.split("/")[2] as string;

  // beta grant first — the card should say it is uncounted
  await p.reload({ waitUntil: "networkidle" });
  log(
    "BETA SEASON CARD: " + (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "),
  );

  // now put it on Free, as GA would
  await withDb(async (h) => h.sql`update competitions set tier='free' where slug=${slug}`);
  await p.reload({ waitUntil: "networkidle" });
  log(
    "\nFREE SEASON CARD: " +
      (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "),
  );

  // fill to the ceiling
  await p.goto(`${BASE}/seasons/${slug}/teams`, { waitUntil: "networkidle" });
  for (let n = 1; n <= 4; n++) {
    await p.getByTestId("open-add-team").or(p.getByTestId("open-add-team-empty")).first().click();
    const dlg = p.getByRole("dialog");
    await dlg.waitFor();
    await dlg.getByLabel("Team name").fill(`Pass Team ${n}`);
    await dlg.getByTestId("add-team-workspace").click();
    await p.waitForTimeout(1500);
  }
  await p.goto(`${BASE}/seasons/${slug}`, { waitUntil: "networkidle" });
  log(
    "\nAT THE CEILING: " + (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "),
  );
  await p.screenshot({ path: "rehearsal/mobile/f-pass-full.png" });

  // ask for more room
  await p.getByTestId("open-pass-request").click();
  const rd = p.getByRole("dialog");
  await rd.waitFor();
  log("\nREQUEST DIALOG: " + (await rd.innerText()).replace(/\n+/g, " | ").slice(0, 400));
  await rd
    .getByLabel("What do you need it for? (optional)")
    .fill("Twelve teams, auction on 14 Sep.");
  await rd.getByTestId("send-pass-request").click();
  await p.waitForTimeout(3000);
  log(
    "\nTOAST: " +
      JSON.stringify(
        (await p.locator("[role='status'],[role='alert']").allInnerTexts())
          .filter((t) => t.trim())
          .slice(0, 3),
      ),
  );
  await p.reload({ waitUntil: "networkidle" });
  log("AFTER REQUEST: " + (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "));
  const rows = await withDb(
    async (h) => h.sql`
    select from_tier, requested_tier, note, resolved_at from pass_upgrade_requests r
    join competitions c on c.id=r.competition_id where c.slug=${slug}`,
  );
  log("DB: " + JSON.stringify(rows));
  log("SLUG: " + slug);
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
