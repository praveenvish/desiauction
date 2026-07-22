import { afterEach, describe, expect, it, vi } from "vitest";

import { runMediaUpload, type AttachOutcome, type PresignOutcome } from "./run-media-upload";

const file = { type: "image/png", size: 1234 } as unknown as File;
const okPresign = (): Promise<PresignOutcome> =>
  Promise.resolve({ ok: true, uploadUrl: "/api/media/upload?key=k", key: "k" });
const okAttach = (): Promise<AttachOutcome> => Promise.resolve({ ok: true, url: "/_media/k.png" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runMediaUpload", () => {
  it("presign → PUT → attach → returns the attached url", async () => {
    const put = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", put);
    const result = await runMediaUpload(file, okPresign, okAttach);
    expect(result).toEqual({ ok: true, url: "/_media/k.png" });
    expect(put).toHaveBeenCalledWith(
      "/api/media/upload?key=k",
      expect.objectContaining({ method: "PUT", body: file }),
    );
  });

  it("stops with the presign error and never PUTs", async () => {
    const put = vi.fn();
    vi.stubGlobal("fetch", put);
    const result = await runMediaUpload(
      file,
      () => Promise.resolve({ ok: false, error: "Too big." }),
      okAttach,
    );
    expect(result).toEqual({ ok: false, error: "Too big." });
    expect(put).not.toHaveBeenCalled();
  });

  it("reports a friendly error when the byte PUT fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false } as Response));
    const result = await runMediaUpload(file, okPresign, okAttach);
    expect(result).toEqual({ ok: false, error: "Upload failed. Please try again." });
  });

  it("surfaces the attach error", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true } as Response));
    const result = await runMediaUpload(file, okPresign, () =>
      Promise.resolve({ ok: false, error: "Forbidden." }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
  });
});
