import type { Metadata } from "next";
import { OfflinePad } from "./offline-pad";
export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Offline scoring",
  robots: { index: false, follow: false },
};
export default function ScoringShell() {
  return <OfflinePad />;
}
