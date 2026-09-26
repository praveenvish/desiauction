import { IconCheck, VisuallyHidden } from "@desiauction/ui";

/**
 * The wizard's progress, shared by the signed-out Verify step and the signed-in
 * steps after it, so the row a visitor saw before their code is the row they
 * see after it — with the first dot ticked, not the list renumbered.
 */
export function RegStepper({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <ol className="reg-stepper" aria-label="Registration progress">
      {labels.map((label, index) => (
        <li
          key={label}
          className={`reg-stepper-item ${index === current ? "is-current" : index < current ? "is-done" : ""}`}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="reg-stepper-dot" aria-hidden>
            {index < current ? <IconCheck size={16} weight="bold" /> : index + 1}
          </span>
          <span className="reg-stepper-label">{label}</span>
          {index < current ? <VisuallyHidden>, done</VisuallyHidden> : null}
        </li>
      ))}
    </ol>
  );
}
