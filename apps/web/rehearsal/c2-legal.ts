import { launch, log, BASE } from "./lib";
async function main() {
  const b = await launch(true);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  for (const path of ["/legal", "/legal/grievances", "/legal/privacy"]) {
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    await p.waitForTimeout(400);
    const t = (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
    log(`\n### ${path} [${res?.status()}] ${t.split(" ").length} words`);
    log(t.slice(0, 1100));
  }
  // does search find the new document?
  await p.goto(`${BASE}/search?q=grievance`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  log("\n### /search?q=grievance\n" + (await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
