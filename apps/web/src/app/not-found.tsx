import { ButtonLink, ErrorState } from "@desiauction/ui";

import "./marketing.css";

// PX-2: branded 404 (PX-1 P-07). Copy per the content guide (05 §5); the
// frame is the `mk-` layer's centered band so a dead end still looks like
// the product.
export default function NotFound() {
  return (
    <main className="mk">
      <div className="mk-band">
        <div className="mk-container mk-center" style={{ maxWidth: 560 }}>
          <p className="mk-kicker" style={{ justifyContent: "center" }}>
            Lost ball
          </p>
          <ErrorState
            headingLevel={1}
            title="This page doesn't exist"
            description="It may have moved, or the link was mistyped."
            actions={
              <>
                <ButtonLink href="/home">Go home</ButtonLink>
                <ButtonLink href="/help" variant="secondary">
                  Get help
                </ButtonLink>
              </>
            }
          />
        </div>
      </div>
    </main>
  );
}
