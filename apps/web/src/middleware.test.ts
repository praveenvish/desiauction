import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { expect, it, vi } from "vitest";
import { config } from "./middleware";
vi.mock("./env", () => ({ env: {} }));
vi.mock("./server/scoring/shell-artifact", () => ({ scoringShellArtifact: vi.fn() }));
it("excludes Android asset links while preserving protected document middleware", () => {
  expect(
    unstable_doesMiddlewareMatch({
      config,
      url: "https://desiauction.test/.well-known/assetlinks.json",
    }),
  ).toBe(false);
  expect(unstable_doesMiddlewareMatch({ config, url: "https://desiauction.test/score" })).toBe(
    true,
  );
  expect(unstable_doesMiddlewareMatch({ config, url: "https://desiauction.test/help" })).toBe(true);
});
