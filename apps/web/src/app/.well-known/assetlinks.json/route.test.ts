import { afterEach, expect, it, vi } from "vitest";
import { env } from "../../../env";
import { GET } from "./route";
vi.mock("../../../env", () => ({
  env: { TWA_PACKAGE_NAME: "in.desiauction.app", TWA_SHA256_FINGERPRINTS: undefined },
}));
afterEach(() => {
  env.TWA_SHA256_FINGERPRINTS = undefined;
});
it("returns 404 when Android signing certificates are unset", () => {
  expect(GET().status).toBe(404);
});
it("serves the exact Android package and every configured signing certificate as JSON", async () => {
  const fingerprints = [Array(32).fill("AB").join(":"), Array(32).fill("CD").join(":")];
  env.TWA_SHA256_FINGERPRINTS = fingerprints;
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "in.desiauction.app",
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
  env.TWA_SHA256_FINGERPRINTS = undefined;
});
