import { expect, it } from "vitest";
import { newId } from "@desiauction/db";
import { sponsorDetails } from "./sponsor";
it("bounds sponsor identity and refuses external or cross-season logo keys", () => {
  const org = newId(),
    competition = newId();
  for (const logoKey of [
    "https://tracking.example/logo.svg",
    `org/${newId()}/competition/${competition}/${newId()}.png`,
    "private/logo.png",
  ])
    expect(sponsorDetails({ sponsor: { name: "  Sponsor  ", logoKey } }, org, competition)).toEqual(
      { name: "Sponsor", logoUrl: null },
    );
  const logoKey = `org/${org}/competition/${competition}/${newId()}.png`;
  const result = sponsorDetails(
    { sponsor: { name: "Sponsor", logoKey, phone: "private" } },
    org,
    competition,
  );
  expect(result?.logoUrl).toBeTruthy();
  expect(Object.keys(result ?? {})).toEqual(["name", "logoUrl"]);
  expect(sponsorDetails({ sponsor: { name: " \u0000 " } }, org, competition)).toBeNull();
  expect(
    sponsorDetails({ sponsor: { name: "a".repeat(130) } }, org, competition)?.name,
  ).toHaveLength(120);
});
