import type { RoleOption } from "./person-actions";

/**
 * The six platform roles a superadmin can give, in words an operator reads
 * once and understands (AC-1.2). Superadmin itself is not here: only the
 * `seed:admin` script gives or takes it.
 */
export const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    set: "platform:admin",
    label: "Admin console",
    what: "sees every club, person, auction and the audit log",
  },
  { set: "platform:support", label: "Support desk", what: "reads problem reports and reviews" },
  {
    set: "platform:moderation",
    label: "Moderation desk",
    what: "can take a public season page down",
  },
  { set: "platform:billing", label: "Billing desk", what: "answers season Pass requests" },
  { set: "platform:demo", label: "Demo desk", what: "handles demo requests and call times" },
  {
    set: "platform:privacy",
    label: "Privacy desk",
    what: "decides account deletion requests (cannot be undone)",
  },
];

export function roleLabel(set: string): string {
  return (
    ROLE_OPTIONS.find((option) => option.set === set)?.label ??
    (set === "platform:superadmin" ? "Superadmin" : set)
  );
}
