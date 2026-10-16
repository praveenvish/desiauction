import { expect, it } from "vitest";
import { currentTeam, type PersonRoles, type OwnedTeam } from "./roles";
const team = (slug: string, status: string): OwnedTeam => ({
  teamId: `${slug}-team`,
  teamName: slug,
  auctionId: `${slug}-auction`,
  auctionStatus: status,
  competitionSlug: slug,
  competitionName: slug,
  competitionStatus: "registration_closed",
});
const roles: PersonRoles = {
  organizes: [],
  memberOf: [],
  owns: [],
  conducts: [],
  scores: [],
  plays: false,
  operates: false,
};
it("a newer scheduled team cannot hide an older live owner responsibility", () => {
  const owns = [team("new", "scheduled"), team("older", "paused"), team("finished", "completed")];
  expect(currentTeam({ ...roles, owns })?.competitionSlug).toBe("older");
  expect(currentTeam({ ...roles, owns: [...owns].reverse() })).toEqual(
    currentTeam({ ...roles, owns }),
  );
  expect(owns[0]?.competitionSlug).toBe("new");
});
it("simultaneous live scopes retain a stable recommendation under reordered reads", () => {
  const owns = [team("z", "live"), team("a", "paused")];
  expect(currentTeam({ ...roles, owns })?.competitionSlug).toBe("a");
  expect(currentTeam({ ...roles, owns: [...owns].reverse() })?.competitionSlug).toBe("a");
});
