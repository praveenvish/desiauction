import type { DayRow } from "../../../../server/admin/delivery-analytics-views";

/**
 * The daily trend, drawn on the server as plain SVG — no chart library, no
 * client script. One stacked bar per India day: sent at the base, then
 * suppressed, then failed on top, so a bad day reads as a red cap.
 *
 * The picture is `role="img"` with a one-sentence summary; the numbers
 * themselves are the table in the <details> under it, which is what a screen
 * reader (or anybody who wants the exact figure) should read instead.
 */

const HEIGHT = 100;
const BAR = 8;
const GAP = 2;

export function TrendChart({ days, windowDays }: { days: readonly DayRow[]; windowDays: number }) {
  const max = Math.max(1, ...days.map((d) => d.sent + d.failed + d.suppressed));
  const width = days.length * (BAR + GAP);
  const total = days.reduce(
    (acc, d) => ({
      sent: acc.sent + d.sent,
      failed: acc.failed + d.failed,
      suppressed: acc.suppressed + d.suppressed,
    }),
    { sent: 0, failed: 0, suppressed: 0 },
  );
  const peak = days.reduce<DayRow | null>(
    (best, d) =>
      best === null || d.sent + d.failed + d.suppressed > best.sent + best.failed + best.suppressed
        ? d
        : best,
    null,
  );
  const summary = `${String(windowDays)} days: ${String(total.sent)} sent, ${String(total.suppressed)} suppressed, ${String(total.failed)} failed${
    peak === null || max <= 1 ? "" : `; busiest day ${peak.day}`
  }.`;
  const scale = (n: number) => (n / max) * HEIGHT;
  return (
    <div className="dla-trend" data-testid="analytics-trend">
      <svg
        viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby="analytics-trend-title"
      >
        <title id="analytics-trend-title">{summary}</title>
        {days.map((d, i) => {
          const x = i * (BAR + GAP);
          const sent = scale(d.sent);
          const suppressed = scale(d.suppressed);
          const failed = scale(d.failed);
          return (
            <g key={d.day}>
              <rect className="dla-bar-sent" x={x} y={HEIGHT - sent} width={BAR} height={sent} />
              <rect
                className="dla-bar-suppressed"
                x={x}
                y={HEIGHT - sent - suppressed}
                width={BAR}
                height={suppressed}
              />
              <rect
                className="dla-bar-failed"
                x={x}
                y={HEIGHT - sent - suppressed - failed}
                width={BAR}
                height={failed}
              />
            </g>
          );
        })}
      </svg>
      <ul className="dla-legend" aria-hidden>
        <li>
          <span className="dla-swatch dla-bar-sent" />
          Sent
        </li>
        <li>
          <span className="dla-swatch dla-bar-suppressed" />
          Suppressed
        </li>
        <li>
          <span className="dla-swatch dla-bar-failed" />
          Failed
        </li>
      </ul>
      <details>
        <summary>Show the numbers by day</summary>
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="analytics-trend-table">
            <caption className="admin-sr-only">Queued messages by day, India time</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sent</th>
                <th scope="col">Suppressed</th>
                <th scope="col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row" data-label="Day">
                    {d.day}
                  </th>
                  <td data-label="Sent" className="admin-num">
                    {String(d.sent)}
                  </td>
                  <td data-label="Suppressed" className="admin-num">
                    {String(d.suppressed)}
                  </td>
                  <td data-label="Failed" className="admin-num">
                    {String(d.failed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
