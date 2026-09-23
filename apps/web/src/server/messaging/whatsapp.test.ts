import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REASON_TO_PLAYER } from "../competition/registration-notify";
import type { HttpResponse } from "./sms";
import { SMS_TEMPLATES, type TemplateKey } from "./templates";
import {
  languageFromEvidence,
  parseMessageId,
  REASON_HI,
  WhatsAppCloudSender,
  WhatsAppSendError,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  whatsappParams,
  type WhatsAppMessage,
  type WhatsAppTemplate,
} from "./whatsapp";

const templates: WhatsAppTemplate[] = Object.values(WHATSAPP_TEMPLATES);

function variables(body: string): number[] {
  return [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

describe("the WhatsApp templates — what is submitted to Meta", () => {
  it("EVERY text moment has one: no SMS shape is left without its WhatsApp twin", () => {
    // SMS is deferred (2026-09-23): a moment with no WhatsApp template reaches
    // nobody by text at all, so this is the list that must stay complete.
    for (const key of Object.keys(SMS_TEMPLATES) as TemplateKey[]) {
      expect(WHATSAPP_TEMPLATES[key], key).toBeDefined();
    }
    expect(WHATSAPP_TEMPLATES["security.email_changed"]).toBeDefined();
  });

  it("numbers its variables 1..n in reading order, in EVERY language, one param per variable", () => {
    for (const template of templates) {
      for (const language of WHATSAPP_LANGUAGES) {
        const used = variables(template.body[language]);
        expect(used, `${template.key}/${language}`).toEqual(used.map((_, index) => index + 1));
        expect(template.params, `${template.key}/${language}`).toHaveLength(used.length);
        expect(template.samples[language], `${template.key}/${language}`).toHaveLength(used.length);
      }
    }
  });

  it("gives English and Hindi the SAME variables — one parameter list fills both", () => {
    for (const template of templates) {
      expect(variables(template.body.hi), template.key).toEqual(variables(template.body.en));
    }
  });

  it("writes the Hindi in Devanagari, and labels its button in Hindi too", () => {
    for (const template of templates) {
      expect(template.body.hi, template.key).toMatch(/[\u0900-\u097F]/);
      expect(template.button.label.hi, template.key).toMatch(/[\u0900-\u097F]/);
    }
  });

  it("never starts or ends a body on a variable — Meta's review rejects both", () => {
    for (const template of templates) {
      for (const language of WHATSAPP_LANGUAGES) {
        const body = template.body[language].trim();
        expect(body.startsWith("{{"), `${template.key}/${language}`).toBe(false);
        expect(/\{\{\d+\}\}[.!।]?$/.test(body), `${template.key}/${language}`).toBe(false);
      }
    }
  });

  it("fills every non-name variable from a slot the SMS template actually has", () => {
    for (const template of templates) {
      if (!(template.key in SMS_TEMPLATES)) continue;
      const slots = new Set(
        SMS_TEMPLATES[template.key as TemplateKey].slots.map((slot) => slot.name),
      );
      for (const param of template.params) {
        if (param !== "name") expect(slots.has(param), `${template.key}.${param}`).toBe(true);
      }
    }
  });

  it("names an env var that env.ts declares, one per template", () => {
    const envSource = readFileSync(resolve(__dirname, "../../env.ts"), "utf8");
    const names = templates.map((template) => template.nameEnv);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(envSource, name).toContain(`${name}:`);
    }
  });

  it("puts the rupee sign back — WhatsApp is not held to GSM-7", () => {
    const sold = WHATSAPP_TEMPLATES["auction.sold"];
    expect(
      whatsappParams(
        sold,
        { team: "Cup Kings", price: "Rs 75,000", competition: "MPL 2026" },
        "Arjun",
      ),
    ).toEqual(["Arjun", "Cup Kings", "₹75,000", "MPL 2026"]);
  });

  it("says a rejection's reason in Hindi to a Hindi reader — every reason has its Hindi", () => {
    for (const reason of Object.values(REASON_TO_PLAYER)) {
      expect(REASON_HI[reason], reason).toMatch(/[\u0900-\u097F]/);
    }
    const rejected = WHATSAPP_TEMPLATES["registration.rejected"];
    const slots = { competition: "MPL 2026", reason: "the season is full" };
    expect(whatsappParams(rejected, slots, "Arjun", "hi")).toEqual([
      "Arjun",
      "MPL 2026",
      "सीज़न की सभी जगहें भर गई हैं",
    ]);
    expect(whatsappParams(rejected, slots, "Arjun", "en")[2]).toBe("the season is full");
  });
});

describe("the reader's language, from their consent history", () => {
  it("is English for somebody who never chose", () => {
    expect(languageFromEvidence([])).toBe("en");
    expect(languageFromEvidence([{ evidence: { wording: "…" } }])).toBe("en");
  });

  it("is the newest record that names one — a STOP and START after it do not reset it", () => {
    expect(
      languageFromEvidence([
        { evidence: { wording: "START" } },
        { evidence: { wording: "STOP" } },
        { evidence: { wording: "…", language: "hi" } },
        { evidence: { wording: "…", language: "en" } },
      ]),
    ).toBe("hi");
  });

  it("ignores a language nobody approved templates in", () => {
    expect(languageFromEvidence([{ evidence: { language: "ta" } }])).toBe("en");
    expect(languageFromEvidence([{ evidence: null }, { evidence: "hi" }])).toBe("en");
  });
});

describe("the wamid Meta answers with", () => {
  it("is read from the success body", () => {
    expect(
      parseMessageId(
        '{"messaging_product":"whatsapp","contacts":[{"wa_id":"919812345678"}],"messages":[{"id":"wamid.HBgM"}]}',
      ),
    ).toBe("wamid.HBgM");
  });

  it("is null — never a crash — when the body is not what we expect", () => {
    expect(parseMessageId("")).toBeNull();
    expect(parseMessageId("not json")).toBeNull();
    expect(parseMessageId("{}")).toBeNull();
    expect(parseMessageId('{"messages":[]}')).toBeNull();
    expect(parseMessageId('{"messages":[{"id":42}]}')).toBeNull();
    expect(parseMessageId("null")).toBeNull();
  });
});

function transport(response: HttpResponse) {
  const calls: { url: string; body: unknown }[] = [];
  const send = (url: string, init: { body?: string }): Promise<HttpResponse> => {
    calls.push({ url, body: JSON.parse(init.body ?? "{}") as unknown });
    return Promise.resolve(response);
  };
  return { calls, send };
}

describe("the Cloud API sender", () => {
  const sold = WHATSAPP_TEMPLATES["auction.sold"];
  const message: WhatsAppMessage = {
    name: "da_auction_sold",
    template: sold,
    params: ["Arjun", "Cup Kings", "₹75,000", "MPL 2026"],
    imageUrl: "https://desiauction.in/c/mpl/p/R1/opengraph-image",
    language: "en",
  };

  it("sends the approved template with the card as the header image and the body params", async () => {
    const http = transport({ status: 200, body: '{"messages":[{"id":"wamid.1"}]}' });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "12345",
      accessToken: "token",
      transport: http.send,
    });
    const receipt = await sender.send("+919812345678", message);
    expect(receipt).toEqual({ messageId: "wamid.1" });
    expect(http.calls[0]?.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(http.calls[0]?.body).toMatchObject({
      to: "919812345678",
      type: "template",
      template: {
        name: "da_auction_sold",
        language: { code: "en" },
        components: [
          { type: "header", parameters: [{ type: "image", image: { link: message.imageUrl } }] },
          {
            type: "body",
            parameters: message.params.map((text) => ({ type: "text", text })),
          },
        ],
      },
    });
  });

  it("asks for the reader's language version of the template", async () => {
    const http = transport({ status: 200, body: '{"messages":[{"id":"wamid.2"}]}' });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: http.send,
    });
    await sender.send("+919812345678", { ...message, language: "hi" });
    expect(http.calls[0]?.body).toMatchObject({ template: { language: { code: "hi" } } });
  });

  it("counts a success with no id as SENT — only the tracking is lost", async () => {
    const http = transport({ status: 200, body: '{"messaging_product":"whatsapp"}' });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: http.send,
    });
    await expect(sender.send("+919812345678", message)).resolves.toEqual({ messageId: null });
  });

  it("tells a refusal (4xx) from an outage (5xx) — one is final, the other may go later", async () => {
    const refused = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: transport({ status: 400, body: '{"error":{"code":131026}}' }).send,
    });
    const down = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: transport({ status: 503, body: "" }).send,
    });
    const a: unknown = await refused.send("+919812345678", message).catch((e: unknown) => e);
    const b: unknown = await down.send("+919812345678", message).catch((e: unknown) => e);
    expect((a as WhatsAppSendError).failure).toBe("refused");
    expect((b as WhatsAppSendError).failure).toBe("unavailable");
    expect((b as WhatsAppSendError).outcomeUnknown).toBe(false);
  });

  it("treats Meta's 200-with-an-error as a failure", async () => {
    const http = transport({ status: 200, body: '{"error":{"code":131026}}' });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: http.send,
    });
    await expect(sender.send("+919812345678", message)).rejects.toBeInstanceOf(WhatsAppSendError);
  });

  it("opens the breaker after three failures and refuses without calling Meta", async () => {
    const http = transport({ status: 500, body: "" });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: http.send,
      now: () => 1_000,
    });
    for (let i = 0; i < 3; i += 1) {
      await expect(sender.send("+919812345678", message)).rejects.toThrow();
    }
    const open: unknown = await sender.send("+919812345678", message).catch((e: unknown) => e);
    expect((open as WhatsAppSendError).message).toMatch(/breaker open/);
    expect((open as WhatsAppSendError).failure).toBe("breaker");
    expect(http.calls).toHaveLength(3);
  });

  it("marks a send that died on the deadline as UNKNOWN — Meta may have it already", async () => {
    const timedOut = (): Promise<HttpResponse> =>
      Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: timedOut,
    });
    const error: unknown = await sender.send("+919812345678", message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect((error as WhatsAppSendError).outcomeUnknown).toBe(true);
  });

  it("keeps a refused connection KNOWN — nothing reached Meta, so SMS may cover it", async () => {
    const refused = (): Promise<HttpResponse> => Promise.reject(new TypeError("fetch failed"));
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "1",
      accessToken: "t",
      transport: refused,
    });
    const error: unknown = await sender.send("+919812345678", message).catch((e: unknown) => e);
    expect((error as WhatsAppSendError).outcomeUnknown).toBe(false);
  });
});
