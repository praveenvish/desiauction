import { isNotificationKind, notificationOf } from "@desiauction/messaging/catalogue";

/**
 * A message shape's key as words: "registration.approved@2" reads
 * "Registration approved · v2". The key stays the row's hover and test id.
 */
export function messageKeyLabel(key: string): string {
  const [base = key, version] = key.split("@");
  // The catalogue's own name first: the key `registration.rejected` read
  // "Registration rejected" here while Notifications, Analytics and Templates
  // (which read the catalogue) called the same message "Registration declined".
  const named = isNotificationKind(base) ? notificationOf(base).label : null;
  const words = base
    .split(/[._:]/)
    .filter((part) => part !== "")
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]/g, " ")
        .toLowerCase(),
    )
    .join(" ");
  const sentence = named ?? (words === "" ? base : words.charAt(0).toUpperCase() + words.slice(1));
  return version !== undefined && version !== "" ? `${sentence} · v${version}` : sentence;
}
