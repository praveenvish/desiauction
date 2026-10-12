import type { ReactNode } from "react";

// HomePage checks session and name before loading roles, retaining its query intent.
// Any future child route must own an equivalent gate before reading private data.
export default function HomeLayout({ children }: { children: ReactNode }) {
  return children;
}
