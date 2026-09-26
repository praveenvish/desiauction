import { addDays } from "@desiauction/core";
import { IconCalendar, SectionCard } from "@desiauction/ui";
import type { ReactNode } from "react";

/**
 * AN EMPTY SCHEDULE STILL LOOKS LIKE A CALENDAR (round 2).
 *
 * Calendar and Match day used to answer "nothing here" with one short card and
 * a blank page. This draws the week the reader is looking at — seven hatched
 * days, today marked — with the one next step under it, so the page keeps the
 * shape it will have once matches exist.
 */
const WEEKDAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });

function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function EmptyWeek({
  date,
  today,
  title,
  body,
  actions,
  testId,
}: {
  /** The date the reader is on; its whole week is drawn. */
  date: string;
  today: string;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  const monday = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return (
    <SectionCard title={title} hideHeader size="feature" data-testid={testId}>
      <ol className="cal-week" aria-hidden>
        {days.map((day) => (
          <li
            key={day}
            className="cal-week-day"
            data-today={day === today ? "true" : undefined}
            data-focus={day === date ? "true" : undefined}
          >
            <span className="cal-week-name">{WEEKDAY.format(new Date(`${day}T00:00:00Z`))}</span>
            <span className="cal-week-num">{Number(day.slice(8, 10))}</span>
          </li>
        ))}
      </ol>
      <div className="st-empty cal-week-empty">
        <span className="st-empty-glyph" aria-hidden>
          <IconCalendar size={24} weight="duotone" />
        </span>
        <h3>{title}</h3>
        <p>{body}</p>
        {actions !== undefined ? <div className="st-empty-actions">{actions}</div> : null}
      </div>
    </SectionCard>
  );
}
