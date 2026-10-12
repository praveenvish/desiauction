"use client";
import { useState } from "react";
import { Button } from "@desiauction/ui";
import { practiceLifecycleContext } from "../../../../server/auction/practice-actions";
import type { AuctionCommands } from "./command-runtime";

type Context = NonNullable<Awaited<ReturnType<typeof practiceLifecycleContext>>>;
export function PracticeRecovery({ commands, slug }: { commands: AuctionCommands; slug: string }) {
  const [current, setCurrent] = useState<Context | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markers = commands.markers.filter(
    (item) => item.state !== "reviewed" && item.resources.includes("practice-lifecycle"),
  );
  if (commands.stopped) return <p role="alert">This account session ended. Sign in to continue.</p>;
  if (!commands.ready && !commands.error) return <p role="status">Opening practice recovery…</p>;
  if (!markers.length && !commands.error) return null;
  return (
    <section aria-label="Practice recovery" data-testid="practice-recovery">
      {commands.error ? (
        <div role="alert">
          <p>{commands.error}</p>
          <Button
            onClick={() => {
              void commands.load();
            }}
          >
            Check recovery storage
          </Button>
        </div>
      ) : null}
      {markers.map((marker) => (
        <div key={marker.commandId}>
          <p role="status">
            {commands.pending(marker.control)
              ? "Waiting for the practice answer."
              : "Practice action unconfirmed. It will not be sent again automatically."}
          </p>
          {marker.lifecycle?.ended ? (
            <p>The selected practice end is established. New practice creation is unconfirmed.</p>
          ) : null}
          <Button
            variant="secondary"
            disabled={checking || commands.pending(marker.control)}
            onClick={() => {
              setChecking(true);
              setCurrent(null);
              setError(null);
              void practiceLifecycleContext(slug, commands.auctionId)
                .then((context) => {
                  if (commands.stopped) return;
                  if (context?.personId !== commands.actorId)
                    setError("The current authorised practice could not be read.");
                  else setCurrent(context);
                })
                .catch(() => {
                  if (!commands.stopped) setError("The current practice could not be read.");
                })
                .finally(() => {
                  setChecking(false);
                });
            }}
          >
            Check current practice
          </Button>
          {current ? (
            <div>
              <p>
                Current practice:{" "}
                {current.practiceId
                  ? `${current.practiceId === marker.context["practiceId"] ? "Selected practice" : "Another practice"} · ${current.practiceStatus ?? "unknown"}`
                  : "None"}
                . Real auction: {current.realStatus}.
              </p>
              <Button
                variant="secondary"
                disabled={checking || commands.pending(marker.control)}
                onClick={() => {
                  setChecking(true);
                  void commands
                    .review(marker.commandId, async () => {
                      const fresh = await practiceLifecycleContext(slug, commands.auctionId);
                      return (
                        fresh?.personId === commands.actorId &&
                        fresh.realAuctionId === current.realAuctionId &&
                        fresh.practiceId === current.practiceId &&
                        fresh.practiceStatus === current.practiceStatus &&
                        fresh.realStatus === current.realStatus
                      );
                    })
                    .then((reviewed) => {
                      if (reviewed) setCurrent(null);
                    })
                    .finally(() => {
                      setChecking(false);
                    });
                }}
              >
                Reviewed current practice · allow a new action
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <p>
        Reviewing releases this device’s interlock. It does not prove the earlier action failed or
        prevent a late result.
      </p>
    </section>
  );
}
