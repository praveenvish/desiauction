"use client";

import { useToast } from "@desiauction/ui";
import { useCallback } from "react";

import {
  registrationDetailAction,
  squadWriteStateAction,
} from "../../../../server/competition/actions";
import {
  acquireWrite,
  changeWrite,
  releaseWrite,
  refineWrite,
  writeScopes,
} from "./use-write-scope";
import type { Row } from "./labels";
import type { Roster } from "./use-roster";

export interface MutateOptions {
  /** Toast on success. Omit for a change that shows its own confirmation. */
  success?: string;
  /** Offer Undo on that toast. */
  undo?: () => void;
  /** No toast on failure either — the caller shows the error in place. */
  quiet?: boolean;
}

export type MutateResult = {
  ok: boolean;
  error?: string;
  row?: Row;
  unconfirmed?: true;
  notStarted?: true;
};

export type Mutate = <R extends MutateResult>(
  row: Row,
  optimistic: Partial<Row>,
  run: () => Promise<R>,
  options?: MutateOptions,
) => Promise<R & { unconfirmed?: true; notStarted?: true }>;

/**
 * One write, the optimistic way: apply → write → reconcile or put it back.
 * See `useRoster` for why the screen moves before the server answers.
 */
export function useMutate(roster: Roster, slug: string): Mutate {
  const toast = useToast();
  const { apply, begin, end, settle, rows } = roster;
  return useCallback(
    async <R extends MutateResult>(
      row: Row,
      optimistic: Partial<Row>,
      run: () => Promise<R>,
      options: MutateOptions = {},
    ): Promise<R & { unconfirmed?: true; notStarted?: true }> => {
      const membership = [
        ...new Set(
          [row.teamId, optimistic.teamId].filter((id): id is string => typeof id === "string"),
        ),
      ];
      const captainChange = optimistic.isCaptain !== undefined || optimistic.teamId !== undefined;
      let affected = captainChange
        ? rows.filter(
            (other) =>
              other.id === row.id || (other.teamId !== null && membership.includes(other.teamId)),
          )
        : [row];
      if (!affected.some((other) => other.id === row.id)) affected = [...affected, row];
      const lease = acquireWrite(
        slug,
        affected.map((other) => other.id),
        membership,
        captainChange ? membership : [],
        captainChange,
      );
      if (!lease) return { ok: false, notStarted: true } as R & { notStarted: true };
      if (captainChange) {
        try {
          const before = await squadWriteStateAction(
            slug,
            [row.id],
            typeof optimistic.teamId === "string" ? [optimistic.teamId] : [],
          );
          if (!before.ok) throw new Error("Read refused");
          const complete = await Promise.all(
            before.rows.map((item) => registrationDetailAction(slug, item.id)),
          );
          if (complete.some((item) => !item.ok)) throw new Error("Read refused");
          affected = complete.flatMap((item) => (item.ok ? [item.row] : []));
          refineWrite(
            slug,
            lease,
            affected.map((item) => item.id),
            before.teams,
            before.teams,
          );
        } catch {
          releaseWrite(slug, lease);
          return {
            ok: false,
            error: "Couldn't check the squad before saving. No change was sent.",
          } as R;
        }
      }
      for (const other of affected) begin(other.id);
      const undoes = [apply(row.id, optimistic)];
      // DA-04 on the screen: a team has one captain, so naming a new one takes
      // the armband off the old one in the same instant the server does.
      if (optimistic.isCaptain === true) {
        const teamId = optimistic.teamId !== undefined ? optimistic.teamId : row.teamId;
        for (const other of rows) {
          if (
            other.id !== row.id &&
            other.isCaptain &&
            teamId !== null &&
            other.teamId === teamId
          ) {
            undoes.push(apply(other.id, { isCaptain: false }));
          }
        }
      }
      let result: R & { unconfirmed?: true; notStarted?: true };
      try {
        result = await run();
      } catch {
        result = {
          ok: false,
          error: "Couldn't confirm the save. Check the current value before retrying.",
          unconfirmed: true,
        } as R & { unconfirmed?: true; notStarted?: true };
      }
      if (!result.ok) for (const undo of undoes) undo();
      if (result.unconfirmed !== true) {
        changeWrite(slug, lease, "checking");
        try {
          const observed = await Promise.all(
            affected.map((other) => registrationDetailAction(slug, other.id)),
          );
          if (observed.some((item) => !item.ok)) throw new Error("Read refused");
          for (const item of observed) if (item.ok) apply(item.row.id, item.row);
        } catch {
          if (result.ok) for (const undo of undoes) undo();
          result = {
            ...result,
            ok: false,
            unconfirmed: true,
            error: "Couldn't check the saved record. Reload to see its current state.",
          };
        }
      }
      if (!result.ok) {
        if (options.quiet !== true) {
          toast({ title: result.error ?? "That didn't save.", tone: "danger" });
        }
      } else {
        if (options.success !== undefined) {
          toast({
            title: options.success,
            tone: "success",
            ...(options.undo !== undefined
              ? {
                  action: {
                    label: "Undo",
                    onSelect: () => {
                      if (writeScopes(slug).current(lease)) options.undo?.();
                      else
                        toast({
                          title:
                            "This player has been edited again. Review the current record before undoing.",
                          tone: "danger",
                        });
                    },
                  },
                }
              : {}),
          });
        }
        settle();
      }
      if (result.unconfirmed === true) changeWrite(slug, lease, "unconfirmed");
      else {
        for (const other of affected) end(other.id);
        releaseWrite(slug, lease);
      }
      return result;
    },
    [apply, begin, end, settle, rows, toast, slug],
  );
}
