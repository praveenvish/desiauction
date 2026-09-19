"use client";

import { Button, Card, Dialog, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  announceAppointmentsAction,
  type AppointmentsPanelView,
} from "../../../../server/competition/appointment-actions";

/**
 * ANNOUNCE CAPTAINS & ICONS.
 *
 * The roles are toggles set while squads are built; nobody hears about them
 * until the organizer says so here — once, and only the names not already told.
 */
export function AppointmentsPanel({ slug, view }: { slug: string; view: AppointmentsPanelView }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = view.pending.length;

  const announce = async () => {
    setBusy(true);
    const result = await announceAppointmentsAction(slug);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    toast({
      title:
        result.told === 0
          ? "Everyone named has already been told."
          : `Told ${String(result.told)} ${result.told === 1 ? "person" : "people"}.`,
      tone: "success",
    });
    router.refresh();
  };

  return (
    <Card data-testid="appointments-panel">
      <h2>Announce captains &amp; icons</h2>
      {count === 0 ? (
        <p className="competitions-hint" data-testid="appointments-none">
          {view.told > 0
            ? `Everyone named has been told (${String(view.told)}). Name someone new on a team's roster and they'll appear here.`
            : "Name captains, vice-captains, icons and retained players on a team's roster, then announce them here — nobody is told until you do."}
        </p>
      ) : (
        <>
          <p className="competitions-hint">
            {count === 1 ? "One person is" : `${String(count)} people are`} named but not told yet.{" "}
            {count === 1 ? "They'll get" : "Each gets"} a message in their inbox, and an email if
            they have a verified address.
            {view.told > 0 ? ` ${String(view.told)} already told.` : ""}
          </p>
          <ul className="appointments-list" data-testid="appointments-pending">
            {view.pending.map((item) => (
              <li key={`${item.name}-${item.role}-${item.team}`}>
                <span className="registration-name">{item.name}</span>
                <span className="competitions-hint">
                  {item.role} · {item.team}
                </span>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
            data-testid="appointments-announce"
          >
            Announce to {count === 1 ? "1 person" : `${String(count)} people`}
          </Button>
        </>
      )}
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Announce these appointments?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Not yet
            </Button>
            <Button
              onClick={() => void announce()}
              loading={busy}
              data-testid="appointments-confirm"
            >
              Announce
            </Button>
          </>
        }
      >
        <p className="competitions-hint">
          {count === 1 ? "This person" : `These ${String(count)} people`} will be told now. A
          message can&apos;t be taken back — if you change a role later, the new one is announced
          next time.
        </p>
      </Dialog>
    </Card>
  );
}
