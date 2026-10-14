import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import { currentSession } from "../../../server/auth/actions";
import { QuickMatchForm } from "./quick-match-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quick match", robots: { index: false, follow: false } };
export default async function QuickMatchPage() {
  if (!(await currentSession())) redirect("/login?next=%2Fscore%2Fnew");
  return (
    <QuickMatchForm
      formats={Object.values(FORMAT_PRESETS).map((format) => ({
        key: format.key,
        label: format.label,
        playersPerSide: format.playersPerSide,
      }))}
    />
  );
}
