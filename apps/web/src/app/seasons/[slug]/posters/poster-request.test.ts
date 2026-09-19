import { POSTER_SIZES, POSTER_THEMES } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTER_SIZE,
  DEFAULT_POSTER_THEME,
  DEFAULT_TOP_COUNT,
  SPONSOR_MAX,
  cleanSponsor,
  parsePosterQuery,
  posterHeaders,
  posterRefusal,
} from "./poster-request";

const query = (search: string) => parsePosterQuery(new URLSearchParams(search));

describe("parsePosterQuery", () => {
  it("accepts every theme and size the model publishes", () => {
    for (const theme of POSTER_THEMES) {
      expect(query(`theme=${theme}`).theme).toBe(theme);
    }
    for (const size of Object.keys(POSTER_SIZES)) {
      expect(query(`size=${size}`).size).toBe(size);
    }
  });

  /*
   * Both values end up selecting a record key inside the renderer, which is the
   * one shape of untrusted input that turns a typo into a crash at raster time
   * rather than an error anyone sees. Anything the core type guards refuse falls
   * back — a stale link in a picker should still produce a poster.
   */
  it("falls back rather than trusting the query string", () => {
    for (const search of [
      "",
      "theme=&size=",
      "theme=Floodlight&size=SQUARE",
      "theme=constructor&size=__proto__",
      "theme=neon&size=banner",
      "theme[]=gold",
    ]) {
      expect(query(search)).toMatchObject({
        theme: DEFAULT_POSTER_THEME,
        size: DEFAULT_POSTER_SIZE,
      });
    }
  });

  it("treats download as opt-in, and only on an exact 1", () => {
    expect(query("").download).toBe(false);
    expect(query("download=1").download).toBe(true);
    for (const search of ["download=0", "download=true", "download=yes", "download="]) {
      expect(query(search).download).toBe(false);
    }
  });

  it("keeps a valid value when the other one is junk", () => {
    expect(query("theme=ink&size=nope")).toMatchObject({
      theme: "ink",
      size: DEFAULT_POSTER_SIZE,
    });
  });
});

describe("the kind's own parameters", () => {
  it("takes 3, 5 or 10 for the top list and nothing else", () => {
    for (const n of [3, 5, 10]) {
      expect(query(`n=${String(n)}`).count).toBe(n);
    }
    for (const search of ["n=7", "n=0", "n=-5", "n=1e3", "n=", "n=five", "n[]=3"]) {
      expect(query(search).count).toBe(DEFAULT_TOP_COUNT);
    }
  });

  /*
   * Absent means SHOWN. A missing parameter must never publish less than the
   * studio previewed — the preview and the file are the same route, and the
   * difference between them would be somebody's fee quietly appearing.
   */
  it("shows prices unless asked, in exactly those words, not to", () => {
    expect(query("").prices).toBe(true);
    expect(query("prices=1").prices).toBe(true);
    expect(query("prices=false").prices).toBe(true);
    expect(query("prices=0").prices).toBe(false);
  });

  it("narrows the size to what the KIND can draw", () => {
    // The season sheet has no square: 12 squads of thumbnails is not a poster.
    expect(parsePosterQuery(new URLSearchParams("size=square"), "season").size).toBe("portrait");
    expect(parsePosterQuery(new URLSearchParams("size=story"), "season").size).toBe("story");
    expect(parsePosterQuery(new URLSearchParams("size=square"), "player").size).toBe("square");
  });

  it("scrubs a sponsor credit down to one clamped line", () => {
    expect(cleanSponsor("  Sharma   Motors  ")).toBe("Sharma Motors");
    expect(cleanSponsor("Line one\nLine two")).toBe("Line one Line two");
    expect(cleanSponsor("\u0000\u001b[31m")).toBe("[31m");
    expect(cleanSponsor("   ")).toBeNull();
    expect(cleanSponsor(null)).toBeNull();
    const long = cleanSponsor("S".repeat(200));
    expect(long).toHaveLength(SPONSOR_MAX);
    expect(long?.endsWith("…")).toBe(true);
    expect(query("sponsor=Sharma%20Motors").sponsor).toBe("Sharma Motors");
  });

  it("treats motion as opt-in, like download", () => {
    expect(query("").motion).toBe(false);
    expect(query("motion=1").motion).toBe(true);
    expect(query("motion=true").motion).toBe(false);
  });
});

describe("posterHeaders", () => {
  /*
   * The load-bearing one. A poster is a photograph of a named civilian behind an
   * organizer's session; a shared cache holding it would be a copy of personal
   * data sitting outside every gate that produced it and outside the audit row
   * that recorded who took it.
   */
  it("never lets a poster into a shared cache", () => {
    for (const download of [true, false]) {
      expect(posterHeaders("mpl-rohit-square.png", download)["cache-control"]).toBe(
        "private, no-store, max-age=0",
      );
    }
  });

  it("attaches on download and previews otherwise", () => {
    expect(posterHeaders("mpl-rohit-square.png", true)["content-disposition"]).toBe(
      'attachment; filename="mpl-rohit-square.png"',
    );
    expect(posterHeaders("mpl-rohit-square.png", false)["content-disposition"]).toBe(
      'inline; filename="mpl-rohit-square.png"',
    );
  });

  it("declares the PNG the rasterizer actually returns", () => {
    expect(posterHeaders("x.png", false)["content-type"]).toBe("image/png");
  });

  /*
   * The animator cannot read a price off a picture, and a header carrying a ₹
   * is a header some proxy will mangle — so the facts travel as ASCII JSON.
   */
  it("carries the motion facts as ASCII JSON, only when there is a sprite", () => {
    expect(posterHeaders("x.png", false)["x-poster-motion"]).toBeUndefined();
    const header = posterHeaders("x.png", false, {
      layers: ["base", "hero", "stamp", "price"],
      height: 1350,
      pricePaise: 7_500_000,
    })["x-poster-motion"];
    expect(JSON.parse(header ?? "{}")).toMatchObject({ pricePaise: 7_500_000, height: 1350 });
    // eslint-disable-next-line no-control-regex -- asserting there are none.
    expect(/[^\x00-\x7f]/.test(header ?? "")).toBe(false);
  });
});

describe("posterRefusal", () => {
  /** A refusal drawn as a poster would be the one error message that gets shared. */
  it("answers in text, not in pixels, and stays out of caches", async () => {
    const response = posterRefusal(403, "You can't generate posters for this season.");
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.text()).toBe("You can't generate posters for this season.");
  });
});
