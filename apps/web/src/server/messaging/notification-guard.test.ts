import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { KNOWN_EVENT_ACTIONS } from "../../lib/inbox-events";
import { NOTIFICATIONS } from "./catalogue";
import { SMS_TEMPLATES } from "./templates";
import { WHATSAPP_TEMPLATES } from "./whatsapp";

/**
 * THE GUARD: NO SEND PATH AROUND THE GATE, NO NOTIFICATION OUTSIDE THE CATALOGUE.
 *
 * Eighteen direct sends skipped `maySend` before the Notification Control
 * Center's Phase 0, one at a time, each for a reason that looked local. This
 * fails the build the moment a nineteenth is written: every low-level sender
 * below may be reached only from the modules listed against it, and each of
 * those either DEFINES the sender or is a module that asks the gate.
 *
 * It is a ratchet in both directions, like the tenant-posture script: an
 * unlisted use fails, and so does a listed module that no longer uses the
 * token — so the list cannot quietly outlive the code it excuses.
 *
 * Files are read with readFileSync, not grep: a stray control byte makes grep
 * skip a file in silence, which is the one failure a guard cannot have.
 */

const SRC = join(__dirname, "..", "..");
const REPO = join(SRC, "..", "..", "..");

/**
 * The gate, the finance delivery adapters and the catalogue moved to
 * packages/messaging so the finops runner — the process that actually sends
 * receipts — could use them. A guard that only read apps/web would stop
 * seeing those senders the moment they moved, so both of the new homes are
 * read too, keyed by their repo path (apps/web keeps its short keys).
 */
const EXTRA_ROOTS = ["packages/messaging/src", "apps/finops-runner/src"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : sources(full);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

/** Comments out, strings kept — this repo explains its senders at length in prose. */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i] ?? "";
    const next = source[i + 1];
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 1;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}

const FILES: ReadonlyMap<string, string> = new Map([
  ...sources(SRC).map((file) => [
    relative(SRC, file).split(sep).join("/"),
    stripComments(readFileSync(file, "utf8")),
  ]),
  ...EXTRA_ROOTS.flatMap((root) =>
    sources(join(REPO, root)).map((file) => [
      relative(REPO, file).split(sep).join("/"),
      stripComments(readFileSync(file, "utf8")),
    ]),
  ),
] as [string, string][]);

/** Modules that ask the gate before they send — the only ones allowed a raw sender. */
const GATES = [
  "server/messaging/notify.ts",
  "server/messaging/outbox.ts",
  "server/messaging/account-alert.ts",
  "server/auth/otp.ts",
  "packages/messaging/src/finance-delivery.ts",
];

/**
 * Each raw sender, and every module allowed to name it — with why. A module is
 * either the sender's own definition, a module in GATES, or explained here.
 */
const RAW_SENDERS: readonly { token: string; allowed: Readonly<Record<string, string>> }[] = [
  {
    token: "transactionalMailer(",
    allowed: {
      "server/messaging/transactional-mail.ts": "defines it",
      "server/messaging/notify.ts": "gate-owning",
      "server/messaging/outbox.ts": "gate-owning (the drain)",
    },
  },
  {
    token: "createCodeMailer(",
    allowed: {
      "server/auth/email-sender.ts": "defines it",
      "server/messaging/notify.ts": "gate-owning",
    },
  },
  {
    token: "createWhatsAppSender(",
    allowed: {
      "server/messaging/whatsapp.ts": "defines it",
      "server/messaging/outbox.ts": "gate-owning (the drain)",
      "server/messaging/account-alert.ts": "gate-owning",
    },
  },
  {
    token: "createPlayerSmsSender(",
    allowed: {
      "server/messaging/sms.ts": "defines it",
      "server/messaging/outbox.ts": "gate-owning (the drain)",
      "server/messaging/account-alert.ts": "gate-owning",
    },
  },
  {
    token: "createOtpSenderFromEnv(",
    allowed: {
      "server/auth/otp-sender.ts": "defines it",
      "server/auth/actions.ts": "constructs it; every send is requestOtp, which asks the gate",
    },
  },
  {
    token: "maySend(",
    allowed: {
      "packages/messaging/src/consent.ts": "defines the layers",
      "packages/messaging/src/gate.ts": "the gate",
    },
  },
  {
    token: "enqueueMail(",
    allowed: {
      "server/messaging/outbox.ts": "defines it; the drain asks the gate for every row",
      "server/auction/auction-notify.ts": "queues only — delivery is the gated drain",
      "server/competition/registration-notify.ts": "queues only — delivery is the gated drain",
      "server/competition/appointments.ts": "queues only — delivery is the gated drain",
      "server/competition/lineup-announce.ts": "queues only — delivery is the gated drain",
      "server/competition/squad-sheets.ts": "queues only — delivery is the gated drain",
    },
  },
  {
    token: "enqueueSms(",
    allowed: {
      "server/messaging/outbox.ts": "defines it; the drain asks the gate for every row",
      "server/auction/auction-notify.ts": "queues only — delivery is the gated drain",
      "server/competition/registration-notify.ts": "queues only — delivery is the gated drain",
      "server/competition/appointments.ts": "queues only — delivery is the gated drain",
      "server/competition/lineup-announce.ts": "queues only — delivery is the gated drain",
    },
  },
  {
    token: "createHttpEmailAdapter(",
    allowed: {
      "packages/messaging/src/email-adapter.ts": "defines it",
      "packages/messaging/src/finance-delivery.ts": "gate-owning (resolveOwnerEmail)",
    },
  },
  {
    token: "createPersonInAppAdapter(",
    allowed: {
      "packages/messaging/src/in-app-adapter.ts":
        "defines it; writes the ledger, gated where the inbox reads it (hiddenInboxActions)",
      "packages/messaging/src/finance-delivery.ts": "wires it for finops",
    },
  },
  {
    token: "financeDeliveryAdapters(",
    allowed: {
      "packages/messaging/src/finance-delivery.ts": "defines it; the email half asks the gate",
      "server/financial-operations/deps.ts": "the web tier's finops deps",
      "apps/finops-runner/src/delivery.ts": "the runner's finops deps — the tier that sends",
    },
  },
  ...[
    "new HttpMailer(",
    "new HttpTransactionalMailer(",
    "new WhatsAppCloudSender(",
    "new WhatsAppCloudOtpSender(",
    "new Msg91OtpSender(",
    "new Msg91FlowSmsSender(",
  ].map((token) => ({
    token,
    allowed: {
      "server/auth/email-sender.ts": "factory",
      "server/messaging/transactional-mail.ts": "factory",
      "server/messaging/whatsapp.ts": "factory",
      "server/auth/otp-sender.ts": "factory",
      "server/messaging/sms.ts": "factory",
    },
  })),
];

