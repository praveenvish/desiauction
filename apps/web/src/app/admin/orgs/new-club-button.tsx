"use client";

import { Button, Dialog, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useStepUp, type GatedResult } from "../../../components/admin/use-step-up";
import { createClubAction } from "../../../server/platform-ops/club-actions";

/*
 * NEW CLUB from the platform's club list (superadmin). You become its owner,
 * as any organizer would; hand it over from the club's page with "Transfer
 * ownership" once the real owner has signed in.
 */
export function NewClubButton() {
  const router = useRouter();
  const toast = useToast();
  const { run, dialog: stepUpDialog } = useStepUp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();

  const submit = () => {
    start(async () => {
      let slug: string | undefined;
      let message = "";
      let result: GatedResult;
      try {
        result = await run(async (): Promise<GatedResult> => {
          const outcome = await createClubAction({ name, reason });
          if (outcome.ok) {
            slug = outcome.slug;
            message = outcome.message;
            return { ok: true };
          }
          return outcome;
        });
      } catch {
        toast({
          title: "We couldn't reach DesiAuction. Reload the page to see what changed.",
          tone: "danger",
        });
        return;
      }
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      setOpen(false);
      toast({ title: message, tone: "success" });
      router.push(slug === undefined ? "/admin/orgs" : `/admin/orgs/${slug}`);
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setName("");
          setReason("");
          setOpen(true);
        }}
        data-testid="admin-new-club"
      >
        New club
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="New club"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={busy}
              disabled={name.trim().length < 3 || reason.trim().length < 10}
              data-testid="admin-new-club-confirm"
            >
              Create club
            </Button>
          </>
        }
      >
        <Field
          label="Club name"
          name="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="e.g. Malad Cricket Club"
          help="The club's real name, not this year's league. You'll be its owner; transfer ownership from the club's page."
          data-testid="admin-new-club-name"
        />
        <Field
          label="Reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          help="Written to the club's history. 10–500 characters."
          data-testid="admin-new-club-reason"
        />
      </Dialog>
      {stepUpDialog}
    </>
  );
}
