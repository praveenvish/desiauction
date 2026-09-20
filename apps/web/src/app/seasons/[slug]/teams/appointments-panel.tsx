"use client";

import {
  Button,
  Dialog,
  IconMail,
  IconMegaphone,
  IconSend,
  Pill,
  PlayerImage,
  SectionCard,
  TeamChip,
  useToast,
  type KitTone,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  announceAppointmentsAction,
  type AppointmentsPanelView,
} from "../../../../server/competition/appointment-actions";

/** The mockup's role colours: an icon is amber, a captain blue. */
const ROLE_TONE: Record<string, KitTone> = {
  captain: "blue",
  vice_captain: "blue",
  icon: "amber",
  retained: "purple",
};

/**
 * ANNOUNCE CAPTAINS & ICONS.
 *
 * The roles are toggles set while squads are built; nobody hears about them
 * until the organizer says so here — once, and only the names not already told.
 * Announcing is ALL-OR-NOTHING by design (`announceAppointments`): the table
 * shows who will hear and who already has, and there is no per-row send.
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

  const people = count === 1 ? "1 person" : `${String(count)} people`;
  return (
    <>
      <SectionCard
        data-testid="appointments-panel"
        flush
        icon={<IconMegaphone />}
        tone="amber"
        title="Announce captains & icons"
        description={
          count === 0 ? (
            <span data-testid="appointments-none">
              {view.told > 0
                ? `Everyone named has been told (${String(view.told)}). Name someone new on a team's roster and they'll appear here.`
                : "Name captains, vice-captains, icons and retained players on a team's roster, then announce them here — nobody is told until you do."}
            </span>
          ) : (
            <>
              {count === 1 ? "One person is" : `${String(count)} people are`} named but not told
              yet. {count === 1 ? "They'll get" : "Each gets"} a message in their inbox, and an
              email if they have a verified address.
              {view.told > 0 ? ` ${String(view.told)} already told.` : ""}
            </>
          )
        }
      >
        {view.rows.length > 0 ? (
          <div className="table-scroll tm-announce-scroll">
            <table className="tm-announce" data-testid="appointments-pending">
              <thead>
                <tr>
                  <th className="tm-announce-num">#</th>
                  <th>Player</th>
                  <th>Role</th>
                  <th>Team</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row, index) => (
                  <tr
                    key={`${row.registrationId}-${row.team}`}
                    data-told={row.told ? "true" : undefined}
                  >
                    <td className="tm-announce-num">{index + 1}</td>
                    <td>
                      <span className="tm-announce-player">
                        <PlayerImage
                          name={row.name}
                          seed={row.registrationId}
                          src={row.photoUrl}
                          size="xs"
                          shape="round"
                          {...(row.teamColor !== null ? { teamColor: row.teamColor } : {})}
                          decorative
                        />
                        <span className="registration-name">{row.name}</span>
                      </span>
                    </td>
                    <td data-label="Role">
                      <span className="tm-announce-roles">
                        {row.roles.map((role) => (
                          <Pill key={role.key} tone={ROLE_TONE[role.key] ?? "neutral"}>
                            {role.label}
                          </Pill>
                        ))}
                      </span>
                    </td>
                    <td data-label="Team">
                      <TeamChip color={row.teamColor}>{row.team}</TeamChip>
                    </td>
                    <td data-label="Status">
                      <Pill tone={row.told ? "green" : "amber"} dot>
                        {row.told ? "Told" : "Pending"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {count > 0 ? (
          <div className="tm-announce-foot">
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(true);
              }}
              data-testid="appointments-announce"
            >
              <IconSend size={18} className="icon-lead" aria-hidden />
              Announce to {people}
            </Button>
            <p className="tm-foot-note" data-tone="info">
              <IconMail size={18} aria-hidden />
              Players will receive an inbox message and an email notification.
            </p>
          </div>
        ) : null}
      </SectionCard>
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
    </>
  );
}
