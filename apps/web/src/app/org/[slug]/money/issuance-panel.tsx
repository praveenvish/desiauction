"use client";

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Select,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  amendProfileAction,
  declareProfileAction,
  issueReceiptAction,
  openSeriesAction,
  type FinanceWorkspace,
  type FinopsResult,
} from "../../../../server/financial-operations/actions";
import { DOC_KIND_LABEL } from "../../../../server/financial-operations/register";

/**
 * PX-8 completion — the lifecycle's ENTRANCE.
 *
 * Two `finops.manage` commands dam everything downstream: without a declared
 * profile the platform refuses every issue with `profile_missing`, and without
 * an open receipt series the follower's auto-issue skips every candidate with
 * `no_open_receipt_series`. This panel opens those two gates and then gets out
 * of the way — the POLICY issues the receipts, not this screen.
 *
 * Nothing here numbers a document, decides a tax, or duplicates a rule.
 * `nextNumber` is the platform's derived projection, rendered.
 */

const POSTURE_LABEL: Record<string, string> = {
  none: "Not registered for GST",
  "gst-registered": "Registered for GST",
};

export function IssuancePanel({ slug, workspace }: { slug: string; workspace: FinanceWorkspace }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const { issuance } = workspace.board;
  const canManage = workspace.viewer.canManage;
  const canDocument = workspace.viewer.canDocument;

  const act = async (run: () => Promise<FinopsResult>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
      return true;
    }
    toast({ title: result.error, tone: "danger" });
    return false;
  };

  return (
    <>
      <ProfileCard
        slug={slug}
        profile={issuance.profile}
        fy={workspace.board.fy}
        canManage={canManage}
        busy={busy}
        act={act}
      />
      {issuance.profile !== null ? (
        <SeriesCard
          slug={slug}
          series={issuance.series}
          fy={workspace.board.fy}
          canManage={canManage}
          busy={busy}
          act={act}
        />
      ) : null}
      {issuance.profile !== null ? (
        <CandidatesCard
          slug={slug}
          issuance={issuance}
          canDocument={canDocument}
          busy={busy}
          act={act}
        />
      ) : null}
    </>
  );
}

// --- 1 · The finance profile ---------------------------------------------------------

