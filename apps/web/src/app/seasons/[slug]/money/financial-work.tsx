"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SectionCard } from "@desiauction/ui";
import { onScoringStop } from "../../../score/storage";
import { openFinancialIntentStorage } from "../../../../lib/financial-intent-storage";
import { type FinancialIntent, type FinancialRecord } from "../../../../lib/financial-intent";
import {
  recordPaymentAction,
  refundPaymentAction,
  waiveObligationAction,
  reviewFinancialIntentAction,
} from "../../../../server/settlement/actions";

type Scope = Pick<FinancialIntent, "actorId" | "orgId" | "caseId">;
export type FinancialDraft = Pick<
  FinancialIntent,
  "kind" | "targetId" | "amount" | "method" | "reason"
>;
type Boundary = Awaited<ReturnType<typeof openFinancialIntentStorage>>;
export function useFinancialWork(slug: string, inputScope: Scope | null) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const actorId = inputScope?.actorId;
  const orgId = inputScope?.orgId;
  const caseId = inputScope?.caseId;
  const scope = useMemo(
    () => (actorId && orgId && caseId ? { actorId, orgId, caseId } : null),
    [actorId, orgId, caseId],
  );
  const signature = scope ? JSON.stringify([scope.actorId, scope.orgId, scope.caseId]) : "";
  const current = useRef(signature);
  current.current = signature;
  const boundary = useRef<{ signature: string; work: Boundary } | null>(null);
  const exclusion = useRef(false);
  const [state, setState] = useState<{
    signature: string;
    ready: boolean;
    records: readonly FinancialRecord[];
    error: string;
  }>({ signature: "", ready: false, records: [], error: "" });
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<readonly string[]>([]);
  const [newWork, setNewWork] = useState(false);
  useEffect(() => {
    const lifetime = { active: true };
    const isActive = () => lifetime.active;
    let owned: Boundary | undefined;
    setReviewed([]);
    setNotice("");
    setNewWork(false);
    setBusy(false);
    exclusion.current = false;
    const stop = onScoringStop(() => {
      // Binding a newly authenticated actor may intentionally purge the old account.
      // During initialization the epoch receipt decides whether that binding survived.
      if (owned) lifetime.active = false;
      owned?.close();
      boundary.current = null;
      setState({
        signature,
        ready: false,
        records: [],
        error: "Account storage closed. Sign in again before working with money.",
      });
    });
    if (scope) {
      void openFinancialIntentStorage(scope, () => isActive() && current.current === signature)
        .then(async (work) => {
          owned = work;
          if (!isActive() || current.current !== signature) {
            work.close();
            return;
          }
          const records = await work.read();
          if (!isActive() || current.current !== signature) {
            work.close();
            return;
          }
          boundary.current = { signature, work };
          setState({ signature, ready: true, records, error: "" });
        })
        .catch((error: unknown) => {
          if (isActive() && current.current === signature)
            setState({
              signature,
              ready: false,
              records: [],
              error:
                error instanceof Error
                  ? error.message
                  : "Financial recovery storage is unavailable. Nothing will be sent.",
            });
        });
    }
    return () => {
      lifetime.active = false;
      owned?.close();
      stop();
      if (boundary.current?.signature === signature) boundary.current = null;
    };
    // Primitive scope identity is the lifetime of this authenticated workspace.
  }, [signature, scope]);
  const visible =
    state.signature === signature ? state : { signature, ready: false, records: [], error: "" };
  const unresolved = visible.records.filter(
    (record) =>
      record.outcome === "unknown" || (record.outcome === "not-started" && !record.retired),
  );
  const readyForNewWork =
    unresolved.length > 0 && unresolved.every((record) => reviewed.includes(record.intent.key));
  const owner = () => {
    const entry = boundary.current;
    if (!entry || entry.signature !== current.current || entry.signature !== signature)
      throw new Error("Financial recovery is not ready. Nothing will be sent.");
    return entry.work;
  };
  const refresh = async (work: Boundary) => {
    const records = await work.read();
    if (current.current === signature && boundary.current?.work === work)
      setState({ signature, ready: true, records, error: "" });
  };
  return {
    records: visible.records,
    requiresReview: unresolved.length > 0 && !newWork,
    newWork,
    error: visible.error,
    notice: state.signature === signature ? notice : "",
    busy,
    locked: !visible.ready || busy || (unresolved.length > 0 && !newWork),
    canStartNew: readyForNewWork && !newWork,
    allowNew: () => {
      if (readyForNewWork) setNewWork(true);
    },
    async run(draft: FinancialDraft): Promise<FinancialRecord | null> {
      if (exclusion.current) return null;
      exclusion.current = true;
      if (current.current === signature) setNotice("");
      setBusy(true);
      try {
        if (!scope || !visible.ready || (unresolved.length > 0 && !newWork))
          throw new Error("Review the unresolved financial action first. Nothing new was sent.");
        const work = owner();
        const original: FinancialIntent = { ...scope, ...draft, key: crypto.randomUUID() };
        const result = await work.dispatch(
          original,
          (intent) => {
            if (intent.kind === "payment")
              return recordPaymentAction(
                slug,
                intent.caseId,
                intent.targetId,
                intent.method,
                intent.amount,
                intent.key,
              );
            if (intent.kind === "refund")
              return refundPaymentAction(
                slug,
                intent.targetId,
                intent.amount,
                intent.reason,
                intent.key,
              );
            return waiveObligationAction(
              slug,
              intent.caseId,
              intent.targetId,
              intent.amount,
              intent.reason,
              intent.key,
            );
          },
          newWork,
        );
        await refresh(work);
        if (current.current !== signature || boundary.current?.work !== work) return null;
        setNewWork(false);
        setReviewed([]);
        return result;
      } catch (error) {
        if (current.current === signature) {
          const work = boundary.current?.work;
          if (work) {
            try {
              await refresh(work);
            } catch {
              /* Keep the original error and block mutation. */
            }
          }
          setState((previous) => ({
            ...previous,
            ready: false,
            error:
              error instanceof Error
                ? error.message
                : "Outcome unavailable. Review the original action before continuing.",
          }));
        }
        return null;
      } finally {
        if (current.current === signature) {
          exclusion.current = false;
          setBusy(false);
        }
      }
    },
    async closeUnsent(key: string): Promise<void> {
      if (exclusion.current) return;
      exclusion.current = true;
      if (current.current === signature) setNotice("");
      setBusy(true);
      try {
        const work = owner();
        await work.closeUnsent(key);
        await refresh(work);
      } catch (error) {
        if (current.current === signature)
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : "The unsent draft could not be closed.",
          }));
      } finally {
        if (current.current === signature) {
          exclusion.current = false;
          setBusy(false);
        }
      }
    },
    async review(key: string): Promise<void> {
      if (exclusion.current) return;
      exclusion.current = true;
      if (current.current === signature) setNotice("");
      setBusy(true);
      try {
        const work = owner();
        const availability = { value: true };
        const isAvailable = () => availability.value;
        const result = await work.review(key, async (intent) => {
          const answer = await reviewFinancialIntentAction(slug, intent);
          availability.value = answer.outcome !== "unavailable";
          return answer;
        });
        await refresh(work);
        if (current.current !== signature || boundary.current?.work !== work) return;
        if (result.outcome === "accepted") {
          setNotice(
            "The original action was found in the canonical record. The case is being refreshed.",
          );
          router.refresh();
        }
        if (isAvailable() && result.outcome === "unknown") setReviewed((keys) => [...keys, key]);
        if (!isAvailable())
          setState((previous) => ({
            ...previous,
            error:
              "Exact review is unavailable under your current permission. The original outcome remains unconfirmed.",
          }));
      } catch (error) {
        if (current.current === signature)
          setState((previous) => ({
            ...previous,
            error:
              error instanceof Error
                ? error.message
                : "Exact review is unavailable. The original outcome remains unconfirmed.",
          }));
      } finally {
        if (current.current === signature) {
          exclusion.current = false;
          setBusy(false);
        }
      }
    },
  };
}
export type FinancialWork = ReturnType<typeof useFinancialWork>;
export type FinancialAct = (draft: FinancialDraft, done: string) => Promise<boolean>;

