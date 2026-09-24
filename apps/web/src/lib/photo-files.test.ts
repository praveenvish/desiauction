import { describe, expect, it } from "vitest";

import { expandPhotoFiles, imageTypeOf } from "./photo-files";
import { googleStyleZip } from "./zip.test-support";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("expandPhotoFiles", () => {
  it("opens a Drive photo-folder zip into its photos, by their own names", async () => {
    const zip = googleStyleZip([
      { name: "Photo (File responses)/IMG_1054 - Rohit Sharma.jpg", data: JPEG },
      { name: "Photo (File responses)/IMG_2201 - Virat Kohli.HEIC", data: JPEG },
      { name: "Photo (File responses)/notes.txt", data: "not a photo" },
      { name: "__MACOSX/Photo (File responses)/._IMG_1054 - Rohit Sharma.jpg", data: "junk" },
      { name: "Photo (File responses)/", data: "" },
    ]);
    const loose = new File([JPEG], "Jasprit Bumrah.png", { type: "image/png" });
    const result = await expandPhotoFiles([new File([zip], "Photos-001.zip"), loose]);
    expect(result.files.map((file) => [file.name, file.type])).toEqual([
      ["IMG_1054 - Rohit Sharma.jpg", "image/jpeg"],
      ["IMG_2201 - Virat Kohli.HEIC", "image/heic"],
      ["Jasprit Bumrah.png", "image/png"],
    ]);
    // The bytes come through intact.
    const first = result.files[0];
    expect(first).toBeDefined();
    expect(new Uint8Array((await first?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(JPEG);
    // A non-photo is named, not silently dropped; the Mac shadow is noise.
    expect(result.skipped).toEqual(["notes.txt"]);
  });

  it("types files by extension, case-blind", () => {
    expect(imageTypeOf("a.JPEG")).toBe("image/jpeg");
    expect(imageTypeOf("a.webp")).toBe("image/webp");
    expect(imageTypeOf("a.gif")).toBeNull();
  });
});
