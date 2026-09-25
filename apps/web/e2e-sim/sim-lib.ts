import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { latestOtp } from "../e2e/otp";

export const OUT = process.env["SIM_DIR"] ?? path.resolve(process.cwd(), "test-results-sim/run");
mkdirSync(OUT, { recursive: true });
export const COLD = { timeout: 30_000 } as const;

export const TEAMS = ["Mumbai Mavericks", "Pune Panthers", "Thane Tuskers"] as const;
export type TeamName = (typeof TEAMS)[number];

export interface SimState {
  stamp: string;
  slug: string;
  seasonUrl: string;
  organizer: { phone: string; name: string; storage: string };
  owners: { phone: string; name: string; team: TeamName; storage: string }[];
  captains: Record<TeamName, string>;
  icons: Record<TeamName, string>;
}

const STATE_FILE = path.join(OUT, "state.json");
export function saveState(state: SimState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
export function loadState(): SimState {
  if (!existsSync(STATE_FILE)) throw new Error(`no sim state at ${STATE_FILE} — run stage 1`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SimState;
}

export function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
  console.log(stamped);
  writeFileSync(path.join(OUT, "sim.log"), stamped + "\n", { flag: "a" });
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

export async function otpLogin(page: Page, phone: string, name: string): Promise<void> {
  await page.goto("/login");
  // Email-first login may be the default; switch to the phone door if shown.
  const phoneField = page.getByLabel("Mobile number");
  if (!(await phoneField.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: /phone|mobile/i })
      .first()
      .click();
  }
  await phoneField.fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).not.toHaveURL(/\/onboarding/, COLD);
  }
}

/** Digits of a displayed amount, as whole points ("52,500 pts" → 52500). */
export function points(text: string | null): number {
  const digits = (text ?? "").replace(/[^\d]/g, "");
  return digits === "" ? NaN : Number(digits);
}

/** The points ladder for a 1,00,000 purse: +500 < 20k, +1,000 < 50k, +2,500 above. */
export function nextRung(current: number | null, base = 1000): number {
  if (current === null) return base;
  if (current < 20_000) return current + 500;
  if (current < 50_000) return current + 1000;
  return current + 2500;
}

// 43 players. Names are unique and none is a substring of another.
export const PLAYERS: { name: string; role: string; band: "A" | "B" | "C" }[] = [
  ["Arjun Deshmukh", "all_rounder", "A"],
  ["Rohan Kulkarni", "batter", "A"],
  ["Siddharth Iyer", "bowler", "A"],
  ["Kunal Patil", "wicket_keeper", "A"],
  ["Vikram Rathod", "all_rounder", "A"],
  ["Nikhil Joshi", "batter", "A"],
  ["Aditya Pawar", "bowler", "A"],
  ["Harsh Vora", "all_rounder", "A"],
  ["Manish Gaikwad", "batter", "B"],
  ["Pranav Shinde", "bowler", "B"],
  ["Omkar Jadhav", "all_rounder", "B"],
  ["Tejas More", "batter", "B"],
  ["Yash Chavan", "bowler", "B"],
  ["Sagar Bhosale", "wicket_keeper", "B"],
  ["Akash Mane", "all_rounder", "B"],
  ["Rahul Salunkhe", "batter", "B"],
  ["Deepak Kadam", "bowler", "B"],
  ["Ganesh Thorat", "all_rounder", "B"],
  ["Vishal Naik", "batter", "B"],
  ["Sameer Khan", "bowler", "B"],
  ["Imran Shaikh", "all_rounder", "B"],
  ["Farhan Qureshi", "batter", "B"],
  ["Kabir Sethi", "bowler", "C"],
  ["Rajat Malhotra", "batter", "C"],
  ["Varun Chopra", "all_rounder", "C"],
  ["Ankit Sharma", "bowler", "C"],
  ["Mohit Verma", "batter", "C"],
  ["Gaurav Tiwari", "wicket_keeper", "C"],
  ["Saurabh Mishra", "bowler", "C"],
  ["Ritesh Yadav", "all_rounder", "C"],
  ["Prakash Nair", "batter", "C"],
  ["Suresh Menon", "bowler", "C"],
  ["Anil Pillai", "all_rounder", "C"],
  ["Dinesh Reddy", "batter", "C"],
  ["Lokesh Rao", "bowler", "C"],
  ["Chirag Mehta", "all_rounder", "C"],
  ["Jatin Parekh", "batter", "C"],
  ["Hemant Soni", "bowler", "C"],
  ["Bhavesh Trivedi", "wicket_keeper", "C"],
  ["Tushar Dubey", "all_rounder", "C"],
  ["Neeraj Bisht", "batter", "C"],
  ["Pankaj Rawat", "bowler", "C"],
  ["Umesh Negi", "all_rounder", "C"],
].map(([name, role, band]) => ({ name: name!, role: role!, band: band as "A" | "B" | "C" }));

export const CAPTAINS: Record<TeamName, string> = {
  "Mumbai Mavericks": "Rohan Kulkarni",
  "Pune Panthers": "Siddharth Iyer",
  "Thane Tuskers": "Kunal Patil",
};
export const ICONS: Record<TeamName, string> = {
  "Mumbai Mavericks": "Vikram Rathod",
  "Pune Panthers": "Nikhil Joshi",
  "Thane Tuskers": "Aditya Pawar",
};
