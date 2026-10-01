import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  INDEXNOW_KEY: undefined as string | undefined,
  PUBLIC_BASE_URL: "https://desiauction.in",
}));
vi.mock("../../env", () => ({ env: settings }));
vi.mock("../logger", () => ({ logger: () => ({ info: vi.fn(), warn: vi.fn() }) }));

import { notifyIndexNow } from "./indexnow";

// Deliberately low-entropy: a realistic-looking key trips the secrets scan.
const FAKE_KEY = "x".repeat(16);

describe("notifyIndexNow", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    settings.INDEXNOW_KEY = undefined;
  });

  it("announces nothing where no key is configured (dev, e2e, CI, staging)", async () => {
    await notifyIndexNow(["/c/vpl-1-513q"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts absolute URLs on our own host with the key's location", async () => {
    settings.INDEXNOW_KEY = FAKE_KEY;
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await notifyIndexNow(["/c/vpl-1-513q", "/c"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(init?.body as string)).toEqual({
      host: "desiauction.in",
      key: FAKE_KEY,
      keyLocation: "https://desiauction.in/indexnow-key.txt",
      urlList: ["https://desiauction.in/c/vpl-1-513q", "https://desiauction.in/c"],
    });
  });

  it("never throws when the search engine is down or refuses", async () => {
    settings.INDEXNOW_KEY = FAKE_KEY;
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(notifyIndexNow(["/c"])).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 422 }));
    await expect(notifyIndexNow(["/c"])).resolves.toBeUndefined();
  });
});
