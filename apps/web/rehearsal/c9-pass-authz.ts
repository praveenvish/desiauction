import { launch, signIn, log, BASE } from "./lib";
import type { Page } from "@playwright/test";
async function probe(p: Page, label: string) {
  for (const path of ["/admin", "/admin/audit", "/admin/passes"]) {
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => null);
    await p.waitForTimeout(400);
    const body = (
      await p
        .locator("body")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");
    const lost = /LOST BALL|doesn't exist/.test(body);
    log(`  ${label.padEnd(24)} ${path.padEnd(16)} ${res?.status()} ${lost ? "NOT FOUND" : "open"}`);
  }
}
async function main() {
  const b = await launch(true);
  log("=== platform:admin + platform:billing (Demo Founder) ===");
  const both = await signIn(b, "Demo Founder", "9999000001", {
    viewport: { width: 1280, height: 900 },
  });
  await probe(both.page, "admin+billing");
  await both.context.close();

  log("\n=== platform:admin ONLY (Demo Admin) ===");
  const adminOnly = await signIn(b, "Demo Admin", "9999000002", {
    viewport: { width: 1280, height: 900 },
  });
  await probe(adminOnly.page, "admin only");
  await adminOnly.context.close();

  log("\n=== no platform grant at all (Demo Organizer) ===");
  const none = await signIn(b, "Demo Organizer", "9999000003", {
    viewport: { width: 1280, height: 900 },
  });
  await probe(none.page, "no platform grant");
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
