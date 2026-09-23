import { describe, expect, it, vi } from "vitest";

import {
  buildSubmitPayload,
  fetchTemplateStatuses,
  MAX_PAGES,
  MetaTemplateError,
  parseSubmitResponse,
  parseTemplatePage,
  submitRefusal,
  submitTemplate,
  variableCount,
} from "./meta-templates";
import { WHATSAPP_LANGUAGES, WHATSAPP_TEMPLATES } from "./whatsapp";

/*
 * META'S TEMPLATE MANAGEMENT API, pure and over a fake transport: the list's
 * parsing and pagination (bounded, cursor-only, token never in a URL), its
 * errors, and the submit payload built from the catalogue for en and hi.
 */

const TOKEN = "EAAG-secret-token";
const CONFIG = { wabaId: "123456789", accessToken: TOKEN, apiBase: "https://graph.test/v21.0" };

function page(data: unknown[], after?: string) {
  return JSON.stringify({
    data,
    paging:
      after === undefined
        ? { cursors: { before: "b" } }
        : {
            cursors: { before: "b", after },
            // Meta's own next link carries the token — it must never be followed.
            next: `https://graph.facebook.com/v21.0/123/message_templates?access_token=${TOKEN}&after=${after}`,
          },
  });
}

describe("parseTemplatePage", () => {
  it("reads name, language, status, category, quality and rejection", () => {
    const parsed = parseTemplatePage(
      page([
        {
          name: "da_auction_sold",
          language: "en",
          status: "APPROVED",
          category: "UTILITY",
          quality_score: { score: "GREEN", date: 1 },
          rejected_reason: "NONE",
          id: "111",
        },
        {
          name: "da_auction_sold",
          language: "hi",
          status: "rejected",
          category: "UTILITY",
          rejected_reason: "INVALID_FORMAT",
          id: "112",
        },
        { language: "en", status: "APPROVED" },
      ]),
    );
    expect(parsed.after).toBeNull();
    expect(parsed.templates).toEqual([
      {
        name: "da_auction_sold",
        language: "en",
        status: "APPROVED",
        category: "UTILITY",
        quality: "GREEN",
        rejectedReason: null,
        metaId: "111",
      },
      {
        name: "da_auction_sold",
        language: "hi",
        status: "REJECTED",
        category: "UTILITY",
        quality: null,
        rejectedReason: "INVALID_FORMAT",
        metaId: "112",
      },
    ]);
  });

  it("the next cursor only when Meta says there is a next page", () => {
    expect(parseTemplatePage(page([], "CURSOR2")).after).toBe("CURSOR2");
    expect(parseTemplatePage(page([])).after).toBeNull();
  });

  it("Meta's error envelope and a non-list body are errors, with Meta's words", () => {
    expect(() =>
      parseTemplatePage(JSON.stringify({ error: { code: 190, message: "Invalid OAuth token" } })),
    ).toThrow(/Invalid OAuth token/);
    expect(() => parseTemplatePage("<html>")).toThrow(MetaTemplateError);
    expect(() => parseTemplatePage(JSON.stringify({ nope: 1 }))).toThrow(/no template list/);
  });
});

