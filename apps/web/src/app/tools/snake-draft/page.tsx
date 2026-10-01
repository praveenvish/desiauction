import type { Metadata } from "next";

import { requireToolPage } from "../../../content/tools";
import { ToolShell, toolMetadata } from "../tool-shell";
import { SnakeDraft } from "./draft";
import "../../content.css";
import "../../marketing.css";
import "../../sports/sports.css";
import "../tools.css";

const page = requireToolPage("snake-draft");

export const metadata: Metadata = toolMetadata(page);

/** `/tools/snake-draft` (SEO-1 Phase 4d). */
export default function SnakeDraftPage() {
  return (
    <ToolShell page={page}>
      <SnakeDraft />
    </ToolShell>
  );
}
