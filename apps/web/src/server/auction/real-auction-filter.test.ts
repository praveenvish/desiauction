// "THE SEASON'S AUCTION" MEANS THE REAL ONE (0101) — kept true by a scan.
//
// A season can carry a practice auction beside its real one. Its lots point at
// the season's real players, so any query that finds auctions, lots, paddles,
// grants or owner links by season, org, person or player — rather than by an
// auction id it was handed — shows a rehearsal as the night unless it says
// `isRealAuction()` / `inRealAuction(...)` (or `kind = 'real'` in raw SQL).
//
// This is a FILE-level fence: every server file that reads those tables must
// carry the filter somewhere, or be listed below with the reason it only ever
// reads one auction by id. A new reader fails here until someone decides which
// it is.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// All of apps/web/src: server modules AND the server components under app/.
const SERVER = join(__dirname, "..", "..");

const TABLES = "auctions|lots|paddles|paddleGrants|auctionOwnerInvites|bids|auctionEvents";
const READS_AUCTION_TABLES = new RegExp(
  `from\\((${TABLES})\\)|Join\\((${TABLES})\\b|(from|join) \\$\\{(${TABLES})\\}|(from|join) (auctions|auction_events|bids)\\b`,
);
const SAYS_REAL = /isRealAuction|inRealAuction|kind\}? = 'real'|kind, "real"/;

/** Files that read one auction by an id they were handed — never by season. */
const PINNED_BY_ID: Record<string, string> = {
  "server/auction/auction-overview.ts": "takes the auction id from its caller",
  "server/auction/owner-acceptances.ts": "takes the auction id from its caller",
  "server/auction/owner-invite-lookup.ts": "takes the auction id from liveGate (real)",
  "server/auction/auction-notify.ts":
    "reads the kind of the id it is given and announces real only",
  "server/auction/practice-actions.ts": "reads the practice and real auctions by id",
  "server/auction/practice-engine.ts":
    "finds forgotten PRACTICES to end them — practice on purpose",
  "server/auction/live-actions.ts": "the live ROOM: by the gate's auction id (practice on purpose)",
  "server/auction/conduct-actions.ts": "the cockpit and records: by the gate's auction id",
  "server/auction/owner-plan.ts": "by the plan gate's auction id (real)",
  "server/orgs/organizer-notify.ts": "by an owner invite's auction id; practices have no invites",
  "server/competition/captain-lock.ts": "by the roster auction id (registration-aggregate, real)",
  "server/platform-ops/move-tournament.ts":
    "a running PRACTICE blocks a club move too — every kind on purpose",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "test-support" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("practice auctions stay out of everything but the room", () => {
  const readers = sourceFiles(SERVER).filter((path) =>
    READS_AUCTION_TABLES.test(readFileSync(path, "utf8")),
  );

  it("finds the readers it is meant to police", () => {
    expect(readers.length).toBeGreaterThan(20);
  });

  it("every reader filters to the real auction or is pinned by id", () => {
    const unfenced = readers
      .map((path) => relative(SERVER, path))
      .filter((path) => !(path in PINNED_BY_ID))
      .filter((path) => !SAYS_REAL.test(readFileSync(join(SERVER, path), "utf8")));
    expect(unfenced).toEqual([]);
  });

  it("lists no file that no longer needs it", () => {
    const stale = Object.keys(PINNED_BY_ID).filter((path) => !readers.includes(join(SERVER, path)));
    expect(stale).toEqual([]);
  });
});
