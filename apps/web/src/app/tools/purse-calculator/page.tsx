import type { Metadata } from "next";

import { requireToolPage } from "../../../content/tools";
import { ToolShell, toolMetadata } from "../tool-shell";
import { PurseCalculator } from "./calculator";
import "../../content.css";
import "../../marketing.css";
import "../../sports/sports.css";
import "../tools.css";

const page = requireToolPage("purse-calculator");

export const metadata: Metadata = toolMetadata(page);

/** `/tools/purse-calculator` (SEO-1 Phase 4d). */
export default function PurseCalculatorPage() {
  return (
    <ToolShell page={page}>
      <PurseCalculator />
    </ToolShell>
  );
}
