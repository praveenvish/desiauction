import { SegmentedTabs } from "@desiauction/ui";

/**
 * The notification control center's own sections, as one segmented rail
 * (wow pass). They were three outlined buttons on the controls page and a
 * "← All notifications" button on each child — navigation dressed as actions,
 * in two different shapes. The link names are the ones the suites drive.
 */
const SECTIONS = [
  { key: "messages", label: "Messages", href: "/admin/notifications" },
  { key: "templates", label: "Templates", href: "/admin/notifications/templates" },
  { key: "suppressions", label: "Suppressions", href: "/admin/notifications/suppressions" },
  { key: "analytics", label: "Delivery analytics", href: "/admin/notifications/analytics" },
] as const;

export type NotifySection = (typeof SECTIONS)[number]["key"] | "email";

export function NotifySubnav({ current }: { current: NotifySection }) {
  return (
    <SegmentedTabs
      label="Notification sections"
      items={SECTIONS.map((section) => ({
        key: section.key,
        label: section.label,
        href: section.href,
        // The email editor lives under Messages: a message's wording is part of it.
        active: section.key === current || (current === "email" && section.key === "messages"),
      }))}
    />
  );
}
