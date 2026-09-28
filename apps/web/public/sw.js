/*
 * DesiAuction's service worker — web push only (email programme PR18).
 *
 * It caches nothing and handles no fetches: the app is always the network's.
 * A push carries what the inbox row says (server/messaging/push.ts): a title,
 * a line, and /inbox. Tapping it focuses an open DesiAuction tab or opens one.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
