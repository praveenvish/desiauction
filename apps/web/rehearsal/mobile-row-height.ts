import { launch, signIn, log, BASE } from "./lib";
import { readFileSync } from "node:fs";
const { slug } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));
async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001", {
    viewport: { width: 390, height: 844 },
  });
  const p = o.page;
  await p.goto(`${BASE}/seasons/${slug}/registrations`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const out = await p.evaluate(
    ("(() => {" +
      "const rows = Array.from(document.querySelectorAll('.reg-table tbody tr'));" +
      "const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));" +
      "const tbl = document.querySelector('.reg-table');" +
      "return { rows: rows.length, heights: hs.slice(0,4), median: hs.sort((a,b)=>a-b)[Math.floor(hs.length/2)], tableH: Math.round(tbl.getBoundingClientRect().height), perScreen: +(844 / hs[Math.floor(hs.length/2)]).toFixed(2) };" +
      "})()") as never,
  );
  log(JSON.stringify(out));
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
