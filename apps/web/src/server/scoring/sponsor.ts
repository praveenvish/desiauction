import { isStoredMediaKey } from "@desiauction/core";
import { storage } from "../media";
export function sponsorDetails(rules: unknown, orgId: string, competitionId: string) {
  if (!rules || typeof rules !== "object" || !("sponsor" in rules)) return null;
  const sponsor = rules.sponsor;
  if (
    !sponsor ||
    typeof sponsor !== "object" ||
    !("name" in sponsor) ||
    typeof sponsor.name !== "string"
  )
    return null;
  const name = Array.from(sponsor.name)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 120);
  if (!name) return null;
  const key = "logoKey" in sponsor && typeof sponsor.logoKey === "string" ? sponsor.logoKey : null;
  return {
    name,
    logoUrl:
      key && isStoredMediaKey(key) && key.startsWith(`org/${orgId}/competition/${competitionId}/`)
        ? storage.readUrl(key)
        : null,
  };
}
