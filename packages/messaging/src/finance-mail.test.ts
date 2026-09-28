import type { DeliveryRequest } from "@desiauction/financial-operations";
import { describe, expect, it } from "vitest";

import { createHttpEmailAdapter, financeDocumentMail } from "./email-adapter";
import { EMAIL_TEMPLATES } from "./email-template-defaults";
import { defaultContent } from "./email-templates";

const fields = defaultContent(EMAIL_TEMPLATES["finance.document.issued"], "en").variants["receipt"];
const DOCUMENT = [
  "RECEIPT RCT/2026-27/000042",
  "Received from: Cup Kings <owners@cupkings>",
  "Amount: ₹25,000.00",
].join("\n");
const BASE = "https://desiauction.in";

describe("a finance document's email (email programme PR10)", () => {
  if (fields === undefined) throw new Error("no receipt wording");

  it("keeps the text part exactly what it was — the document is the club's record", () => {
    const plain = financeDocumentMail(fields, DOCUMENT);
    const branded = financeDocumentMail(fields, DOCUMENT, {
      publicBaseUrl: BASE,
      templateId: "receipt.issued",
      orgName: "Malad Cricket Club",
    });
    expect(plain).toEqual({ subject: fields.subject, text: plain.text });
    expect(branded.text).toBe(plain.text);
    expect(branded.subject).toBe(plain.subject);
  });

  it("lays the document out whole, escaped, under its own heading and the club", () => {
    const { html } = financeDocumentMail(fields, DOCUMENT, {
      publicBaseUrl: BASE,
      templateId: "receipt.issued",
      orgName: "Malad Cricket Club",
    });
    expect(html).toContain(">Your receipt</h1>");
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain(
      "RECEIPT RCT/2026-27/000042\nReceived from: Cup Kings &lt;owners@cupkings&gt;",
    );
    expect(html).toContain("Malad Cricket Club");
    expect(html).toContain("Receipts and money");
    expect(html).toContain("issued this document to your team");
  });

  it("names each document by what it is, in the reader's language", () => {
    const invoice = financeDocumentMail(fields, DOCUMENT, {
      publicBaseUrl: BASE,
      templateId: "invoice.issued",
    }).html;
    expect(invoice).toContain(">Your invoice</h1>");
    expect(invoice).toContain("a club on DesiAuction");
    const hindi = financeDocumentMail(fields, DOCUMENT, {
      publicBaseUrl: BASE,
      templateId: "receipt.issued",
      language: "hi",
    }).html;
    expect(hindi).toContain('<html lang="hi"');
    expect(hindi).toContain(">आपकी रसीद</h1>");
  });

  it("sends the branded part beside the text", async () => {
    let sent: Record<string, unknown> = {};
    const adapter = createHttpEmailAdapter(
      {
        endpoint: "https://api.resend.com/emails",
        apiKey: "k",
        from: "DesiAuction <hello@desiauction.in>",
        transport: (_url, init) => {
          sent = JSON.parse(init.body) as Record<string, unknown>;
          return Promise.resolve({ status: 200, body: "{}" });
        },
        compose: (request) =>
          Promise.resolve(
            financeDocumentMail(fields, request.body, {
              publicBaseUrl: BASE,
              templateId: request.templateId,
            }),
          ),
      },
      () => Promise.resolve("owner@example.com"),
    );
    const request = {
      dispatchId: "d1",
      orgId: "o1",
      channel: "email",
      recipientRef: "team:t1",
      templateId: "receipt.issued",
      templateVersion: "1",
      subjectRef: "doc:1",
      body: DOCUMENT,
      bodyDigest: "digest",
      idempotencyKey: "dispatch:d1",
    } as DeliveryRequest;
    const result = await adapter.send(request);
    expect(result.ok).toBe(true);
    expect(sent["text"]).toBe(financeDocumentMail(fields, DOCUMENT).text);
    expect(String(sent["html"])).toContain(">Your receipt</h1>");
  });
});
