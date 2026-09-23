import { describe, expect, it } from "vitest";

import {
  NOTIFICATIONS,
  isNotificationKind,
  notificationOf,
  orgTopics,
  personTopics,
  rowChannelOf,
} from "./catalogue";

describe("the notification catalogue", () => {
  it("has one entry per key", () => {
    const keys = NOTIFICATIONS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("locks every login kind against everybody, admins included", () => {
    const login = NOTIFICATIONS.filter((entry) => entry.category === "login");
    expect(login.map((entry) => entry.key).sort()).toEqual(["auth.email_code", "auth.phone_code"]);
    for (const entry of login) {
      expect(entry.personControllable, entry.key).toBe(false);
      expect(entry.orgControllable, entry.key).toBe(false);
      expect(entry.adminDisableable, entry.key).toBe(false);
    }
  });

  it("lets only an admin, with a reason, switch a security alert off", () => {
    const security = NOTIFICATIONS.filter((entry) => entry.category === "security");
    expect(security.length).toBeGreaterThan(0);
    for (const entry of security) {
      expect(entry.personControllable, entry.key).toBe(false);
      expect(entry.orgControllable, entry.key).toBe(false);
      expect(entry.adminDisableable, entry.key).toBe(true);
      expect(entry.adminNeedsReason, entry.key).toBe(true);
    }
  });

  it("keeps staff notices out of every person's and club's reach", () => {
    for (const entry of NOTIFICATIONS.filter((e) => e.category === "operational")) {
      expect(entry.audience, entry.key).toBe("staff");
      expect(entry.personControllable || entry.orgControllable, entry.key).toBe(false);
    }
  });

  it("gives a stranger no switch — suppression is what stops a demo mail", () => {
    for (const entry of NOTIFICATIONS.filter((e) => e.audience === "stranger")) {
      expect(entry.personControllable || entry.orgControllable, entry.key).toBe(false);
    }
  });

  it("reconciles the lineup's two names in one entry", () => {
    expect(notificationOf("lineup.announced").inboxKeys).toEqual(["fixture.lineup_announced"]);
    expect(notificationOf("auction.sold").inboxKeys).toEqual(["auction.sold"]);
    expect(notificationOf("auction.owner_summary").inboxKeys, "email only").toEqual([]);
  });

  it("puts receipts on the money switch", () => {
    const receipt = notificationOf("finance.document.issued");
    expect(receipt.topic).toBe("money");
    expect(receipt.personControllable).toBe(true);
    expect(receipt.channels).toEqual(["email", "in_app"]);
  });

  it("offers a person exactly the four switches /account always had", () => {
    expect(personTopics().map((t) => t.topic)).toEqual([
      "registration",
      "auction",
      "money",
      "feedback",
    ]);
  });

  it("offers a club only the switches its sends actually read", () => {
    // Feedback asks go out on the bare pool with no club named — a club switch
    // for them would be one that silently does nothing.
    expect(orgTopics().map((t) => t.topic)).toEqual(["registration", "auction", "money"]);
  });

  it("files WhatsApp under the text row", () => {
    expect(rowChannelOf("whatsapp")).toBe("sms");
    expect(rowChannelOf("in_app")).toBe("in-app");
    expect(rowChannelOf("email")).toBe("email");
  });

  it("recognises its own keys and nothing else", () => {
    expect(isNotificationKind("auction.sold")).toBe(true);
    expect(isNotificationKind("auction.sould")).toBe(false);
  });
});
