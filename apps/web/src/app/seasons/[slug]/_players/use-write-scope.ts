"use client";
import { useSyncExternalStore } from "react";
import { WriteScopes, type WriteLease } from "./write-scope";
const scopes = new Map<string, WriteScopes>();
const listeners = new Set<() => void>();
let revision = 0;
function publish() {
  revision += 1;
  for (const listener of listeners) listener();
}
export function writeScopes(slug: string) {
  let value = scopes.get(slug);
  if (!value) {
    value = new WriteScopes();
    scopes.set(slug, value);
  }
  return value;
}
export function acquireWrite(
  slug: string,
  rows: readonly string[],
  membership: readonly string[],
  groups: readonly string[] = [],
  whole = false,
) {
  const lease = writeScopes(slug).acquire(rows, membership, groups, whole);
  if (lease) publish();
  return lease;
}
export function changeWrite(slug: string, lease: WriteLease, state: WriteLease["state"]) {
  writeScopes(slug).set(lease, state);
  publish();
}
export function releaseWrite(slug: string, lease: WriteLease) {
  writeScopes(slug).release(lease);
  publish();
}
export function useWriteStatus(slug: string, row: string, team: string | null) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
    () => 0,
  );
  return typeof window === "undefined" ? null : writeScopes(slug).status(row, team);
}

export function refineWrite(
  slug: string,
  lease: WriteLease,
  rows: readonly string[],
  membership: readonly string[],
  groups: readonly string[],
) {
  writeScopes(slug).refine(lease, rows, membership, groups);
  publish();
}
