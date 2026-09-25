"use client";

/**
 * THE BOUNDARY BELOW THE ROOT LAYOUT'S FLOOR.
 *
 * `error.tsx` sits INSIDE the root layout, so it cannot catch the layout
 * itself failing — and without this file Next rendered its own unstyled
 * default page for exactly that case, on every route at once. The layout now
 * degrades its own reads to the signed-out shell, so reaching here means
 * something failed that no read guard covers.
 *
 * It replaces the root layout when it renders, so it writes its own <html> and
 * <body> — and it imports nothing it could fail to load: no design-system
 * components, no stylesheet, no fonts. Every style is inline, in the product's
 * colours as literal values, because the tokens on `:root` come from the
 * stylesheets this page cannot assume arrived. Copy matches `error.tsx`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const link = {
    display: "inline-block",
    padding: "10px 18px",
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 15,
    textDecoration: "none",
    border: "1px solid #d6d3c9",
    color: "#1c1b17",
    background: "transparent",
  } as const;
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#faf8f2",
          color: "#1c1b17",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <main
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "clamp(48px, 10vh, 128px) 24px",
          }}
        >
          <div style={{ maxWidth: 560, width: "100%" }}>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "0 0 12px" }}>
              Something broke on our side
            </h1>
            <p style={{ fontSize: 16, lineHeight: 1.5, margin: "0 0 24px", color: "#4a4840" }}>
              {error.digest !== undefined
                ? `You didn't lose anything. If this keeps happening, tell support the code ${error.digest}.`
                : "You didn't lose anything — try again."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  reset();
                }}
                style={{
                  ...link,
                  cursor: "pointer",
                  background: "#1c1b17",
                  color: "#faf8f2",
                  borderColor: "#1c1b17",
                  font: "inherit",
                  fontWeight: 600,
                }}
              >
                Try again
              </button>
              {/* Plain anchors, not next/link: a full navigation is the point
                  when the app shell itself is what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/home" style={link}>
                Go home
              </a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/support" style={link}>
                Contact support
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