describe("fetchTemplateStatuses — pagination", () => {
  it("follows cursors, never Meta's next link, and sends the token only as a header", async () => {
    const transport = vi.fn((url: string) =>
      Promise.resolve({
        status: 200,
        body: url.includes("after=C2")
          ? page([{ name: "b", language: "en", status: "PENDING" }])
          : page([{ name: "a", language: "en", status: "APPROVED" }], "C2"),
      }),
    );
    const all = await fetchTemplateStatuses({ ...CONFIG, transport });
    expect(all.map((t) => t.name)).toEqual(["a", "b"]);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [url, init] of transport.mock.calls as unknown as [
      string,
      { headers: Record<string, string> },
    ][]) {
      expect(url.startsWith("https://graph.test/v21.0/123456789/message_templates?")).toBe(true);
      expect(url).not.toContain(TOKEN);
      expect(url).toContain("fields=name%2Clanguage%2Cstatus%2Ccategory%2Cquality_score");
      expect(init.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("is bounded: an account that never ends is refused, not truncated", async () => {
    let n = 0;
    const transport = vi.fn(() => {
      n += 1;
      return Promise.resolve({ status: 200, body: page([], `C${String(n)}`) });
    });
    await expect(fetchTemplateStatuses({ ...CONFIG, transport })).rejects.toThrow(/not stored/);
    expect(transport).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("a 5xx, a 4xx and a dead connection are errors that name no secret", async () => {
    const answers = [
      () => Promise.resolve({ status: 503, body: "" }),
      () =>
        Promise.resolve({
          status: 400,
          body: JSON.stringify({ error: { code: 100, message: "Bad WABA" } }),
        }),
      () => Promise.reject(new Error(`connect ECONNREFUSED ${TOKEN}`)),
    ];
    for (const answer of answers) {
      const error = await fetchTemplateStatuses({ ...CONFIG, transport: vi.fn(answer) }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(MetaTemplateError);
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});

describe("the submit payload, built from the catalogue", () => {
  const submittable = Object.values(WHATSAPP_TEMPLATES).filter((t) => submitRefusal(t) === null);

  it("every template without a picture can be submitted from the screen", () => {
    expect(submittable.length).toBeGreaterThan(0);
    expect(submitRefusal(WHATSAPP_TEMPLATES["auction.sold"])).toMatch(/WhatsApp Manager/);
  });

  for (const template of submittable) {
    for (const language of WHATSAPP_LANGUAGES) {
      it(`${template.key} (${language}) matches Meta's schema`, () => {
        const payload = buildSubmitPayload(template.key, language, "da_test_name");
        expect(payload).toMatchObject({
          name: "da_test_name",
          language,
          category: "UTILITY",
          parameter_format: "POSITIONAL",
        });
        const [body, footer, buttons] = payload.components as [
          { type: string; text: string; example: { body_text: string[][] } },
          { type: string; text: string },
          { type: string; buttons: { type: string; text: string; url: string }[] },
        ];
        expect(body.type).toBe("BODY");
        expect(body.text).toBe(template.body[language]);
        // One sample per variable, in one row — Meta's review counts them.
        expect(body.example.body_text).toHaveLength(1);
        expect(body.example.body_text[0]).toHaveLength(variableCount(body.text));
        expect(variableCount(body.text)).toBe(template.params.length);
        // Variables are 1..n, and a body neither starts nor ends on one.
        expect(body.text.trim()).not.toMatch(/^\{\{/);
        expect(body.text.trim()).not.toMatch(/\}\}$/);
        expect(footer).toEqual({ type: "FOOTER", text: template.footer });
        expect(footer.text.length).toBeLessThanOrEqual(60);
        expect(buttons.type).toBe("BUTTONS");
        expect(buttons.buttons).toEqual([
          { type: "URL", text: template.button.label[language], url: template.button.url },
        ]);
        expect(buttons.buttons[0]?.text.length).toBeLessThanOrEqual(25);
        expect(body.text.length).toBeLessThanOrEqual(1024);
      });
    }
  }
});

describe("submitTemplate", () => {
  it("POSTs the payload to the account and reads Meta's id and status", async () => {
    const transport = vi.fn(() =>
      Promise.resolve({
        status: 200,
        body: JSON.stringify({ id: "5550", status: "PENDING", category: "UTILITY" }),
      }),
    );
    const payload = buildSubmitPayload("team.appointed", "hi", "da_team_appointed");
    const receipt = await submitTemplate({ ...CONFIG, transport }, payload);
    expect(receipt).toEqual({ metaId: "5550", status: "PENDING", category: "UTILITY" });
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      { method: string; body: string; headers: Record<string, string> },
    ];
    expect(url).toBe("https://graph.test/v21.0/123456789/message_templates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(payload);
    expect(init.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("Meta's refusal is an error with Meta's own words", async () => {
    const transport = vi.fn(() =>
      Promise.resolve({
        status: 400,
        body: JSON.stringify({
          error: { code: 100, error_user_msg: "Template name already exists" },
        }),
      }),
    );
    await expect(
      submitTemplate({ ...CONFIG, transport }, buildSubmitPayload("team.appointed", "en", "x")),
    ).rejects.toThrow(/already exists/);
  });

  it("parseSubmitResponse defaults a missing status to PENDING", () => {
    expect(parseSubmitResponse(JSON.stringify({ id: "1" }))).toEqual({
      metaId: "1",
      status: "PENDING",
      category: null,
    });
  });
});
