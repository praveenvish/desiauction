import type { NotificationChannel, ResolvedNotification } from "./catalogue";
import {
  NO_MAPPINGS,
  resolveSmsTemplate,
  resolveWhatsAppTemplate,
  type MappingSnapshot,
} from "./provider-templates";
import { approvalOf, EMPTY_STATUS, type StatusSnapshot } from "./template-status";
import { SMS_TEMPLATES } from "./templates";
import { WHATSAPP_TEMPLATES } from "./whatsapp";

function hasWhatsAppTemplate(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, key);
}

function hasSmsTemplate(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(SMS_TEMPLATES, key);
}

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
 * THE TEMPLATE NAME is resolved by the senders' own resolver
 * (provider-templates.ts: admin mapping, else env), and judged against Meta's
 * last status sync (template-status.ts) — so the chip says WHY: nothing mapped,
 * or mapped to a name Meta has not approved.
 *
 * Returns null when the cell can send, else a short reason.
 */
export function notConfiguredReason(
  entry: ResolvedNotification,
  channel: NotificationChannel,
  env: Readonly<Record<string, string | undefined>>,
  templates?: TemplateReadiness,
): string | null {
  return notConfiguredCause(entry, channel, env, templates)?.reason ?? null;
}

/** What the grid needs to judge a template: the mappings and Meta's last word. */
export interface TemplateReadiness {
  readonly mappings: MappingSnapshot;
  readonly status: StatusSnapshot;
}

export interface NotConfigured {
  readonly reason: string;
  /** The fix is on /admin/notifications/templates (a mapping or an approval). */
  readonly templates: boolean;
}

export function notConfiguredCause(
  entry: ResolvedNotification,
  channel: NotificationChannel,
  env: Readonly<Record<string, string | undefined>>,
  templates: TemplateReadiness = { mappings: NO_MAPPINGS, status: EMPTY_STATUS },
): NotConfigured | null {
  const reason = cause(entry, channel, env, templates);
  if (reason === null) return null;
  return typeof reason === "string" ? { reason, templates: false } : reason;
}

function cause(
  entry: ResolvedNotification,
  channel: NotificationChannel,
  env: Readonly<Record<string, string | undefined>>,
  templates: TemplateReadiness,
): string | NotConfigured | null {
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
      const resolved = resolveWhatsAppTemplate(entry.key, templates.mappings, env);
      if (resolved.name === undefined) {
        return !hasWhatsAppTemplate(entry.key)
          ? "No WhatsApp template"
          : { reason: "No approved template mapped", templates: true };
      }
      const approval = approvalOf(resolved.name, resolved.languages, templates.status);
      return approval.verdict === "not_approved"
        ? { reason: `Template not approved — ${approval.why}`, templates: true }
        : null;
    }
    case "sms": {
      if (env["OTP_PROVIDER"] === "dev") return null;
      if (entry.category === "login") {
        return env["OTP_PROVIDER"] === "msg91" && set("MSG91_TEMPLATE_ID")
          ? null
          : "Codes not on SMS";
      }
      if (!set("MSG91_AUTH_KEY")) return "SMS gateway not set up";
      if (!hasSmsTemplate(entry.key)) return "No SMS template";
      return resolveSmsTemplate(entry.key, templates.mappings, env).id === undefined
        ? { reason: "DLT template not registered", templates: true }
        : null;
    }
  }
}
