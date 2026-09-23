import { describe, expect, it } from "vitest";

import { requesterAcknowledgement } from "./demo-mail";
import type { ValidDemoRequest } from "./demo-requests";

const hostile: ValidDemoRequest = {
  name: "Your account is locked visit evil example",
  phone: "+919820000000",
  email: "victim@example.com",
  orgName: "Claim your refund at evil example",
  sport: "cricket",
  tournamentSize: "8-16",
  auctionOn: "2026-11-14",
  preferredWindow: "weekday-evening",
  note: "anything",
  source: "schedule-demo",
  requestIp: null,
};

describe("the demo acknowledgement carries nothing the stranger typed (gate P2)", () => {
  it("greets generically and repeats neither the name nor the organisation", () => {
    const mail = requesterAcknowledgement(hostile);
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain("evil");
      expect(part).not.toContain("locked");
    }
    expect(mail.text).toContain("Hello,");
  });

  it("still confirms the choices the form offered", () => {
    const mail = requesterAcknowledgement(hostile);
    expect(mail.text).toContain("8–16 teams");
    expect(mail.text).toContain("2026-11-14");
    expect(mail.text).toContain("weekday evenings");
  });
});