describe("no send path around the notification gate", () => {
  for (const { token, allowed } of RAW_SENDERS) {
    it(`only the listed modules reach ${token.replace("(", "")}`, () => {
      const users = [...FILES].filter(([, text]) => text.includes(token)).map(([file]) => file);
      const intruders = users.filter((file) => allowed[file] === undefined);
      expect(intruders, `send through notify.ts / notificationGate instead`).toEqual([]);
      // Factories are listed together for the `new …(` tokens; only a module
      // that is NOT a shared factory entry must still be using its token.
      if (!token.startsWith("new ")) {
        const stale = Object.keys(allowed).filter((file) => !users.includes(file));
        expect(stale, "an allowlist entry that no longer uses the token — delete it").toEqual([]);
      }
    });
  }

  it("every gate-owning module actually asks the gate", () => {
    for (const file of GATES) {
      const text = FILES.get(file) ?? "";
      expect(
        text.includes("notificationGate(") || text.includes("sendNotificationMail("),
        file,
      ).toBe(true);
    }
  });
});

describe("every notification is in the catalogue, and every entry is sent", () => {
  const byKey = new Map(NOTIFICATIONS.map((entry) => [entry.key as string, entry]));

  it("covers every DLT (SMS) template, on the SMS channel", () => {
    for (const key of Object.keys(SMS_TEMPLATES)) {
      expect(byKey.get(key)?.channels, key).toContain("sms");
    }
  });

  it("covers every WhatsApp template, on the WhatsApp channel", () => {
    for (const key of Object.keys(WHATSAPP_TEMPLATES)) {
      expect(byKey.get(key)?.channels, key).toContain("whatsapp");
    }
  });

  it("covers every notice the inbox has prose for — the ledger's own evidence aside", () => {
    // auth.*, profile.* and privacy.* are the account's security ledger, not
    // notifications: nobody switches off the record of their own sign-in.
    const inboxKeys = new Set(NOTIFICATIONS.flatMap((entry) => entry.inboxKeys));
    const notices = KNOWN_EVENT_ACTIONS.filter((key) => !/^(auth|profile|privacy)\./.test(key));
    expect(notices.filter((key) => !inboxKeys.has(key))).toEqual([]);
    expect([...inboxKeys].filter((key) => !KNOWN_EVENT_ACTIONS.includes(key))).toEqual([]);
  });

  it("has no entry that no sender names", () => {
    const elsewhere = [...FILES]
      .filter(([file]) => file !== "packages/messaging/src/catalogue.ts")
      .map(([, text]) => text)
      .join("\n");
    const unused = NOTIFICATIONS.map((entry) => entry.key).filter(
      (key) => !elsewhere.includes(`"${key}"`),
    );
    expect(unused, "delete the entry, or wire the sender").toEqual([]);
  });
});
