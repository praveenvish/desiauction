import { launch, log, BASE } from "./lib";
const PAGES = ["/", "/features", "/pricing", "/about", "/careers", "/case-studies", "/contact",
  "/blog", "/help", "/legal", "/security", "/support", "/releases", "/rules-guidelines",
  "/schedule-demo", "/api-docs", "/c", "/search"];
async function main() {
  const b = await launch(true);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  for (const path of PAGES) {
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    await p.waitForTimeout(400);
    const text = (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const h1 = await p.locator("h1").first().innerText().catch(() => "(no h1)");
    const words = text.split(" ").filter(Boolean).length;
    log(`\n### ${path}  [${res?.status()}]  h1="${h1.replace(/\n/g, " ")}"  ${words} words`);
    log(text.slice(0, 1400));
  }
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
