import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../app/manifest";
import { installOffer, isAppleMobile } from "./pwa";

const PUBLIC = path.resolve(__dirname, "../../public");
const WORKER_SOURCE = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
const ORIGIN = "https://desiauction.test";

describe("installOffer", () => {
  const facts = { standalone: false, ios: false, promptReady: false, installed: false };

  it("offers nothing once installed, whatever else is true", () => {
    expect(installOffer({ ...facts, standalone: true, promptReady: true, ios: true })).toBe("none");
    expect(installOffer({ ...facts, installed: true, promptReady: true })).toBe("none");
  });

  it("opens the browser's dialog when one is ready", () => {
    expect(installOffer({ ...facts, promptReady: true })).toBe("prompt");
  });

  it("shows the Share steps on an iPhone, which never fires the prompt", () => {
    expect(installOffer({ ...facts, ios: true })).toBe("ios");
  });

  it("offers nothing in a browser that cannot install", () => {
    expect(installOffer(facts)).toBe("none");
  });
});

describe("isAppleMobile", () => {
  it("knows an iPhone, and an iPad that says it is a Mac", () => {
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });

  it("does not mistake a Mac or an Android phone for one", () => {
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
  });
});

describe("manifest", () => {
  it("points only at files that exist", () => {
    const { icons = [], screenshots = [], shortcuts = [] } = manifest();
    const files = [
      ...icons.map((icon) => icon.src),
      ...screenshots.map((shot) => shot.src),
      ...shortcuts.flatMap((shortcut) => (shortcut.icons ?? []).map((icon) => icon.src)),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(existsSync(path.join(PUBLIC, file)), file).toBe(true);
    }
  });

  it("keeps the app's identity fixed", () => {
    // A changed id is a different app: every installed icon goes stale.
    expect(manifest().id).toBe("/");
  });
});

describe("offline.html", () => {
  const page = readFileSync(path.join(PUBLIC, "offline.html"), "utf8");

  it("is the revision the worker stores", () => {
    const digest = createHash("sha256").update(page).digest("hex").slice(0, 8);
    const declared = /const OFFLINE_REVISION = "([0-9a-f]{8})";/.exec(WORKER_SOURCE)?.[1];
    expect(
      declared,
      `offline.html changed: set OFFLINE_REVISION in public/sw.js to "${digest}"`,
    ).toBe(digest);
  });

  it("loads nothing it would have to fetch, so it renders from the device alone", () => {
    expect(page).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/\b(src|href)="(?!")[^"]/);
    expect(page).not.toMatch(/url\(/);
  });
});

/*
 * THE WORKER ITSELF, run as written in a sandbox that stands in for a service
 * worker global: event listeners, Cache Storage, fetch.
 */

class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly network: (request: Request) => Promise<Response>) {}
  private key(request: Request | string): string {
    return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
  }
  match(request: Request | string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(this.key(request))?.clone());
  }
  put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(this.key(request), response);
    return Promise.resolve();
  }
  async add(request: Request): Promise<void> {
    const response = await this.network(request);
    if (!response.ok) {
      throw new TypeError("bad response");
    }
    await this.put(request, response);
  }
  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }
  delete(request: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(this.key(request)));
  }
}

interface FakeEvent {
  responded: Promise<Response> | undefined;
  settled: () => Promise<unknown>;
}

function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const store = new Map<string, FakeCache>();
  const network = vi.fn<(request: Request) => Promise<Response>>();
  const caches = {
    open: (name: string) => {
      if (!store.has(name)) {
        store.set(name, new FakeCache((request) => network(request)));
      }
      return Promise.resolve(store.get(name) as FakeCache);
    },
    keys: () => Promise.resolve([...store.keys()]),
    delete: (name: string) => Promise.resolve(store.delete(name)),
    match: (request: Request | string, options?: { cacheName?: string }) =>
      store.get(options?.cacheName ?? "")?.match(request) ?? Promise.resolve(undefined),
  };
  const enablePreload = vi.fn(() => Promise.resolve());
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { navigationPreload: { enable: enablePreload } },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
  };
  vm.runInNewContext(WORKER_SOURCE, {
    self,
    caches,
    fetch: (request: Request) => network(request),
    // A worker resolves relative URLs against its own origin; Node has none.
    Request: class extends Request {
      constructor(input: string, init?: RequestInit) {
        super(new URL(input, ORIGIN), init);
      }
    },
    Response,
    Headers,
    URL,
    // Looked up at call time, so vi.useFakeTimers() reaches the worker.
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
  });

  const lifecycle = async (type: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  };

  const dispatch = (request: Request, preload?: Response): FakeEvent => {
    const waits: Promise<unknown>[] = [];
    const event = {
      request,
      preloadResponse: Promise.resolve(preload),
      responded: undefined as Promise<Response> | undefined,
      respondWith(promise: Promise<Response>) {
        event.responded = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        waits.push(promise);
      },
    };
    listeners.get("fetch")?.(event);
    return {
      get responded() {
        return event.responded;
      },
      settled: () => Promise.all(waits),
    };
  };

  return { network, store, enablePreload, lifecycle, dispatch };
}

const OFFLINE_PAGE = () =>
  new Response("<h1>You're offline</h1>", { headers: { "content-type": "text/html" } });

