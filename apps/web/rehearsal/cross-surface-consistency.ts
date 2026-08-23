import { launch, signIn, log, BASE } from "./lib";
import { seatCaptains } from "./captains";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
const { slug, teams } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));
const roster = JSON.parse(readFileSync("rehearsal/artifacts/captains.json", "utf8")).map(
  (c: any) => ({ name: c.name, phone: c.phone, team: c.team }),
);

const PLAYER = "Shubham Pawar";
const REGNO = "R3DT3P2";
const TEAM = "Sunrise Rangers";
const PRICE = "₹60,000";

async function surface(p: Page, label: string, path: string) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(600);
  const t = (
    await p
      .locator("body")
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
  const hasPlayer = t.includes(PLAYER);
  const hasTeam = t.includes(TEAM);
  const hasPrice = t.includes(PRICE);
  // does the player and their team appear near each other?
  const idx = t.indexOf(PLAYER);
  const near = idx >= 0 ? t.slice(Math.max(0, idx - 90), idx + 160) : "";
  log(
    `  ${label.padEnd(26)} player=${hasPlayer ? "Y" : "n"} team=${hasTeam ? "Y" : "n"} price=${hasPrice ? "Y" : "n"}  ${near.slice(0, 150)}`,
  );
}

async function main() {
  const b = await launch(true);
  log(`CONSISTENCY PROBE — ${PLAYER} (${REGNO}) → ${TEAM} for ${PRICE}\n`);
  const o = await signIn(b, "Demo Founder", "9999000001");
  log("ORGANIZER SURFACES:");
  await surface(o.page, "cockpit", `/seasons/${slug}/auction/cockpit`);
  await surface(o.page, "ledger", `/seasons/${slug}/auction/ledger`);
  await surface(
    o.page,
    "team detail",
    `/seasons/${slug}/teams?team=${(teams as any[]).find((t) => t.name === TEAM).id}`,
  );
  await surface(
    o.page,
    "registrations",
    `/seasons/${slug}/registrations?q=${encodeURIComponent(PLAYER)}`,
  );
  await surface(o.page, "season overview", `/seasons/${slug}`);
  await surface(o.page, "readiness", `/seasons/${slug}/readiness`);
  await surface(o.page, "money", `/seasons/${slug}/money`);

  const caps = await seatCaptains(
    b,
    slug,
    roster.filter((r: any) => r.team === TEAM),
    { width: 1440, height: 900 },
  );
  log("\nWINNING CAPTAIN'S OWN SURFACES:");
  await surface(caps[0]!.page, "live room", `/seasons/${slug}/auction/live`);
  await surface(caps[0]!.page, "home", `/home`);

  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon.newPage();
  log("\nPUBLIC SURFACES:");
  await surface(ap, "public season /c", `/c/${slug}`);
  await surface(ap, "player page", `/c/${slug}/p/${REGNO}`);
  await surface(ap, "spectate", `/seasons/${slug}/auction/spectate`);
  await surface(ap, "board", `/seasons/${slug}/auction/board`);
  await surface(ap, "overlay", `/seasons/${slug}/auction/overlay`);

  // the player themselves
  log("\nTHE PLAYER'S OWN VIEW:");
  await ap.goto(`${BASE}/c/${slug}/p/${REGNO}`);
  log(
    "  player page text:",
    (
      await ap
        .locator("main")
        .innerText()
        .catch(() => "")
    )
      .slice(0, 700)
      .replace(/\n+/g, " | "),
  );
  await ap.screenshot({ path: "rehearsal/artifacts/64-player-page.png", fullPage: true });
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
