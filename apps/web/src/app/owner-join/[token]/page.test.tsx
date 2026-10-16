import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  landing: vi.fn(),
  accept: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../server/auth/actions", () => ({
  currentSession: mocks.session,
  logoutToAction: vi.fn(),
}));
vi.mock("../../../server/auction/owner-actions", () => ({
  ownerJoinLandingView: mocks.landing,
  acceptOwnerJoin: mocks.accept,
}));
import OwnerJoinPage from "./page";

function acceptance(node: ReactNode): (() => Promise<void>) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; action?: () => Promise<void> }>(child)) continue;
    if (child.type === "form" && child.props.action) return child.props.action;
    if (typeof child.type === "function" && child.type.name === "ValidOwnerInvite") {
      const render = child.type as (props: {
        children?: ReactNode;
        action?: () => Promise<void>;
      }) => ReactNode;
      const action = acceptance(render(child.props));
      if (action) return action;
    }
    const action = acceptance(child.props.children);
    if (action) return action;
  }
  return undefined;
}
const token = "owned-invitation";
async function page(review?: string | string[]) {
  return OwnerJoinPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve(review === undefined ? {} : { review }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ personId: "actor" });
  mocks.landing.mockResolvedValue({
    viewerLabel: "Current actor",
    landing: {
      state: "valid",
      preview: {
        teamName: "Royals",
        auctionName: "Season Auction",
        competitionName: "Season",
        orgName: "Club",
        auctionStatus: "scheduled",
        pursePerTeam: 10000,
        auctionUnit: "INR",
        squadMax: 10,
        expiresAt: "2099-01-01T00:00:00.000Z",
        invitedByName: "Organizer",
      },
    },
  });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error("redirect:" + url);
  });
});
describe("owner invitation outcome recovery", () => {
  it("reads authoritative state after an unconfirmed answer without submitting acceptance again", async () => {
    mocks.accept.mockResolvedValue({ ok: false });
    const action = acceptance(await page());
    expect(action).toBeDefined();
    await expect(action?.()).rejects.toThrow("redirect:/owner-join/owned-invitation?review=1");
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(token);
    const html = renderToStaticMarkup(await page("1"));
    expect(html).toContain("confirm the outcome");
    expect(html).toContain("before repeating an action");
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(html).not.toContain("acceptance failed");
  });
  it("preserves the successful room redirect", async () => {
    mocks.accept.mockResolvedValue({ ok: true, competitionSlug: "season" });
    await expect(acceptance(await page())?.()).rejects.toThrow(
      "redirect:/seasons/season/auction/live",
    );
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(token);
  });
  it("keeps invalid reasons indistinguishable and accepts only one explicit review marker", async () => {
    mocks.landing.mockResolvedValue({
      viewerLabel: "Current actor",
      landing: { state: "invalid" },
    });
    const html = renderToStaticMarkup(await page("1"));
    expect(html).toContain("This invitation is no longer valid");
    expect(html).toContain("confirm the outcome");
    expect(renderToStaticMarkup(await page(["1", "1"]))).not.toContain("confirm the outcome");
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("an expired session returns to login before reading or submitting the invitation", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(page("1")).rejects.toThrow("redirect:/login?next=/owner-join/owned-invitation");
    expect(mocks.landing).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