/** Move to the actual recovery control after a dialog has left the document. */
export function focusFinancialRecovery() {
  requestAnimationFrame(() => {
    const control = document.querySelector<HTMLButtonElement>(
      '[data-testid="review-financial-work"]',
    );
    control?.scrollIntoView({ block: "center" });
    control?.focus();
  });
}

export function FinancialRecovery({
  work,
  names,
}: {
  work: FinancialWork;
  names: ReadonlyMap<string, string>;
}) {
  const pending = work.records.filter(
    (record) =>
      record.outcome === "unknown" || (record.outcome === "not-started" && !record.retired),
  );
  if (!work.error && !work.notice && pending.length === 0) return null;
  return (
    <SectionCard title="Review saved financial work" icon={null}>
      {work.error ? <p role="alert">{work.error}</p> : null}
      {work.notice ? <p role="status">{work.notice}</p> : null}
      {pending.map((record) => (
        <div
          className="money-recovery-record"
          key={record.intent.key}
          data-testid="financial-recovery"
          data-intent-key={record.intent.key}
        >
          <h3>
            {record.intent.kind === "payment"
              ? "Payment"
              : record.intent.kind === "refund"
                ? "Refund"
                : "Waiver"}{" "}
            · {record.outcome === "unknown" ? "Outcome unconfirmed" : "Not sent"}
          </h3>
          <dl>
            <div>
              {/* rupees-always: saved settlement intents are INR; points seasons never mount this panel. */}
              <dt>Original amount (₹)</dt>
              <dd>{record.intent.amount}</dd>
            </div>
            <div>
              <dt>Original target</dt>
              <dd>{names.get(record.intent.targetId) ?? record.intent.targetId}</dd>
            </div>
            {record.intent.method ? (
              <div>
                <dt>Method</dt>
                <dd>
                  {record.intent.method === "manual:cash"
                    ? "Cash"
                    : record.intent.method === "manual:upi-direct"
                      ? "Direct UPI"
                      : record.intent.method === "manual:bank"
                        ? "Bank transfer"
                        : record.intent.method}
                </dd>
              </div>
            ) : null}
            {record.intent.reason ? (
              <div>
                <dt>Reason</dt>
                <dd>{record.intent.reason}</dd>
              </div>
            ) : null}
          </dl>
          <p>
            The saved action is never sent again automatically. A matching amount or timeline entry
            does not establish its outcome.
          </p>
          <Button
            variant="secondary"
            size="touch"
            disabled={work.busy}
            data-testid="review-financial-work"
            onClick={() => {
              if (record.outcome === "not-started") void work.closeUnsent(record.intent.key);
              else void work.review(record.intent.key);
            }}
          >
            {record.outcome === "not-started" ? "Close unsent draft" : "Review original action"}
          </Button>
        </div>
      ))}
      {work.canStartNew ? (
        <div>
          <p>
            The original action is still unconfirmed. Start new work only if this is a genuinely
            separate payment, refund or waiver. Its history stays saved.
          </p>
          <Button variant="secondary" size="touch" onClick={work.allowNew}>
            Start a genuinely new action
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