function ProfileCard({
  slug,
  profile,
  fy,
  canManage,
  busy,
  act,
}: {
  slug: string;
  profile: FinanceWorkspace["board"]["issuance"]["profile"];
  fy: string;
  canManage: boolean;
  busy: boolean;
  act: (run: () => Promise<FinopsResult>, done: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [legalName, setLegalName] = useState(profile?.legalName ?? "");
  // The action validates the posture against the platform's own closed set;
  // this field only carries what the operator picked.
  const [posture, setPosture] = useState<string>(profile?.posture ?? "none");
  const [gstin, setGstin] = useState(profile?.gstin ?? "");
  const [autoReceipt, setAutoReceipt] = useState(profile?.autoReceipt ?? true);
  const [reason, setReason] = useState("");

  const amending = profile !== null;

  return (
    <Card data-testid="profile-card">
      <div className="competition-title-row">
        <h2>Finance profile</h2>
        {profile === null ? (
          <Badge tone="warning" data-testid="profile-status">
            not declared
          </Badge>
        ) : (
          <Badge tone="success" data-testid="profile-status">
            v{profile.version}
          </Badge>
        )}
      </div>

      {profile === null ? (
        <EmptyState
          headingLevel={3}
          title="Nothing can be issued yet"
          description="Until this organization declares who it is for finance, no receipt or invoice can be issued — the platform refuses to speak for a party it has not been told about. Declaring it opens the whole lifecycle."
        />
      ) : (
        <dl className="kv-grid" data-testid="profile-grid">
          <div>
            <dt>Legal name</dt>
            <dd data-testid="profile-name">{profile.legalName}</dd>
          </div>
          <div>
            <dt>Tax posture</dt>
            <dd>{POSTURE_LABEL[profile.posture] ?? profile.posture}</dd>
          </div>
          {profile.gstin === null ? null : (
            <div>
              <dt>GSTIN</dt>
              <dd className="digest">{profile.gstin}</dd>
            </div>
          )}
          <div>
            <dt>Auto-receipt</dt>
            {/* Plain text, not a Badge. A definition list's value is text, and
                axe measured the badge here at 4.45:1 against the 4.5 it wants —
                the badge's weight does not survive this cell's cascade. Text is
                both the accessible answer and the honest one for a <dd>. */}
            <dd data-testid="auto-receipt-state">{profile.autoReceipt ? "on" : "off"}</dd>
          </div>
        </dl>
      )}

      <p className="section-note">
        {profile?.autoReceipt === true
          ? "Auto-receipt is on: when settlement captures a payment, the platform issues its receipt by itself. Nobody has to remember."
          : "With auto-receipt on, the platform issues a receipt itself whenever settlement captures a payment. With it off, every receipt is issued by hand below."}
      </p>

      {canManage ? (
        <Button
          disabled={busy}
          onClick={() => {
            setOpen(true);
            setReason("");
          }}
          data-testid={amending ? "amend-profile" : "declare-profile"}
        >
          {amending ? "Amend profile" : "Declare finance profile"}
        </Button>
      ) : (
        <p className="section-note">Declaring the finance profile needs the manage permission.</p>
      )}

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={amending ? "Amend the finance profile" : "Declare the finance profile"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Back
            </Button>
            <Button
              disabled={busy || legalName.trim() === "" || (amending && reason.trim() === "")}
              onClick={() => {
                void act(
                  () =>
                    amending
                      ? amendProfileAction(slug, {
                          reason,
                          legalName,
                          posture,
                          gstin,
                          autoReceipt,
                        })
                      : declareProfileAction(slug, {
                          legalName,
                          posture,
                          gstin,
                          autoReceipt,
                        }),
                  amending ? "Profile amended." : "Profile declared. Finance is open for business.",
                ).then((ok) => {
                  if (ok) {
                    setOpen(false);
                  }
                });
              }}
              data-testid="submit-profile"
            >
              {amending ? "Amend profile" : "Declare profile"}
            </Button>
          </>
        }
      >
        <p className="section-note">
          This is who the organization is on every receipt and invoice it ever issues. Every
          document pins the version that was current when it was issued, so amending later never
          rewrites what was already sent.
        </p>
        <Field
          label="Legal name"
          value={legalName}
          onChange={(event) => {
            setLegalName(event.target.value);
          }}
          required
          data-testid="profile-legal-name"
        />
        <Select
          label="Tax posture"
          value={posture}
          onChange={(event) => {
            setPosture(event.target.value);
          }}
          data-testid="profile-posture"
        >
          <option value="none">Not registered for GST</option>
          <option value="gst-registered">Registered for GST</option>
        </Select>
        {posture === "gst-registered" ? (
          <Field
            label="GSTIN"
            help="The platform checks its shape and refuses a registration without one."
            value={gstin}
            onChange={(event) => {
              setGstin(event.target.value);
            }}
            required
            data-testid="profile-gstin"
          />
        ) : null}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoReceipt}
            onChange={(event) => {
              setAutoReceipt(event.target.checked);
            }}
            data-testid="profile-auto-receipt"
          />
          <span>
            Issue receipts automatically when settlement captures a payment
            <span className="section-note">
              {" "}
              — recommended: the platform does it on its own, and nothing is forgotten.
            </span>
          </span>
        </label>
        {amending ? (
          <Field
            label="Why are you amending it?"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
            data-testid="profile-reason"
          />
        ) : null}
        <p className="section-note">Fiscal year {fy}.</p>
      </Dialog>
    </Card>
  );
}

// --- 2 · Numbering series ------------------------------------------------------------

function SeriesCard({
  slug,
  series,
  fy,
  canManage,
  busy,
  act,
}: {
  slug: string;
  series: FinanceWorkspace["board"]["issuance"]["series"];
  fy: string;
  canManage: boolean;
  busy: boolean;
  act: (run: () => Promise<FinopsResult>, done: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("receipt");
  const [prefix, setPrefix] = useState("RCT");
  const [seriesFy, setSeriesFy] = useState(fy);

  const hasReceiptSeries = series.some(
    (row) => row.kind === "receipt" && row.fy === fy && row.status === "open",
  );

  return (
    <Card data-testid="series-card">
      <div className="competition-title-row">
        <h2>Numbering series</h2>
        {hasReceiptSeries ? null : (
          <Badge tone="warning" data-testid="no-receipt-series">
            no receipt series for {fy}
          </Badge>
        )}
      </div>

      {series.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="No numbering lane yet"
          description="A document needs a lane to take its number from. One lane per kind per fiscal year, forever — the platform makes that structural, so a number can never be reused."
        />
      ) : (
        <div className="table-scroll">
          <table className="money-table" data-testid="series-table">
            <caption>
              <VisuallyHidden>
                Every numbering series, with the next number it will issue
              </VisuallyHidden>
            </caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Fiscal year</th>
                <th scope="col">Prefix</th>
                <th scope="col">Issued</th>
                <th scope="col">Next number</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.seriesId} data-testid={`series-${row.kind}-${row.fy}`}>
                  <td data-label="Kind">{DOC_KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td data-label="Fiscal year">{row.fy}</td>
                  <td data-label="Prefix">
                    <span className="digest">{row.prefix}</span>
                  </td>
                  <td data-label="Issued">{row.documentCount}</td>
                  <td data-label="Next number">
                    {/* Derived by the platform. Nothing here generates a number. */}
                    <span className="digest" data-testid={`next-${row.kind}-${row.fy}`}>
                      {row.prefix}/{row.fy}/{String(row.nextNumber).padStart(6, "0")}
                    </span>
                  </td>
                  <td data-label="Status">
                    <Badge tone={row.status === "open" ? "success" : "neutral"}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!hasReceiptSeries ? (
        <p className="section-note">
          Without an open receipt series for {fy}, the platform cannot issue a receipt —
          auto-receipt will skip every captured payment until one exists.
        </p>
      ) : null}

      {canManage ? (
        <Button
          disabled={busy}
          onClick={() => {
            setOpen(true);
            setSeriesFy(fy);
          }}
          data-testid="open-series"
        >
          Open a series
        </Button>
      ) : (
        <p className="section-note">Opening a numbering series needs the manage permission.</p>
      )}

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Open a numbering series"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Back
            </Button>
            <Button
              disabled={busy || prefix.trim() === ""}
              onClick={() => {
                void act(
                  () => openSeriesAction(slug, { kind, fy: seriesFy, prefix }),
                  "Series opened.",
                ).then((ok) => {
                  if (ok) {
                    setOpen(false);
                  }
                });
              }}
              data-testid="submit-series"
            >
              Open series
            </Button>
          </>
        }
      >
        <p className="section-note">
          One lane per kind per fiscal year, and it owns that key for ever — even after it closes.
          The platform allocates every number itself, densely; a gap is treated as a halt.
        </p>
        <Select
          label="What does it number?"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPrefix(
              event.target.value === "receipt"
                ? "RCT"
                : event.target.value === "tax-invoice"
                  ? "INV"
                  : "CN",
            );
          }}
          data-testid="series-kind"
        >
          <option value="receipt">Receipts</option>
          <option value="tax-invoice">Tax invoices</option>
          <option value="correction">Corrections</option>
        </Select>
        <Field
          label="Fiscal year"
          help="Like 2026-27."
          value={seriesFy}
          onChange={(event) => {
            setSeriesFy(event.target.value);
          }}
          required
          data-testid="series-fy"
        />
        <Field
          label="Prefix"
          help="Appears on every number this lane issues, like RCT/2026-27/000001."
          value={prefix}
          onChange={(event) => {
            setPrefix(event.target.value);
          }}
          required
          data-testid="series-prefix"
        />
      </Dialog>
    </Card>
  );
}

