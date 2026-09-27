import { describe, expect, it } from "vitest";

import { contactStatus, notificationsStatus, sectionOf, securityStatus } from "./sections";

describe("sectionOf", () => {
  it("reads a section, and the old anchors other pages still link to", () => {
    expect(sectionOf("security")).toBe("security");
    expect(sectionOf("#whatsapp")).toBe("notifications");
    expect(sectionOf("#sports")).toBe("player");
    expect(sectionOf("activity")).toBe("security");
    expect(sectionOf("email")).toBe("profile");
  });

  it("ignores anything else", () => {
    expect(sectionOf("admin")).toBeNull();
    expect(sectionOf("")).toBeNull();
    expect(sectionOf(undefined)).toBeNull();
  });
});

describe("status lines", () => {
  it("say each section at a glance", () => {
    expect(
      notificationsStatus(
        [{ allowed: true }, { allowed: true }, { allowed: false }, { allowed: true }],
        false,
        "en",
      ),
    ).toBe("3 of 5 on · English");
    expect(securityStatus(0, 24)).toBe("No passkey · 24 devices signed in");
    expect(securityStatus(1, 1)).toBe("1 passkey · 1 device signed in");
    expect(contactStatus("+919700010100", null, false)).toBe("Phone verified · no email yet");
    expect(contactStatus(null, "a@b.in", true)).toBe("No phone · email verified");
  });
});
