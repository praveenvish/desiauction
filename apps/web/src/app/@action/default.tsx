/**
 * THE SLOT'S ANSWER FOR EVERY ROUTE THAT HAS NO PRIMARY ACTION.
 *
 * `@action` is a parallel route: the router resolves it alongside `children`
 * and hands both to the root layout, so a page's primary action is part of the
 * SERVER render of the shell rather than something published into it after
 * hydration. Next needs a `default` for the segments the slot does not match —
 * without one, a soft navigation to an actionless route would keep the previous
 * route's action on screen.
 *
 * Most of the product is here. Only /home, /orgs and /tournaments carry an
 * action, and each of those has its own page under this slot.
 */
export default function NoAction() {
  return null;
}
