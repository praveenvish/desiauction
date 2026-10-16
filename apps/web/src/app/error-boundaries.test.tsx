import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PageError from "./error";
import GlobalError from "./global-error";

describe.each([
  ["page", PageError],
  ["root", GlobalError],
] as const)("%s error recovery", (_, Boundary) => {
  it.each([undefined, "support-code-1413"])(
    "offers recovery without claiming the previous action's outcome (digest %s)",
    (digest) => {
      const error: Error & { digest?: string } = new Error("Private financial record and token");
      error.stack = "Sensitive internal stack";
      if (digest !== undefined) error.digest = digest;
      const html = renderToStaticMarkup(<Boundary error={error} reset={() => undefined} />);
      expect(html).toContain("Check the latest state before repeating an action.");
      expect(html).not.toContain("lose anything");
      expect(html).not.toContain(error.message);
      expect(html).not.toContain(error.stack);
      expect(html).toContain("Try again");
      expect(html).toContain('href="/home"');
      expect(html).toContain('href="/support"');
      if (digest !== undefined) expect(html).toContain(digest);
    },
  );
});
