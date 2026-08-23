import { launch, signIn, log, BASE, latestOtp, resetOtpBudget } from "./lib";
import { readFileSync } from "node:fs";
const ART = "rehearsal/mobile";
const { slug } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));
const cup = JSON.parse(readFileSync("rehearsal/artifacts/cup.json", "utf8"));
const caps0 = JSON.parse(readFileSync("rehearsal/artifacts/captains.json", "utf8"));
const VP = { width: 390, height: 844 };

/** Every row of 2+ adjacent buttons/links, with real measured geometry. */
async function buttonRows(p: any) {
  return p.evaluate(`(() => {
    const controls = Array.from(document.querySelectorAll("button, a[href], input[type=submit]")).filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    });
    const byParent = new Map();
    for (const el of controls) {
      const parent = el.parentElement;
      if (!parent) continue;
      const list = byParent.get(parent) || [];
      list.push(el);
      byParent.set(parent, list);
    }
    const rows = [];
    for (const entry of byParent) {
      const parent = entry[0];
      const kids = entry[1];
      if (kids.length < 2) continue;
      const boxes = kids.map((k) => ({ el: k, r: k.getBoundingClientRect() }));
      boxes.sort((a, b) => a.r.top - b.r.top);
      let group = [];
      const groups = [];
      for (const bx of boxes) {
        if (group.length === 0) { group = [bx]; continue; }
        const last = group[group.length - 1];
        const overlap = Math.min(last.r.bottom, bx.r.bottom) - Math.max(last.r.top, bx.r.top);
        if (overlap > Math.min(last.r.height, bx.r.height) * 0.5) { group.push(bx); }
        else { groups.push(group); group = [bx]; }
      }
      groups.push(group);
      for (const g of groups) {
        if (g.length < 2) continue;
        rows.push({
          container: parent.tagName.toLowerCase() + "." + String(parent.className || "").split(" ")[0],
          count: g.length,
          items: g.map((x) => ({
            label: (x.el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 26),
            w: Math.round(x.r.width),
            h: Math.round(x.r.height),
          })),
          totalW: Math.round(g.reduce((sum, x) => sum + x.r.width, 0)),
        });
      }
    }
    return rows;
  })()`);
}

async function shot(p: any, name: string, path: string) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${ART}/${name}.png`, fullPage: true });
  const rows = await buttonRows(p);
  const tight = rows.filter((r: any) => r.items.some((i: any) => i.w < 88 || i.h < 40));
  log(`\n=== ${name} (${path}) ===`);
  for (const r of rows) {
    const flag = r.items.some((i: any) => i.w < 88 || i.h < 40) ? " ⚠" : "";
    log(
      `  ${r.count}-up ${r.container}${flag}  ${JSON.stringify(r.items.map((i: any) => `${i.label}|${i.w}x${i.h}`))}`,
    );
  }
  if (rows.length === 0) log("  (no multi-control rows)");
}

async function main() {
  const b = await launch(true);
  const anon = await b.newContext({
    viewport: VP,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const ap = await anon.newPage();
  await shot(ap, "01-landing", "/");
  await shot(ap, "02-login", "/login");
  await shot(ap, "03-public-season", `/c/${slug}`);
  await shot(ap, "04-player-page", `/c/${slug}/p/R3DT3P2`);
  await shot(ap, "05-directory", "/c");
  await shot(ap, "06-register-signedout", `/seasons/${slug}/register`);
  await shot(ap, "07-spectate", `/seasons/${slug}/auction/spectate`);

  const o = await signIn(b, "Demo Founder", "9999000001", { viewport: VP });
  const p = o.page;
  await shot(p, "08-home", "/home");
  await shot(p, "09-season-overview", `/seasons/${slug}`);
  await shot(p, "10-teams", `/seasons/${slug}/teams`);
  await shot(p, "11-registrations", `/seasons/${slug}/registrations`);
  await shot(p, "12-auction-setup", `/seasons/${slug}/auction`);
  await shot(p, "13-cockpit", `/seasons/${cup.slug}/auction/cockpit`);
  await shot(p, "14-settlement", `/seasons/${slug}/money`);
  await shot(p, "15-account", "/account");
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
