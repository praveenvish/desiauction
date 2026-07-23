import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { auctionIndex } from "../../server/home/workspace";
import "../workspace.css";

export const metadata = { title: "Auctions · DesiAuction" };

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

function tone(status: string): "success" | "info" | "neutral" {
  if (status === "live") return "success";
  if (status === "scheduled") return "info";
  return "neutral";
}

export default async function AuctionsPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/auctions");
  }
  const rows = await auctionIndex();
  return (
    <main className="ws">
      <PageHeader title="Auctions" subtitle="Every auction across your competitions." />
      <Card padding={rows.length === 0 ? "default" : "dense"}>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No auctions yet"
            description="Close registration on a competition, then create its auction."
            action={<ButtonLink href="/competitions">Open competitions</ButtonLink>}
          />
        ) : (
          <ul className="ws-list" data-testid="auctions-list">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/competitions/${row.competitionSlug}/auction`} className="ws-row">
                  <span className="ws-crest" aria-hidden>
                    {initials(row.competitionName)}
                  </span>
                  <span className="ws-text">
                    <strong>{row.competitionName}</strong>
                    <span>{row.name}</span>
                  </span>
                  <span className="ws-tags">
                    <Badge tone={tone(row.status)}>{row.status}</Badge>
                  </span>
                  <span className="ws-meta">
                    <span className="ws-stat">
                      <b>
                        {row.lotsSold}/{row.lotsTotal}
                      </b>
                      <span>Lots</span>
                    </span>
                    <span className="ws-stat">
                      <b>{formatPaiseINR(paise(row.spendPaise))}</b>
                      <span>Spend</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
