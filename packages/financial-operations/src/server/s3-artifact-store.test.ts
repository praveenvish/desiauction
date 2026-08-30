import { describe, expect, it } from "vitest";

import { bucketArtifactStoreFromEnv, createBucketArtifactStore } from "./s3-artifact-store";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

function fakeBucket() {
  const objects = new Map<string, string>();
  const requests: Captured[] = [];
  const store = createBucketArtifactStore({
    endpoint: "http://minio.local:9000",
    region: "ap-south-1",
    bucket: "finops",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret_test_key",
    now: () => Date.parse("2026-08-30T12:00:00.000Z"),
    transport: (url, init) => {
      requests.push({ url, method: init.method, headers: init.headers, body: init.body });
      if (init.method === "PUT") {
        // The key sits after /{bucket}/ in the path.
        const key = url.split("/finops/")[1] ?? "";
        objects.set(decodeURIComponent(key), init.body ?? "");
        return Promise.resolve({ status: 200, text: () => Promise.resolve("") });
      }
      const key = url.split("/finops/")[1] ?? "";
      const value = objects.get(decodeURIComponent(key));
      return Promise.resolve(
        value === undefined
          ? { status: 404, text: () => Promise.resolve("") }
          : { status: 200, text: () => Promise.resolve(value) },
      );
    },
  });
  return { store, requests };
}

describe("S3 artifact store (PRR P1-4)", () => {
  it("round-trips bytes through put and get", async () => {
    const { store } = fakeBucket();
    const bytes = JSON.stringify({ doc: "receipt", n: 1 });
    const { ref } = await store.put("artifacts/org1/doc1.json", bytes);
    expect(ref).toBe("artifacts/org1/doc1.json");
    expect(await store.get("artifacts/org1/doc1.json")).toBe(bytes);
  });

  it("returns null for a missing object (fail-closed read)", async () => {
    const { store } = fakeBucket();
    expect(await store.get("artifacts/org1/missing.json")).toBeNull();
  });

  it("signs each request with a well-formed SigV4 header, path-style, payload-hashed", async () => {
    const { store, requests } = fakeBucket();
    await store.put("artifacts/o/d.json", "{}");
    const put = requests[0];
    expect(put?.url).toBe("http://minio.local:9000/finops/artifacts/o/d.json");
    expect(put?.headers["x-amz-date"]).toBe("20260830T120000Z");
    // The signed content hash is the sha256 of the body, not UNSIGNED-PAYLOAD.
    expect(put?.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(put?.headers["Authorization"]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/20260830\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("is deterministic: the same request at the same instant signs identically", async () => {
    const a = fakeBucket();
    const b = fakeBucket();
    await a.store.put("artifacts/o/d.json", "{}");
    await b.store.put("artifacts/o/d.json", "{}");
    expect(a.requests[0]?.headers["Authorization"]).toBe(b.requests[0]?.headers["Authorization"]);
  });

  it("bucketArtifactStoreFromEnv returns null unless the bucket store is requested", () => {
    expect(bucketArtifactStoreFromEnv({})).toBeNull();
    expect(bucketArtifactStoreFromEnv({ FINOPS_ARTIFACT_STORE: "filesystem" })).toBeNull();
  });

  it("bucketArtifactStoreFromEnv refuses an incompletely-configured bucket", () => {
    expect(() => bucketArtifactStoreFromEnv({ FINOPS_ARTIFACT_STORE: "bucket" })).toThrow(
      /FINOPS_S3_ENDPOINT/,
    );
  });

  it("bucketArtifactStoreFromEnv builds a working store when fully configured", () => {
    const store = bucketArtifactStoreFromEnv({
      FINOPS_ARTIFACT_STORE: "bucket",
      FINOPS_S3_ENDPOINT: "http://minio.local:9000",
      FINOPS_S3_REGION: "ap-south-1",
      FINOPS_S3_BUCKET: "finops",
      FINOPS_S3_ACCESS_KEY_ID: "AKIA_TEST",
      FINOPS_S3_SECRET_ACCESS_KEY: "secret_test_key",
    });
    expect(store).not.toBeNull();
  });
});
