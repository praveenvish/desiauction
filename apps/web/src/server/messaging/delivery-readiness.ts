import type { NotificationChannel, ResolvedNotification } from "./catalogue";
import { SMS_TEMPLATES } from "./templates";
import { WHATSAPP_TEMPLATES } from "./whatsapp";

/**
 * CAN THIS CELL ACTUALLY SEND? — for the admin grid's "Not configured" chip.
 *
 * A switch that is ON for a channel with no provider behind it is not "on" in
 * any sense a person would recognise: the outbox suppresses the row as
 * `no_text_channel`, or the mailer says "not configured". The grid says so
 * rather than showing a green light over a dead line.
 *
 * Pure over an env record (the admin views pass `env`), so every branch is a
 * unit test. It reads the SAME variables the senders read, by name — it never
 * constructs a sender: the guard test allows those factories only in the
 * modules that ask the gate first.
 *
 * Returns null when the cell can send, else a short reason.
 */
export function notConfiguredReason(
  entry: ResolvedNotification,
  channel: NotificationChannel,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const set = (name: string): boolean => (env[name] ?? "") !== "";
  switch (channel) {
    case "in_app":
      return null;
    case "email": {
      if (set("EMAIL_API_ENDPOINT") && set("EMAIL_API_KEY") && set("EMAIL_FROM")) return null;
      // A sign-in code falls back to the dev inbox when no provider is set up
      // (`EMAIL_PROVIDER=auto|dev`, email-sender.ts) — a real destination
      // locally, and one env.ts refuses on a production server.
      if (entry.category === "login" && env["EMAIL_PROVIDER"] !== "http") return null;
      return "Email provider not set up";
    }
    case "whatsapp": {
      if (!set("WHATSAPP_PHONE_NUMBER_ID") || !set("WHATSAPP_ACCESS_TOKEN")) {
        return "WhatsApp not set up";
      }
      if (entry.category === "login") {
        return env["OTP_PROVIDER"] === "whatsapp" && set("WHATSAPP_TEMPLATE_NAME")
          ? null
          : "Codes not on WhatsApp";
      }
      const template = (WHATSAPP_TEMPLATES as Readonly<Record<string, { nameEnv: string }>>)[
        entry.key
      ];
      if (template === undefined) return "No WhatsApp template";
      return set(template.nameEnv) ? null : "Template not approved";
    }
    case "sms": {
      if (env["OTP_PROVIDER"] === "dev") return null;
      if (entry.category === "login") {
        return env["OTP_PROVIDER"] === "msg91" && set("MSG91_TEMPLATE_ID")
          ? null
          : "Codes not on SMS";
      }
      if (!set("MSG91_AUTH_KEY")) return "SMS gateway not set up";
      const template = (SMS_TEMPLATES as Readonly<Record<string, { providerTemplateEnv: string }>>)[
        entry.key
      ];
      if (template === undefined) return "No SMS template";
      return set(template.providerTemplateEnv) ? null : "DLT template not registered";
    }
  }
}
