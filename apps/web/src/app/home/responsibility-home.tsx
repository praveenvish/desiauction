import { ButtonLink, IconCalendar, IconRupee, IconShieldCheck, SectionCard } from "@desiauction/ui";
import { formatDateTime } from "../../lib/format-date";
import { parseIstLocal } from "../../lib/ist-time";
import type { HomeTask } from "../../lib/home-tasks";
import type { HomeResponsibilities } from "../../server/home/responsibilities";

function TaskRows({ tasks }: { tasks: readonly HomeTask[] }) {
  return (
    <ul className="home-responsibility-tasks">
      {tasks.map((task) => (
        <li key={task.id} data-task={task.id} data-state={task.state}>
          <div>
            <p className="home-responsibility-context">{task.context}</p>
            <h3>{task.title}</h3>
            <p>{task.explanation}</p>
            {task.dueAt && (
              <p className="home-responsibility-time">
                Scheduled · {formatDateTime(parseIstLocal(task.dueAt.slice(0, 16)) ?? task.dueAt)}{" "}
                IST
              </p>
            )}
          </div>
          <ButtonLink href={task.href} variant="secondary" size="touch">
            {task.action}
          </ButtonLink>
        </li>
      ))}
    </ul>
  );
}

export function ResponsibilityHome({
  responsibilities,
}: {
  responsibilities: HomeResponsibilities;
}) {
  const { tasks } = responsibilities;
  const live = tasks.filter((task) =>
    ["conduct-live", "score-held", "owner-live"].includes(task.priority),
  );
  const matchDay = tasks.filter((task) => ["score", "lineup", "confirm"].includes(task.kind));
  const finance = tasks.filter((task) => ["finance", "receipt"].includes(task.kind));
  const platform = tasks.filter((task) => task.kind === "operator");
  return (
    <>
      {live.length > 1 && (
        <SectionCard
          title="More than one live responsibility"
          description="Choose the exact match, team or auction. Opening one keeps the other duties available."
          icon={<IconCalendar />}
          data-testid="home-live-choices"
        >
          <TaskRows tasks={live} />
        </SectionCard>
      )}
      {(responsibilities.scorer || responsibilities.manager || matchDay.length > 0) && (
        <SectionCard
          title="Your match-day work"
          description="Your available matches and result requests, with the next step for each."
          icon={<IconCalendar />}
          data-testid="home-match-responsibilities"
        >
          {matchDay.length > 0 ? (
            <TaskRows tasks={matchDay} />
          ) : (
            <p>
              No match is on your current scoring list. Check your schedule and recent notices for
              what comes next.
            </p>
          )}
          <div className="home-responsibility-returns">
            <ButtonLink href="/score" variant="ghost" size="touch">
              Open scoring list
            </ButtonLink>
            <ButtonLink href="/inbox" variant="ghost" size="touch">
              All result requests and notices
            </ButtonLink>
          </div>
          {responsibilities.manager && (
            <p className="home-card-note">
              Result requests here cover recent notices. Older requests remain in Notifications.
            </p>
          )}
        </SectionCard>
      )}
      {(responsibilities.finance || responsibilities.hasDocuments) && (
        <SectionCard
          title="Your money and documents"
          description="Review your recorded cases, invoices and receipts. Each workspace shows the actions available to you."
          icon={<IconRupee />}
          data-testid="home-finance-responsibilities"
        >
          {finance.length > 0 ? (
            <TaskRows tasks={finance} />
          ) : (
            <p>
              No organisation desk is available through your current membership and permissions.
              Open My money for your permitted documents and status.
            </p>
          )}
          <ButtonLink href="/money" variant="ghost" size="touch">
            Open My money
          </ButtonLink>
        </SectionCard>
      )}
      {responsibilities.operator && (
        <SectionCard
          title="Your platform work"
          description="Open your assigned workspace."
          icon={<IconShieldCheck />}
          data-testid="home-platform-responsibilities"
        >
          <TaskRows tasks={platform} />
        </SectionCard>
      )}
    </>
  );
}
