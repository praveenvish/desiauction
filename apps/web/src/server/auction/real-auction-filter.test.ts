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

const SERVER = join(__dirname, "..");

const READS_AUCTION_TABLES =
  /from\((auctions|lots|paddles|paddleGrants|auctionOwnerInvites)\)|Join\((auctions|lots|paddles|paddleGrants|auctionOwnerInvites)\b|(from|join) \$\{(auctions|lots|paddles)\}|(from|join) auctions\b/;
const SAYS_REAL = /isRealAuction|inRealAuction|kind\}? = 'real'|kind, "real"/;

/** Files that read one auction by an id they were handed — never by season. */
const PINNED_BY_ID: Record<string, string> = {
  "auction/auction-overview.ts": "takes the auction id from its caller",
  "auction/owner-acceptances.ts": "takes the auction id from its caller",
  "auction/owner-invite-lookup.ts": "takes the auction id from liveGate (real)",
  "auction/auction-notify.ts": "reads the kind of the id it is given and announces real only",
  "auction/practice-actions.ts": "reads the practice and real auctions by id",
  "auction/live-actions.ts": "the live ROOM: by the gate's auction id (practice on purpose)",
  "auction/conduct-actions.ts": "the cockpit and records: by the gate's auction id",
  "auction/owner-plan.ts": "by the plan gate's auction id (real)",
  "orgs/organizer-notify.ts": "by an owner invite's auction id; practices have no invites",
  "competition/captain-lock.ts": "by the roster auction id (registration-aggregate, real)",
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
