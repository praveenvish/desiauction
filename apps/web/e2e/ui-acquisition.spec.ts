import { expect, test } from "@playwright/test";

import { START_CLUB_LOGIN, START_CLUB_PATH } from "../src/lib/start-intent";
import { axeClean } from "./axe";

test("organizer start choices retain intent while sign in stays generic", async ({ page }) => {
  for (const [route, label] of [
    ["/features", "Start your auction"],
    ["/founding-25", "set up yours"],
    ["/schedule-demo", "Set up your tournament"],
    ["/schedule-demo/booked", "set your tournament up now"],
  ] as const) {
    await page.goto(route);
    const start = page.getByRole("link", { name: label, exact: true });
    await expect(start).toHaveAttribute("href", START_CLUB_LOGIN);
    await start.click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === START_CLUB_PATH,
    );
    await page.goBack();
    await expect(start).toBeVisible();
  }
  await page.goto("/tools");
  await expect(page.getByRole("link", { name: "Start free", exact: true })).toHaveAttribute(
    "href",
    START_CLUB_LOGIN,
  );
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("tools provide an explicit native return after using a calculator", async ({ page }) => {
  await page.goto("/tools/purse-calculator");
  await page.getByLabel("Purse per team (₹)").fill("20000");
  await expect(page.getByTestId("calc-warnings")).toContainText("cannot fill its minimum squad");
  await page.getByRole("link", { name: "Back to free tools", exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await page.goBack();
  await expect(page.getByRole("link", { name: "Back to free tools", exact: true })).toBeVisible();
});

test("demo telemetry distinguishes UI acknowledgement from a saved lead or booking", async ({
  page,
}) => {
  await page.goto("/schedule-demo?from=pricing");
  await expect
    .poll(async () =>
      page.evaluate(
        () => window.__daTelemetry?.filter((event) => event.name === "demo.form_viewed").length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Book a demo", exact: true }).click();
  await expect(page.getByTestId("demo-request-done")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__daTelemetry?.filter((event) => event.name === "demo.requested"),
    ),
  ).toEqual([]);
  await page.getByLabel("Your name").fill("Synthetic visitor");
  await page.getByLabel("Mobile number").fill("9898989898");
  await page.getByLabel("Tournament or club").fill("Synthetic public flow");
  await page.getByLabel("Which sport?").selectOption("kabaddi");
  await page.locator("#company_website").fill("https://synthetic.invalid", { force: true });
  await page.getByRole("button", { name: "Book a demo", exact: true }).click();
  await expect(page.getByTestId("demo-request-done")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start your auction now", exact: true }),
  ).toHaveAttribute("href", START_CLUB_LOGIN);
  const events = await page.evaluate(() =>
    window.__daTelemetry?.filter((event) => event.name.startsWith("demo.")),
  );
  expect(events?.map((event) => event.name)).toEqual([
    "demo.form_viewed",
    "demo.requested",
    "demo.response_shown",
  ]);
  expect(
    events?.every((event) => JSON.stringify(event.props) === JSON.stringify({ source: "pricing" })),
  ).toBe(true);
  await expect(
    page.getByRole("link", { name: "Or pick a time yourself", exact: true }),
  ).toHaveCount(0);
  await axeClean(page, "demo anti-abuse acknowledgement, not saved-lead evidence");
});
