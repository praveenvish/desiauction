import {
  ButtonLink,
  IconAlert,
  IconArrowRight,
  IconBroadcast,
  IconSpark,
  IconTile,
} from "@desiauction/ui";

import { FormDialog } from "../../components/form-dialog";
import { CreateOrgForm } from "../orgs/create-org-form";
import type { NextStep } from "./next-step";

/**
 * The one thing to do next. It says where this is, the single thing to do,
 * why, and what follows — the three questions every console screen has to
 * answer. For an organizer it leads the "Needs attention" card (`embedded`);
 * for everyone else it is the first card on the page.
 */
export function NextStepBanner({ step, embedded = false }: { step: NextStep; embedded?: boolean }) {
  return (
    <section
      className={`home-next home-next--${step.tone}${embedded ? " home-next--embedded" : ""}`}
      aria-labelledby="home-next-title"
      data-testid="home-next-step"
      data-step={step.key}
    >
      <IconTile
        icon={
          step.tone === "live" ? (
            <IconBroadcast />
          ) : step.tone === "action" ? (
            <IconAlert />
          ) : (
            <IconSpark />
          )
        }
        tone={step.tone === "live" ? "red" : step.tone === "action" ? "amber" : "gold"}
        size={embedded ? "md" : "lg"}
      />
      <div className="home-next-text">
        <p className="home-next-eyebrow">
          {step.tone === "live" ? <i className="home-next-dot" aria-hidden /> : null}
          {step.eyebrow}
        </p>
        {embedded ? (
          <h3 id="home-next-title" className="home-next-title">
            {step.title}
          </h3>
        ) : (
          <h2 id="home-next-title" className="home-next-title">
            {step.title}
          </h2>
        )}
        <p className="home-next-why">{step.why}</p>
      </div>
      <div className="home-next-actions">
        <div className="home-next-buttons">
          {step.secondary !== undefined ? (
            <ButtonLink href={step.secondary.href} variant="secondary" size="touch">
              {step.secondary.label}
            </ButtonLink>
          ) : null}
          {step.createClub === true ? (
            // The club is made in a dialog, as everywhere else. The test hook is
            // the one the old setup ladder's first rung carried.
            <FormDialog
              title="New club"
              triggerLabel={step.cta.label}
              size="touch"
              triggerTestId="home-create-org"
            >
              <CreateOrgForm />
            </FormDialog>
          ) : (
            <ButtonLink href={step.cta.href} size="touch" data-testid="home-next-cta">
              {step.cta.label}
              <IconArrowRight size={16} className="icon-trail" />
            </ButtonLink>
          )}
        </div>
        {step.then !== undefined ? <p className="home-next-then">Then: {step.then}</p> : null}
      </div>
    </section>
  );
}
