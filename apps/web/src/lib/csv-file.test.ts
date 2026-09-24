import { describe, expect, it } from "vitest";

import { readCsvFile } from "./csv-file";
import { zipEntries } from "./zip";
import { googleStyleZip as zipOf } from "./zip.test-support";

const CSV =
  '"Timestamp","Name","Mobile","Player Type"\n"2026/02/05","Rohit Sharma","9876543210","🏏 Batsman"\n';

describe("readCsvFile", () => {
  it("opens a Google Forms .csv.zip straight from the picker", async () => {
    const zip = zipOf([{ name: "Cricket Registration Form.csv", data: CSV }]);
    expect(zipEntries(zip)?.map((entry) => entry.name)).toEqual(["Cricket Registration Form.csv"]);
    const file = new File([zip], "Cricket Registration Form.csv.zip");
    await expect(readCsvFile(file)).resolves.toBe(CSV);
  });

  it("passes a plain CSV through untouched", async () => {
    await expect(readCsvFile(new File([CSV], "players.csv"))).resolves.toBe(CSV);
  });

  it("refuses a zip with no CSV inside, by name", async () => {
    const file = new File([zipOf([{ name: "photo.jpg", data: "x" }])], "photos.zip");
    await expect(readCsvFile(file)).rejects.toThrow("no CSV inside");
  });
});
