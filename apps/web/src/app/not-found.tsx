import { ButtonLink, ErrorState } from "@desiauction/ui";

// PX-2: branded 404 (PX-1 P-07). Copy per the content guide (05 §5).
export default function NotFound() {
  return (
    <main>
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
    </main>
  );
}