// --- 3 · Receipt candidates ----------------------------------------------------------

function CandidatesCard({
  slug,
  issuance,
  canDocument,
  busy,
  act,
}: {
  slug: string;
  issuance: FinanceWorkspace["board"]["issuance"];
  canDocument: boolean;
  busy: boolean;
  act: (run: () => Promise<FinopsResult>, done: string) => Promise<boolean>;
}) {
  const receiptSeries = issuance.series.filter(
    (row) => row.kind === "receipt" && row.status === "open",
  );
  const [seriesId, setSeriesId] = useState(receiptSeries[0]?.seriesId ?? "");

  return (
    <Card data-testid="candidates-card">
      <h2>Awaiting a receipt</h2>
      {issuance.candidates.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="Every collected payment has its receipt"
          description="The platform names a payment here the moment settlement captures it and no receipt exists. An empty list means nothing is owed a document."
        />
      ) : (
        <>
          <p className="section-note">
            {issuance.autoReceipt
              ? "Auto-receipt is on, so these will be issued by the platform on its next ingest. You can issue one by hand now if it cannot wait."
              : "Auto-receipt is off, so these wait for a human. Turning it on in the profile above lets the platform issue them itself."}
          </p>
          <div className="table-scroll">
            <table className="money-table" data-testid="candidates-table">
              <caption>
                <VisuallyHidden>Captured payments with no receipt</VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Payment</th>
                  <th scope="col" className="num">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {issuance.candidates.map((candidate) => (
                  <tr key={candidate.paymentId} data-testid={`candidate-${candidate.paymentId}`}>
                    <td data-label="Team">{candidate.teamName}</td>
                    <td data-label="Payment">
                      <span className="digest">{candidate.paymentId.slice(-10)}</span>
                    </td>
                    <td data-label="" className="num">
                      <div className="money-row-actions">
                        {canDocument && receiptSeries.length > 0 ? (
                          <Button
                            size="sm"
                            disabled={busy || seriesId === ""}
                            onClick={() => {
                              void act(
                                () => issueReceiptAction(slug, seriesId, candidate.paymentId),
                                "Receipt issued.",
                              );
                            }}
                            data-testid={`issue-${candidate.paymentId}`}
                          >
                            Issue receipt
                          </Button>
                        ) : receiptSeries.length === 0 ? (
                          <span className="section-note">needs an open receipt series</span>
                        ) : (
                          <span className="section-note">needs the document permission</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canDocument && receiptSeries.length > 1 ? (
            <div className="authority-form">
              <Select
                label="Issue into which series?"
                value={seriesId}
                onChange={(event) => {
                  setSeriesId(event.target.value);
                }}
                data-testid="candidate-series"
              >
                {receiptSeries.map((row) => (
                  <option key={row.seriesId} value={row.seriesId}>
                    {row.prefix}/{row.fy}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
