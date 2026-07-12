import { env } from "../env";

// The E2E smoke target (IP-0_DESIGN §22): proves the app boots, reads config,
// and renders. Real surfaces begin in IP-3 on the IP-1 design system.
export default function FoundationPage() {
  return (
    <main>
      <h1>DesiAuction NEXT</h1>
      <p>
        Engineering foundation · version <code data-testid="app-version">{env.APP_VERSION}</code>
      </p>
    </main>
  );
}
