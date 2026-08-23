import { launch, signIn, log, BASE } from "./lib";
import { seatCaptains } from "./captains";
import { readFileSync } from "node:fs";
const ART = "rehearsal/artifacts";
const { slug } = JSON.parse(readFileSync(`${ART}/season.json`, "utf8"));
const cup = JSON.parse(readFileSync(`${ART}/cup.json`, "utf8"));
const caps0 = JSON.parse(readFileSync(`${ART}/captains.json`, "utf8"));
const T = { timeout: 2500 };

async function main() {
  const b = await launch(true);
  const errs: string[] = [];
  const o = await signIn(b, "Demo Founder", "9999000001");
  const p = o.page;
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  const screens: [string, string][] = [
    ["season overview", `/seasons/${slug}`],
    ["teams", `/seasons/${slug}/teams`],
    ["registrations", `/seasons/${slug}/registrations`],
    ["auction setup", `/seasons/${slug}/auction`],
    ["cockpit (completed)", `/seasons/${slug}/auction/cockpit`],
    ["ledger", `/seasons/${slug}/auction/ledger`],
    ["settlement desk", `/seasons/${slug}/money`],
    ["cup cockpit", `/seasons/${cup.slug}/auction/cockpit`],
    ["home", "/home"],
  ];
  log("=== ORGANIZER SMOKE ===");
  for (const [name, path] of screens) {
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    const body = (
      await p
        .locator("body")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");
    const broken = /LOST BALL|Something broke/.test(body);
    log(`  ${name.padEnd(22)} ${res?.status()} ${broken ? "BROKEN" : "ok"}`);
  }

  log("\n=== PUBLIC SMOKE ===");
  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon.newPage();
  ap.on("pageerror", (e) => errs.push("pageerror(anon): " + e.message));
  for (const [name, path] of [
    ["landing", "/"],
    ["directory", "/c"],
    ["public season", `/c/${slug}`],
    ["player page", `/c/${slug}/p/R3DT3P2`],
    ["spectate", `/seasons/${slug}/auction/spectate`],
    ["board", `/seasons/${slug}/auction/board`],
    ["overlay", `/seasons/${slug}/auction/overlay`],
  ] as [string, string][]) {
    const res = await ap.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    const body = (
      await ap
        .locator("body")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");
    log(
      `  ${name.padEnd(22)} ${res?.status()} ${/LOST BALL|Something broke/.test(body) ? "BROKEN" : "ok"}`,
    );
  }
  await ap.goto(`${BASE}/seasons/${slug}/auction/board`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(6000);
  const board = (await ap.locator("body").innerText()).replace(/\s+/g, " ");
  log(
    "\n  board total spend:",
    board.match(/TOTAL SPEND \S+/)?.[0] ?? board.match(/Total spend \S+/)?.[0],
  );

  log("\n=== BIDDER SMOKE (cup, completed) ===");
  const caps = await seatCaptains(b, cup.slug, [
    { name: caps0[0].name, phone: caps0[0].phone, team: cup.invites[0].team },
  ]);
  const cp = caps[0]!.page;
  await cp.waitForTimeout(2000);
  log("  live room:", (await cp.locator("main").innerText()).slice(0, 150).replace(/\n+/g, " | "));
  log(
    "  connection:",
    await cp
      .getByTestId("connection-quality")
      .innerText(T)
      .catch(() => "-"),
  );

  log("\nPAGE ERRORS:", errs.length === 0 ? "none" : JSON.stringify(errs.slice(0, 5)));
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
