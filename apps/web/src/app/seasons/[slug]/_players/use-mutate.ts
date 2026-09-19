"use client";

import { useToast } from "@desiauction/ui";
import { useCallback } from "react";

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

export type MutateResult = { ok: boolean; error?: string; row?: Row };

export type Mutate = <R extends MutateResult>(
  row: Row,
  optimistic: Partial<Row>,
  run: () => Promise<R>,
  options?: MutateOptions,
) => Promise<R>;

/**
 * One write, the optimistic way: apply → write → reconcile or put it back.
 * See `useRoster` for why the screen moves before the server answers.
 */
export function useMutate(roster: Roster): Mutate {
  const toast = useToast();
  const { apply, begin, end, settle, rows } = roster;
  return useCallback(
    async <R extends MutateResult>(
      row: Row,
      optimistic: Partial<Row>,
      run: () => Promise<R>,
      options: MutateOptions = {},
    ): Promise<R> => {
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
      begin(row.id);
      let result: R;
      try {
        result = await run();
      } catch {
        result = {
          ok: false,
          error: "Couldn't reach the server — check the connection and try again.",
        } as R;
      }
      if (!result.ok) {
        for (const undo of undoes) {
          undo();
        }
        if (options.quiet !== true) {
          toast({ title: result.error ?? "That didn't save.", tone: "danger" });
        }
      } else {
        if (result.row !== undefined) {
          apply(row.id, result.row);
        }
        if (options.success !== undefined) {
          toast({
            title: options.success,
            tone: "success",
            ...(options.undo !== undefined
              ? { action: { label: "Undo", onSelect: options.undo } }
              : {}),
          });
        }
        settle();
      }
      end(row.id);
      return result;
    },
    [apply, begin, end, settle, rows, toast],
  );
}
