import { POSTER_SIZES, POSTER_THEMES } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTER_SIZE,
  DEFAULT_POSTER_THEME,
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
