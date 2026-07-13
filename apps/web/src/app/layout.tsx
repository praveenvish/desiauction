import "@desiauction/ui/styles/fonts.css";
import "@desiauction/ui/styles/primitives.css";
import "@desiauction/ui/styles/floodlight.css";
import "@desiauction/ui/styles/daylight.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DesiAuction",
  description: "Tournament auctions, taken seriously.",
};

// Console default is Daylight; live surfaces pin floodlight per C-4 (doc 18).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="daylight">
      <body>{children}</body>
    </html>
  );
}
