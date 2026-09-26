import {
  IconCheckCircle,
  IconCircle,
  IconClock,
  IconMinusCircle,
  IconPause,
  IconXCircle,
} from "@desiauction/ui";
import type { ReactNode } from "react";

import "./registration-status-glyph.css";

/**
 * A registration's status as a SHAPE as well as a colour (round 3C). A phone
 * list row has no width for the word, and a coloured dot alone told a
 * colour-blind organizer nothing: approved is a tick, submitted a clock,
 * waitlisted a pause, declined a cross, withdrawn a minus. Decorative — the
 * pill beside it keeps the word for assistive tech; CSS shows one or the other.
 */
const GLYPH: Record<string, ReactNode> = {
  approved: <IconCheckCircle size={16} weight="fill" />,
  submitted: <IconClock size={16} weight="fill" />,
  waitlisted: <IconPause size={16} weight="fill" />,
  rejected: <IconXCircle size={16} weight="fill" />,
  withdrawn: <IconMinusCircle size={16} weight="fill" />,
};

export function RegistrationStatusGlyph({ status }: { status: string }) {
  return (
    <span className="reg-glyph" data-status={status} aria-hidden>
      {GLYPH[status] ?? <IconCircle size={16} />}
    </span>
  );
}
