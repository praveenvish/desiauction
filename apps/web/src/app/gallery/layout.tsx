import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "../../env";

// PX-2: the gallery is an internal design-system surface — structurally absent
// outside development, same pattern as /dev/inbox (PRA-1 finding, PX-1 01 §2.5).
export default function GalleryLayout({ children }: { children: ReactNode }) {
  if (env.NODE_ENV !== "development") {
    notFound();
  }
  return <>{children}</>;
}
