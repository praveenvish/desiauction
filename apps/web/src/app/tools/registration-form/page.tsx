import type { Metadata } from "next";

import { requireToolPage } from "../../../content/tools";
import { ToolShell, toolMetadata } from "../tool-shell";
import { RegistrationTemplate } from "./form-template";
import "../../content.css";
import "../../marketing.css";
import "../../sports/sports.css";
import "../tools.css";

const page = requireToolPage("registration-form");

export const metadata: Metadata = toolMetadata(page);

/** `/tools/registration-form` (SEO-1 Phase 4d). */
export default function RegistrationFormPage() {
  return (
    <ToolShell page={page}>
      <RegistrationTemplate />
    </ToolShell>
  );
}
