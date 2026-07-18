"use client";

import { Button, ButtonLink, ErrorState } from "@desiauction/ui";

// PX-2: branded error boundary (PX-1 P-07). The digest is the support handle;
// retry re-renders the failed segment. Copy per the content guide (05 §5).
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
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
    </main>
  );
}
