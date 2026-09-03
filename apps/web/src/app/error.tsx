"use client";

import { Button, ButtonLink, ErrorState } from "@desiauction/ui";

// PX-2: branded error boundary (PX-1 P-07). The digest is the support handle;
// retry re-renders the failed segment. Copy per the content guide (05 §5).
//
// FRAMED WITHOUT A STYLESHEET, DELIBERATELY. The first cut of this fix wrapped
// the state in the `mk-` band the 404 uses, and it rendered hard against the
// top-left corner in the wild: this boundary catches failures that can include
// the CSS chunk not arriving, so a layout that DEPENDS on an imported
// stylesheet is exactly the layout that breaks when it is needed. The padding
// and centring are inline; the design-system tokens are on `:root` and cost
// nothing if they are missing.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "clamp(48px, 10vh, 128px) 24px",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%" }}>
        <ErrorState
          headingLevel={1}
          title="Something broke on our side"
          description={
            error.digest !== undefined
              ? `You didn't lose anything. If this keeps happening, tell support the code ${error.digest}.`
              : "You didn't lose anything — try again."
          }
          actions={
            <>
              <Button
                onClick={() => {
                  reset();
                }}
              >
                Try again
              </Button>
              <ButtonLink href="/home" variant="secondary">
                Go home
              </ButtonLink>
              <ButtonLink href="/contact" variant="ghost">
                Contact support
              </ButtonLink>
            </>
          }
        />
      </div>
    </main>
  );
}
