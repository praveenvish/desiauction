import { launch, signIn, log, BASE, withDb } from "./lib";
const SLUG = "round-trip-test-661w";
async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001", {
    viewport: { width: 1280, height: 900 },
  });
  const p = o.page;
  await p.goto(`${BASE}/seasons/${SLUG}`, { waitUntil: "networkidle" });
  log(
    "CARD AFTER GRANT: " + (await p.getByTestId("season-pass").innerText()).replace(/\n+/g, " | "),
  );
  // the ceiling should have lifted
  await p.goto(`${BASE}/seasons/${SLUG}/teams`, { waitUntil: "networkidle" });
  await p.getByTestId("open-add-team").first().click();
  const d = p.getByRole("dialog");
  await d.waitFor();
  await d.getByLabel("Team name").fill("Fifth Team Now Allowed");
  await d.getByTestId("add-team-workspace").click();
  await p.waitForTimeout(2000);
  const stillOpen = await d.isVisible().catch(() => false);
  log("fifth team after grant: " + (stillOpen ? "STILL REFUSED" : "created"));
  const rows = await withDb(
    async (h) => h.sql`
    select c.tier, (select count(*)::int from teams t where t.competition_id=c.id) teams,
           r.outcome, r.resolved_at is not null as answered
    from competitions c left join pass_upgrade_requests r on r.competition_id=c.id
    where c.slug=${SLUG}`,
  );
  log("DB: " + JSON.stringify(rows));
  const audit = await withDb(
    async (h) => h.sql`
    select action from audit_log where subject in (select id from competitions where slug=${SLUG})
    and action like 'competition.pass%'`,
  );
  log("AUDIT: " + JSON.stringify(audit));
  await p.goto(`${BASE}/seasons/${SLUG}`, { waitUntil: "networkidle" });
  await p.screenshot({ path: "rehearsal/mobile/f-pass-granted.png" });
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
