"use client";

import { Button, Card, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { issueCorrectionAction } from "../../../../../../server/financial-operations/actions";

/**
 * THE ONLY WAY TO REPAIR A WRONG DOCUMENT.
 *
 * `issueCorrectionAction` has existed, complete and validated, with zero
 * callers anywhere in the product. So a receipt issued against the wrong
 * payment, or for an amount settlement later compensated, was permanent: the
 * document register is append-only by design, nothing may edit an issued
 * document, and the one command that compensates one had no button.
 *
 * A correction never alters the original. It is a NEW document that quotes the
 * settlement event which compensates the old one, and links back — which is why
 * the operator supplies an event number rather than an amount. Finance quotes
 * settlement; it does not decide money, and it must not start here.
 *
 * The cause STREAM is not asked for. The platform requires it to match the
 * stream the original document already stands on, so asking would offer the
 * operator a choice with exactly one correct answer and several ways to get it
 * wrong; it is parsed from the document's own `sourceRef`.
 */
export function CorrectionForm({
  slug,
  docId,
  sourceRef,
  series,
  canDocument,
  isCorrection,
}: {
  slug: string;
  docId: string;
  sourceRef: string | null;
  series: readonly { id: string; label: string }[];
  canDocument: boolean;
  isCorrection: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [seriesId, setSeriesId] = useState(series[0]?.id ?? "");
  const [causeSeq, setCauseSeq] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // `payment:01ABC…:` — the stream this document was made from.
  const parts = (sourceRef ?? "").split(":");
  const causeStreamType = parts[0] ?? "";
  const causeStreamId = parts[1] ?? "";
  const quotable = causeStreamType === "payment" || causeStreamType === "case";

  if (isCorrection) {
    /*
     * Corrections chain to source documents, never to each other — the platform
     * refuses `corrects_invalid`. Saying so beats offering a form that always
     * fails: a second compensation quotes a second settlement cause against the
     * ORIGINAL, which is where the operator needs to be.
     */
    return (
      <Card>
        <h2>Corrections</h2>
        <p className="section-note">
          This document is itself a correction. A further correction quotes the original document,
          not this one — open the document it corrects.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2>Corrections</h2>
      <p className="section-note">
        An issued document is never edited. If settlement has compensated this one — a refund, an
        adjustment — a correction is a new document that quotes that event and links back to this
        one. The original stays exactly as it was issued.
      </p>
      {!canDocument ? (
        <p className="section-note" data-testid="correction-needs-permission">
          Issuing documents needs the document permission.
        </p>
      ) : series.length === 0 ? (
        <p className="section-note" data-testid="correction-needs-series">
          There is no open correction series. Open one on the money desk before correcting a
          document — corrections are numbered, like every other document.
        </p>
      ) : !quotable ? (
        <p className="section-note" data-testid="correction-no-source">
          This document does not name the settlement stream it was made from, so there is nothing
          for a correction to quote.
        </p>
      ) : !open ? (
        <Button
          variant="secondary"
          size="touch"
          onClick={() => {
            setOpen(true);
          }}
          data-testid="open-correction"
        >
          Issue a correction
        </Button>
      ) : (
        <div className="authority-form" data-testid="correction-form">
          {series.length > 1 ? (
            <Select
              label="Correction series"
              value={seriesId}
              onChange={(event) => {
                setSeriesId(event.target.value);
              }}
              data-testid="correction-series"
            >
              {series.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Field
            label="Settlement event number"
            name="causeSeq"
            inputMode="numeric"
            value={causeSeq}
            help={`The event in ${causeStreamType} …${causeStreamId.slice(-8)} that compensates this document. The platform checks it, and refuses if it does not.`}
            onChange={(event) => {
              setCauseSeq(event.target.value);
            }}
            data-testid="correction-seq"
          />
          <Field
            label="Reason"
            name="reason"
            value={reason}
            help="Goes on the correction itself, permanently."
            onChange={(event) => {
              setReason(event.target.value);
            }}
            data-testid="correction-reason"
          />
          <div className="date-row">
            <Button
              variant="secondary"
              size="touch"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="touch"
              loading={busy}
              data-testid="correction-submit"
              onClick={() => {
                setBusy(true);
                void issueCorrectionAction(slug, {
                  seriesId: seriesId === "" ? (series[0]?.id ?? "") : seriesId,
                  correctsDocId: docId,
                  causeStreamType,
                  causeStreamId,
                  causeSeq,
                  reason,
                }).then((result) => {
                  setBusy(false);
                  if (result.ok) {
                    toast({ tone: "success", title: "Correction issued." });
                    setOpen(false);
                    router.refresh();
                  } else {
                    // The platform's own refusal, verbatim. Its reasons are
                    // specific — the cause does not compensate this party, the
                    // event number is not quotable — and replacing them with
                    // "Could not issue" would throw away the only information
                    // that tells an operator what to do next.
                    toast({ tone: "danger", title: result.error });
                  }
                });
              }}
            >
              Issue correction
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
