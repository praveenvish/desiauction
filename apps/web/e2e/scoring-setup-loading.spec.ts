import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { scoringSession, seedScoringFixture } from "./scoring-fixtures";

test.use({ serviceWorkers: "block" });
for (const theme of ["daylight", "floodlight"] as const) {
  for (const [sport, module, ready, formatKey] of [
    ["cricket", "delivery-setup", "setup-conditions", "t10"],
    ["badminton", "rally-setup", "rally-start", "badminton_bo3"],
    ["kabaddi", "raid-setup", "raid-setup", "pkl_40"],
  ] as const) {
    test(`${sport} setup loading and ready screen are accessible · ${theme}`, async ({
      page,
      context,
    }) => {
      const fixture = await seedScoringFixture({ sport, formatKey });
      await scoringSession(context, fixture.actorToken);
      await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
      const manifest = JSON.parse(
        await readFile(
          path.resolve(process.env["NEXT_DIST_DIR"] ?? ".next", "react-loadable-manifest.json"),
          "utf8",
        ),
      ) as Record<string, { files: string[] }>;
      const entry = Object.entries(manifest).find(([key]) => key.endsWith(`-> ./${module}`));
      expect(entry).toBeTruthy();
      const chunks = entry![1].files.filter((file) => file.endsWith(".js"));
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested = false;
      await context.route("**/_next/static/chunks/**", async (route) => {
        if (chunks.some((file) => new URL(route.request().url()).pathname.endsWith(file))) {
          requested = true;
          await held;
        }
        await route.continue();
      });
      try {
        await page.goto("/score");
        await page.locator(`a[href="/score/${fixture.fixtureId}/setup"]`).first().click();
        await expect(page.getByTestId("setup-loading")).toBeVisible();
        expect(requested).toBe(true);
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(
          page.getByRole("heading", { level: 1, name: "Match setup", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("status")).toHaveText("Opening match setup…");
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        release();
        await expect(page.getByTestId(ready)).toBeVisible();
        await expect(page.getByTestId("setup-loading")).toHaveCount(0);
        await expect(page.getByRole("main")).toHaveCount(1);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      } finally {
        release();
        await context.unrouteAll({ behavior: "wait" });
      }
    });
  }
}