/** `mode` cannot be set on a constructed Request, so it is stood in for. */
function navigation(pathname: string): Request {
  const request = new Request(`${ORIGIN}${pathname}`);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

function buildFileResponse(cacheControl: string): Response {
  const response = new Response("console.log(1)", {
    headers: { "content-type": "application/javascript", "cache-control": cacheControl },
  });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

describe("sw.js", () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(async () => {
    worker = loadWorker();
    worker.network.mockImplementation((request) =>
      Promise.resolve(request.url.endsWith("/offline.html") ? OFFLINE_PAGE() : new Response("ok")),
    );
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    worker.network.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the offline page at install and turns navigation preload on", () => {
    const shell = [...worker.store.keys()].find((name) => name.startsWith("da-shell-"));
    expect(shell).toBeDefined();
    expect(worker.store.get(shell as string)?.entries.has(`${ORIGIN}/offline.html`)).toBe(true);
    expect(worker.enablePreload).toHaveBeenCalled();
  });

  it("never answers a write, another origin, the API, or a router fetch", () => {
    const untouched = [
      new Request(`${ORIGIN}/seasons/x`, { method: "POST", body: "bid" }),
      new Request("https://engine.desiauction.test/ws"),
      new Request("https://media.desiauction.test/desiauction-media/face.webp"),
      new Request(`${ORIGIN}/api/client-error`),
      new Request(`${ORIGIN}/seasons/x?_rsc=abc`, { headers: { RSC: "1" } }),
      new Request(`${ORIGIN}/brand/mark.png`),
    ];
    for (const request of untouched) {
      expect(worker.dispatch(request).responded, request.url).toBeUndefined();
    }
  });

  it("serves a page from the network, through the preload when there is one", async () => {
    const preloaded = new Response("<h1>Season</h1>");
    const event = worker.dispatch(navigation("/seasons/x"), preloaded);
    expect(await event.responded).toBe(preloaded);
    expect(worker.network).not.toHaveBeenCalled();

    worker.network.mockResolvedValueOnce(new Response("<h1>Home</h1>"));
    const fallback = worker.dispatch(navigation("/home"));
    expect(await (await fallback.responded)?.text()).toBe("<h1>Home</h1>");
  });

  it("passes a server's error through: answering is not being offline", async () => {
    worker.network.mockResolvedValueOnce(new Response("down", { status: 502 }));
    const response = await worker.dispatch(navigation("/home")).responded;
    expect(response?.status).toBe(502);
  });

  it("shows the offline page when a page gets no response at all", async () => {
    worker.network.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const response = await worker.dispatch(navigation("/seasons/x/squad")).responded;
    expect(await response?.text()).toContain("You're offline");
  });

  it("never stores a page", async () => {
    worker.network.mockResolvedValueOnce(new Response("<h1>My squad, my money</h1>"));
    await worker.dispatch(navigation("/seasons/x/squad")).responded;
    for (const cache of worker.store.values()) {
      expect([...cache.entries.keys()]).not.toContain(`${ORIGIN}/seasons/x/squad`);
    }
  });

  it("keeps an immutable build file and serves it from the device next time", async () => {
    vi.useFakeTimers();
    const url = `${ORIGIN}/_next/static/chunks/app-abc123.js`;
    worker.network.mockResolvedValueOnce(buildFileResponse("public, max-age=31536000, immutable"));
    const first = worker.dispatch(new Request(url));
    await first.responded;
    await vi.advanceTimersByTimeAsync(1_000);
    await first.settled();

    const second = await worker.dispatch(new Request(url)).responded;
    expect(await second?.text()).toBe("console.log(1)");
    expect(worker.network).toHaveBeenCalledTimes(1);
  });

  it("does not keep a build file the server does not call immutable (next dev)", async () => {
    const url = `${ORIGIN}/_next/static/chunks/app/page.js`;
    worker.network.mockImplementation(() =>
      Promise.resolve(buildFileResponse("no-store, must-revalidate")),
    );
    const first = worker.dispatch(new Request(url));
    await first.responded;
    await first.settled();
    await worker.dispatch(new Request(url)).responded;
    expect(worker.network).toHaveBeenCalledTimes(2);
  });

  it("keeps the build-file cache to its limit, dropping the oldest", async () => {
    vi.useFakeTimers();
    const statics = worker.store.get("da-static") ?? new FakeCache(worker.network);
    worker.store.set("da-static", statics);
    for (let index = 0; index < 200; index += 1) {
      await statics.put(`${ORIGIN}/_next/static/old-${String(index)}.js`, new Response(""));
    }
    worker.network.mockResolvedValueOnce(buildFileResponse("public, immutable"));
    const event = worker.dispatch(new Request(`${ORIGIN}/_next/static/new.js`));
    await event.responded;
    await vi.advanceTimersByTimeAsync(1_000);
    await event.settled();

    expect(statics.entries.size).toBe(200);
    expect(statics.entries.has(`${ORIGIN}/_next/static/old-0.js`)).toBe(false);
    expect(statics.entries.has(`${ORIGIN}/_next/static/new.js`)).toBe(true);
  });

  it("clears its own earlier caches on activate, and nobody else's", async () => {
    const current = [...worker.store.keys()];
    worker.store.set("da-shell-0ld0ld00", new FakeCache(worker.network));
    worker.store.set("someone-else", new FakeCache(worker.network));
    await worker.lifecycle("activate");
    expect([...worker.store.keys()].sort()).toEqual([...current, "someone-else"].sort());
  });
});
