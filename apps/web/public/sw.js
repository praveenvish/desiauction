/*
 * DesiAuction's service worker — the installed app, the offline screen, and
 * web push (email programme PR18).
 *
 * WHAT IT DOES, AND ALL IT DOES:
 *
 *   1. A page opened with no network gets the offline screen (/offline.html,
 *      stored at install) instead of the browser's error. It is our own page,
 *      it carries no data, and it tries again by itself.
 *   2. The build's own files (/_next/static: JavaScript, CSS, the fonts
 *      next/font emits) are kept on the device, so the installed app opens
 *      from the phone and not from a 3G tower. Only what the server marks
 *      `immutable` is kept. Next stamps that on hashed build files in
 *      production and never in `next dev`, so a developer's code is never
 *      served stale, and a deploy's files arrive under new names, never as
 *      overwrites.
 *   3. Push notifications, unchanged.
 *
 * WHAT IT NEVER DOES, ON PURPOSE:
 *
 *   - Store a page. Pages carry squads, money and phone numbers, and phones are
 *     shared. A stored page is somebody's data on somebody else's device after
 *     they signed out, and a balance that is wrong by the time it is read. The
 *     network is the only source of a page; offline gets a screen that says so.
 *   - Touch anything but a same-origin GET. Bids, server actions (POST), the
 *     API, sign-in, and the live room's socket (which a service worker cannot
 *     see anyway) go to the network as if this file did not exist.
 *   - Store photos. They come from the media host, whose one-day cache is the
 *     take-down guarantee (ops/deploy/site.caddy); a copy here would outlive it.
 *
 * Navigation preload is on: a page request starts the moment the worker is
 * woken, so the worker adds no wait to it. EXCEPT IN FIREFOX, where a
 * preload that fails (no network) fails the whole navigation, even though
 * this worker catches it and answers with the offline screen: the browser's
 * own error page wins. Measured, not assumed: with preload on, Firefox showed
 * "Problem loading page" on every run; with it off, the offline screen on
 * every run. Chromium and Safari use the worker's answer, as the spec says.
 * Firefox pays a worker start-up on each page instead, and stays correct.
 *
 * IF THIS FILE EVER MISBEHAVES IN PRODUCTION, deploy it with every listener
 * replaced by the kill switch below. Browsers re-check this file on every
 * navigation (it is registered with `updateViaCache: "none"`), so each device
 * drops the worker and its caches on its next visit. Push subscriptions go
 * with it; people turn notifications back on from Account.
 *
 *   self.addEventListener("install", () => self.skipWaiting());
 *   self.addEventListener("activate", (event) => {
 *     event.waitUntil(
 *       caches.keys()
 *         .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
 *         .then(() => self.registration.unregister()),
 *     );
 *   });
 */

// A digest of offline.html. pwa.test.ts recomputes it and fails, naming the new
// value, when the page changes and this line does not. This line changing is
// what makes browsers install a new worker, and the new worker is what stores
// the new page.
const OFFLINE_REVISION = "565c3285";

const OFFLINE_URL = "/offline.html";
const PREFIX = "da-";
const SHELL_CACHE = `${PREFIX}shell-${OFFLINE_REVISION}`;
// Not versioned: every file in it is named by its own content hash, so the
// cache is never wrong, only full. Earlier builds' files are trimmed oldest
// first.
const STATIC_CACHE = `${PREFIX}static`;
// A build is a few hundred files and one person loads a fraction of them. 200
// holds every screen someone actually uses plus a deploy's worth of overlap,
// and stays a few megabytes.
const STATIC_LIMIT = 200;
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload`: from the server, never the HTTP cache, so a new worker can
      // never store the previous deploy's page.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // Only our own names: never delete a cache this worker did not make.
          .filter((key) => key.startsWith(PREFIX) && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key)),
      );
      const preload = self.registration.navigationPreload;
      if (preload !== undefined) {
        // `disable` too, not just "don't enable": it is a stored setting, and
        // must be undone wherever an earlier worker turned it on.
        await (preloadBreaksOffline() ? preload.disable() : preload.enable());
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") && !request.headers.has("range")) {
    event.respondWith(buildFile(event));
  }
  // Anything else is not answered here, so the browser fetches it as usual.
});

/** Firefox: see the note on navigation preload at the top of this file. */
function preloadBreaksOffline() {
  return /\bFirefox\//.test(self.navigator.userAgent);
}

/** A page: always the network's. The offline screen only when there is none. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded !== undefined && preloaded !== null) {
      return preloaded;
    }
    return await fetch(event.request);
  } catch (error) {
    // A server that answers, even with a 500, is not offline, and its answer
    // was returned above. Only a request that got no response at all is here.
    const offline = await caches
      .match(OFFLINE_URL, { cacheName: SHELL_CACHE })
      .catch(() => undefined);
    if (offline !== undefined) {
      return offline;
    }
    throw error;
  }
}

/** A build file: from the device when it is there, else the network's, kept. */
async function buildFile(event) {
  let cache = null;
  try {
    cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(event.request);
    if (hit !== undefined) {
      return hit;
    }
  } catch {
    // Storage refused (private mode, quota, a cleared origin). The network
    // still works, and a cache must never be why a page does not load.
    cache = null;
  }
  const response = await fetch(event.request);
  if (cache !== null && isImmutable(response)) {
    event.waitUntil(
      cache
        .put(event.request, response.clone())
        .then(() => trimSoon(cache))
        .catch(() => undefined),
    );
  }
  return response;
}

/** The server's own promise that this URL's bytes never change. */
function isImmutable(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    /\bimmutable\b/.test(response.headers.get("cache-control") ?? "")
  );
}

// A first visit stores dozens of files at once: one trim after the burst, not
// one per file.
let trimTimer = null;
function trimSoon(cache) {
  if (trimTimer !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    trimTimer = setTimeout(() => {
      trimTimer = null;
      trim(cache).then(resolve, resolve);
    }, 1000);
  });
}

/** Oldest first: `keys()` lists entries in the order they were stored. */
async function trim(cache) {
  const keys = await cache.keys();
  for (let index = 0; index < keys.length - STATIC_LIMIT; index += 1) {
    await cache.delete(keys[index]);
  }
}

/*
 * PUSH. A push carries what the inbox row says (server/messaging/push.ts): a
 * title, a line, and /inbox. Tapping it focuses an open DesiAuction tab or
 * opens one.
 */

self.addEventListener("push", (event) => {
  let notice = {
    title: "DesiAuction",
    body: "You have a new notification.",
    url: "/inbox",
    tag: "notice",
  };
  try {
    notice = { ...notice, ...event.data.json() };
  } catch {
    // An empty or unreadable push still says something happened.
  }
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: "/brand/mark.png",
      badge: "/brand/mark.png",
      data: { url: notice.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.navigate(target).then((c) => (c ?? client).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
