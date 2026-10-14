import { expect, it } from "vitest";
import { financeDocumentHref, financeRegisterReturn } from "./finance-navigation";
it("retains the selected document register through detail and returns without inventing defaults", () => {
  const selected = new URLSearchParams({
    view: "receipts",
    kind: "receipt",
    q: "संपूर्ण टीम & receipt 12",
  });
  const detail = new URL(financeDocumentHref("club", "doc", selected), "https://example.test");
  expect(detail.pathname).toBe("/org/club/money/documents/doc");
  expect(financeRegisterReturn("club", detail.searchParams.get("register") ?? undefined)).toBe(
    `/org/club/money?${selected.toString()}`,
  );
  expect(financeDocumentHref("club", "doc", new URLSearchParams())).toBe(
    "/org/club/money/documents/doc",
  );
  expect(financeRegisterReturn("club", undefined)).toBe("/org/club/money");
});
it("rejects duplicate and oversized selections without accepting a foreign return destination", () => {
  const raw = new URLSearchParams(
    "view=receipts&view=all&kind=receipt&returnTo=https://foreign.test&q=" + "x".repeat(1025),
  );
  const detail = new URL(financeDocumentHref("club", "doc", raw), "https://example.test");
  expect(financeRegisterReturn("club", detail.searchParams.get("register") ?? undefined)).toBe(
    "/org/club/money?kind=receipt",
  );
  expect(financeRegisterReturn("club", ["q=other", "q=team"])).toBe("/org/club/money");
  expect(financeRegisterReturn("club", "q=" + "x".repeat(4096))).toBe("/org/club/money");
});
it("retains bounded historical filter values as data inside the same club route", () => {
  expect(
    financeRegisterReturn("club", "view=historical&kind=other&q=https%3A%2F%2Fforeign.test"),
  ).toBe("/org/club/money?view=historical&kind=other&q=https%3A%2F%2Fforeign.test");
});

it("keeps encoded multilingual returns inside their round-trip byte budget", () => {
  for (const q of ["टीम".repeat(80), "टीम".repeat(170)]) {
    const selected = new URLSearchParams({ view: "receipts", kind: "receipt", q });
    const detail = new URL(financeDocumentHref("club", "doc", selected), "https://example.test");
    const carried = detail.searchParams.get("register");
    expect(carried?.length ?? 0).toBeLessThanOrEqual(4096);
    const returned = new URL(
      financeRegisterReturn("club", carried ?? undefined),
      "https://example.test",
    );
    expect(returned.searchParams.get("view")).toBe("receipts");
    expect(returned.searchParams.get("kind")).toBe("receipt");
    expect(returned.searchParams.get("q")).toBe(new URLSearchParams(carried ?? "").get("q"));
  }
});
