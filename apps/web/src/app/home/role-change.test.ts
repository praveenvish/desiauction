import { describe, expect, it } from "vitest";

import { roleChangeFor, signatureOf, type RoleToken } from "./role-change";

describe("the menu says when it changes", () => {
  it("says nothing on a device that has never stored a signature", () => {
    // A first visit, a new browser, cleared storage. With no previous state
    // there is no CHANGE — and telling somebody "you're now a team owner"
    // about a team they have owned for a month is worse than silence.
    expect(roleChangeFor(["owner"], null)).toBeNull();
  });

  it("says nothing when nothing moved", () => {
    expect(roleChangeFor(["owner", "player"], signatureOf(["owner", "player"]))).toBeNull();
  });

  it("names the role AND the menu item it added", () => {
    const change = roleChangeFor(["player", "owner"], signatureOf(["player"]));
    expect(change).toEqual({
      title: "You're now a team owner",
      item: "My team",
      signature: "owner,player",
    });
  });

  it("announces each role in the rail's own order, so both agree", () => {
    expect(roleChangeFor(["owner"], "")?.item).toBe("My team");
    expect(roleChangeFor(["auctioneer"], "")?.item).toBe("Auction nights");
    expect(roleChangeFor(["organizer"], "")?.item).toBe("Tournaments");
    expect(roleChangeFor(["player"], "")?.item).toBe("My sports");
  });

  it("collapses several at once to the most urgent — two sentences is a worse menu", () => {
    const change = roleChangeFor(["organizer", "owner", "player"], signatureOf(["player"]));
    expect(change?.title).toBe("You're now a team owner");
    // …and the stored signature still covers everything, so the organizer role
    // is not announced later as though it were new.
    expect(change?.signature).toBe("owner,organizer,player");
  });

  it("says nothing when a role is LOST", () => {
    // Revoking is the organizer's to explain, and a menu item that quietly
    // disappears is not something anybody goes hunting for.
    expect(roleChangeFor(["player"], signatureOf(["owner", "player"]))).toBeNull();
  });

  it("the signature is order-independent, so it cannot false-positive", () => {
    const a: RoleToken[] = ["player", "organizer", "owner"];
    const b: RoleToken[] = ["owner", "player", "organizer"];
    expect(signatureOf(a)).toBe(signatureOf(b));
    expect(roleChangeFor(b, signatureOf(a))).toBeNull();
  });

  it("holding nothing has a signature, so the next role is announced", () => {
    expect(signatureOf([])).toBe("");
    expect(roleChangeFor(["player"], "")?.item).toBe("My sports");
  });
});
