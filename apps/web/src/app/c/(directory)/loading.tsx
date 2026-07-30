import { Skeleton } from "@desiauction/ui";

import { DIRECTORY_DESCRIPTION, DIRECTORY_KICKER } from "./copy";
import "../../marketing.css";
import "../directory.css";

/**
 * The directory is an async server component doing two database round-trips, so
 * every search, facet and sort was a full navigation with a blank interval and
 * nothing to look at. This holds the shape of the page — head, controls, a grid
 * of cards — so the layout does not jump when the rows land.
 *
 * The `(directory)` route group exists ONLY to hold this file. A `loading.tsx`
 * boundary covers its segment AND every segment below it, so the obvious
 * `app/c/loading.tsx` also wraps `/c/[slug]` — and a Suspense boundary above a
 * gate commits a 200 before the gate runs, so an unpublished competition
 * started answering 200 instead of 404 (measured; it is the same trap PX-2
 * hit with a root `loading.tsx`). The group has no URL segment of its own, so
 * `/c` is unchanged and `/c/[slug]` keeps its real HTTP status.
 */
export default function DirectoryLoading() {
  return (
    <main className="public-page mk">
      <header className="public-hero public-head" data-theme="floodlight">
        <div className="mk-container public-hero-inner">
          <p className="mk-kicker">{DIRECTORY_KICKER}</p>
          <h1>Tournaments</h1>
          <p className="public-sub">{DIRECTORY_DESCRIPTION}</p>
          <div className="public-controls public-controls-loading">
            <Skeleton height="44px" style={{ borderRadius: "var(--radius-md)" }} />
            <Skeleton height="32px" width="60%" style={{ borderRadius: "var(--radius-full)" }} />
          </div>
        </div>
      </header>
      <div className="public-body">
        <div className="mk-container">
          <div className="public-results">
            <p className="public-count" role="status">
              Loading tournaments…
            </p>
            <div className="public-grid">
              {[0, 1, 2, 3, 4, 5].map((slot) => (
                <Skeleton key={slot} height="196px" style={{ borderRadius: "var(--radius-2xl)" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
