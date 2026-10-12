/** Compact task identity. It adds no grants, reads or live announcements. */
export function AuctionTaskContext({
  task,
  scope,
  detail,
}: {
  task: string;
  scope: string;
  detail?: string | undefined;
}) {
  return (
    <div className="auction-task-context" data-testid="auction-task-context">
      <div className="auction-task-identity">
        <strong>{task}</strong>
        <span>{scope}</span>
      </div>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}
