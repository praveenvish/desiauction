import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { HttpResponse } from "../competition/registration-notify";
import { SMS_TEMPLATES } from "./templates";
import {
  WhatsAppCloudSender,
  WhatsAppSendError,
  WHATSAPP_TEMPLATES,
  whatsappParams,
  type WhatsAppTemplate,
} from "./whatsapp";

const templates: WhatsAppTemplate[] = Object.values(WHATSAPP_TEMPLATES);

describe("the WhatsApp templates — what is submitted to Meta", () => {
  it("each replaces a registered SMS, so nobody is left without the message", () => {
    for (const template of templates) {
      expect(SMS_TEMPLATES[template.key], template.key).toBeDefined();
    }
  });

  it("numbers its variables 1..n, one param and one sample per variable", () => {
    for (const template of templates) {
      const used = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(used, template.key).toEqual(used.map((_, index) => index + 1));
      expect(template.params, template.key).toHaveLength(used.length);
      expect(template.samples, template.key).toHaveLength(used.length);
    }
  });

  it("fills every non-name variable from a slot the SMS template actually has", () => {
    for (const template of templates) {
      const slots = new Set(SMS_TEMPLATES[template.key].slots.map((slot) => slot.name));
      for (const param of template.params) {
        if (param !== "name") expect(slots.has(param), `${template.key}.${param}`).toBe(true);
      }
    }
  });

  it("names an env var that env.ts declares", () => {
    const envSource = readFileSync(resolve(__dirname, "../../env.ts"), "utf8");
    for (const template of templates) {
      expect(envSource, template.nameEnv).toContain(`${template.nameEnv}:`);
    }
  });

  it("puts the rupee sign back — WhatsApp is not held to GSM-7", () => {
    const sold = WHATSAPP_TEMPLATES["auction.sold"];
    expect(sold).toBeDefined();
    if (sold === undefined) return;
    expect(
      whatsappParams(
        sold,
        { team: "Cup Kings", price: "Rs 75,000", competition: "MPL 2026" },
        "Arjun",
      ),
    ).toEqual(["Arjun", "Cup Kings", "₹75,000", "MPL 2026"]);
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
  const sold = WHATSAPP_TEMPLATES["auction.sold"] as WhatsAppTemplate;
  const message = {
    name: "da_auction_sold",
    template: sold,
    params: ["Arjun", "Cup Kings", "₹75,000", "MPL 2026"],
    imageUrl: "https://desiauction.in/c/mpl/p/R1/opengraph-image",
  };

  it("sends the approved template with the card as the header image and the body params", async () => {
    const http = transport({ status: 200, body: '{"messages":[{"id":"wamid.1"}]}' });
    const sender = new WhatsAppCloudSender({
      phoneNumberId: "12345",
      accessToken: "token",
      transport: http.send,
    });
    await sender.send("+919812345678", message);
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
    await expect(sender.send("+919812345678", message)).rejects.toThrow(/breaker open/);
    expect(http.calls).toHaveLength(3);
  });
});
