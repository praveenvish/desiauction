import { redirect } from "next/navigation";

/**
 * /seasons was a SECOND index over the dataset /tournaments already indexes —
 * same rows, a different vocabulary, no shared model, and both under one rail
 * slot. It was a migration artifact, not a design: the slot used to be
 * "Seasons", was renamed when the tournament layer finally got a surface, and
 * this page was simply never retired.
 *
 * Grouping is a VIEW of one dataset, not a destination, so the flat list is now
 * `/tournaments?view=seasons` — where it inherits the search, status filter,
 * sort, live results line and capability gating it never had here — and this
 * path forwards every inbound link and bookmark to it.
 *
 * ONLY the bare index moves. `/seasons/{slug}` and everything under it — the
 * season workspace, its auction, money, registrations, teams and fixtures — is
 * the product's primary work surface and is untouched by this file: a page at
 * this segment does not intercept its children.
 *
 * No session gate above the redirect on purpose. It reads nothing and renders
 * nothing, so an anonymous visitor gets the forward and then /tournaments' own
 * gate; a gate here would only add a second round-trip to the same answer.
 *
 * A 307, not a 308: the destination's shape is a product decision that may yet
 * move, and a permanent redirect is cached in browsers we cannot reach.
 */
export default function SeasonsIndexPage(): never {
  redirect("/tournaments?view=seasons");
}
