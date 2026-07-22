"use client";

import { Button, ImageUploader, useToast, type UploadOutcome } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import {
  attachMedia,
  removePlayerPhoto,
  requestMediaUpload,
} from "../../../../server/media/actions";

/**
 * Organizer player-photo upload (parity §3.1). Same three-step flow as the team
 * crest — presign → PUT → attach — for subject "player" (subjectId is the
 * registration id; the photo lands person-level with attestation consent, DPDP
 * §5). Refreshes so the photo appears in the table and downstream board/showcase.
 */
export function PlayerPhotoUploader({
  slug,
  registrationId,
  playerName,
  currentUrl,
}: {
  slug: string;
  registrationId: string;
  playerName: string;
  currentUrl?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);

  async function onRemove() {
    setRemoving(true);
    const result = await removePlayerPhoto({ slug, registrationId });
    setRemoving(false);
    if (result.ok) {
      toast({ title: "Photo removed", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  }

  async function onUpload(file: File): Promise<UploadOutcome> {
    const outcome = await runMediaUpload(
      file,
      (i) => requestMediaUpload({ slug, subject: "player", subjectId: registrationId, ...i }),
      (key) => attachMedia({ slug, subject: "player", subjectId: registrationId, key }),
    );
    if (outcome.ok) {
      router.refresh();
    }
    return outcome;
  }

  return (
    <div className="player-photo-control">
      <ImageUploader
        label="Player photo"
        name={playerName}
        seed={registrationId}
        size="lg"
        shape="round"
        onUpload={onUpload}
        {...(currentUrl !== undefined ? { currentUrl } : {})}
      />
      {currentUrl !== undefined ? (
        <Button variant="ghost" size="sm" onClick={() => void onRemove()} disabled={removing}>
          {removing ? "Removing…" : "Remove photo (withdraw consent)"}
        </Button>
      ) : null}
    </div>
  );
}
