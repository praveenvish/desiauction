"use client";

import { Button, Dialog, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { updateOrgDescriptionAction } from "../../../server/orgs/actions";

/**
 * The About banner — the club's own words, edited in place by an owner.
 *
 * Empty until someone writes it: the platform never fabricates a description.
 * For an owner looking at a blank one, the card is a prompt to write it; for a
 * member it simply isn't there.
 */
export function AboutBanner({
  slug,
  description,
  canManage,
}: {
  slug: string;
  description: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const [busy, setBusy] = useState(false);

  // A member looking at an org with no description sees nothing — an empty
  // banner would be noise. Only an owner gets the "write one" prompt.
  if (description === null && !canManage) {
    return null;
  }

  const save = async () => {
    setBusy(true);
    const result = await updateOrgDescriptionAction(slug, draft);
    setBusy(false);
    if (result.ok) {
      toast({ title: "About updated.", tone: "success" });
      setOpen(false);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not save.", tone: "danger" });
    }
  };

  // INLINE, in the club's header line (2026-09-28): it was a dashed banner the
  // width of the page asking for a description. Written, it reads as the
  // club's one line; unwritten, an owner sees a quiet link to write it.
  return (
    <>
      <span
        className="od-about"
        data-testid="org-about"
        data-empty={description === null ? "true" : undefined}
      >
        {description !== null ? <span className="od-about-text">{description}</span> : null}
        {canManage ? (
          <button
            type="button"
            className="od-about-edit"
            onClick={() => {
              setDraft(description ?? "");
              setOpen(true);
            }}
            data-testid="edit-about"
          >
            {description !== null ? "Edit" : "Add a line about the club"}
          </button>
        ) : null}
      </span>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="About this organization"
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
            <Button onClick={() => void save()} loading={busy} data-testid="save-about">
              Save
            </Button>
          </>
        }
      >
        <label className="od-about-field">
          <span>Description</span>
          <textarea
            value={draft}
            maxLength={600}
            rows={5}
            placeholder="Community cricket club running seasonal player auctions…"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            data-testid="about-textarea"
          />
          <span className="od-about-count">{draft.length}/600</span>
        </label>
      </Dialog>
    </>
  );
}
