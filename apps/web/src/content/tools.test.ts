import {
  SPORTS,
  applyMapping,
  detectMapping,
  mappingOf,
  parseRegistrationRecords,
} from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { TOOL_PAGES, registrationTemplate } from "./tools";

/**
 * SEO-1 Phase 4d. The registration-form template promises "worded this way,
 * the responses import without fixing". That promise is tested here the only
 * way that means anything: every sport's template goes through the REAL import
 * — header detection, mapping and row parsing — and must come out clean.
 */
describe("registration form template", () => {
  for (const pack of SPORTS) {
    it(`${pack.key}: every question heading is recognised by the importer`, () => {
      const questions = registrationTemplate(pack);
      const detected = detectMapping(
        questions.map((question) => question.heading),
        undefined,
        pack,
      );
      expect(detected.missing, "required fields no heading claimed").toEqual([]);
      expect(detected.conflicts).toEqual([]);
      for (const [index, question] of questions.entries()) {
        expect(detected.columns[index]?.field, question.heading).toBe(question.field);
      }
    });

    it(`${pack.key}: a response filled from the template's own choices imports with no error`, () => {
      const questions = registrationTemplate(pack);
      const answer = (field: string, options?: readonly string[]): string => {
        if (options !== undefined) return options[0] ?? "";
        switch (field) {
          case "name":
            return "Asha Rao";
          case "phone":
            return "9876543210";
          case "date_of_birth":
            return "12/05/2004";
          case "jersey_name":
            return "ASHA";
          case "jersey_number":
            return "7";
          case "photo_link":
            return "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123";
          default:
            return "";
        }
      };
      const header = questions.map((question) => question.heading);
      const row = questions.map((question) => answer(question.field, question.options));
      const detected = detectMapping(header, [header, row], pack);
      const records = applyMapping([header, row], mappingOf(detected));
      const parsed = parseRegistrationRecords(records, undefined, { pack });
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows).toHaveLength(1);
      // The first role choice comes back as the pack's first role.
      expect(parsed.rows[0]?.role).toBe(pack.roles.values[0]?.key);
      // Each of the sport's own details comes through as its first option's key.
      for (const attribute of pack.attributes.filter(
        (spec) => spec.key !== "batting_style" && spec.key !== "bowling_style",
      )) {
        expect(parsed.rows[0]?.attributes[attribute.key], attribute.key).toBe(
          attribute.options[0]?.key,
        );
      }
    });
  }
});

describe("tool pages", () => {
  it("keeps slugs, titles and descriptions unique and 50–160 characters", () => {
    for (const field of ["slug", "name", "title", "headline", "description"] as const) {
      const values = TOOL_PAGES.map((page) => page[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    for (const page of TOOL_PAGES) {
      expect(page.description.length, page.slug).toBeGreaterThanOrEqual(50);
      expect(page.description.length, page.slug).toBeLessThanOrEqual(160);
      expect(page.faqs.length, page.slug).toBeGreaterThanOrEqual(3);
    }
  });
});
