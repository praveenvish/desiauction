import { tmpdir } from "node:os";
import { join } from "node:path";

import { newId, type Db } from "@desiauction/db";

import type {
  ArtifactStorePort,
  DeliveryPort,
  DigestFn,
  DispatchChannel,
  FinopsStore,
  OrgDirectoryPort,
  ReferencePort,
  SettlementSourcePort,
} from "..";
import { createFilesystemArtifactStore, createInAppAdapter, createOutboxAdapter } from "./adapters";
import {
  createFinopsStore,
  createOrgDirectory,
  createOrgReference,
  createSettlementSource,
  sha256,
} from "./store";

/**
 * What the FinOps Writer, Follower and Runner depend on — all injected
 * (IP-6_ARCHITECTURE §22): the store, the READ-ONLY settlement source, the org
 * directory, the digest algorithm, the id factory and THE CLOCK. The domain
 * never reads a clock, never mints an id, never touches a driver; the edges do
 * all three here.
 */
export interface FinopsDeps {
  readonly store: FinopsStore;
  readonly source: SettlementSourcePort;
  readonly orgs: OrgDirectoryPort;
  /** Reference labels for party snapshots at issue (M-IP6-2) — read-only. */
  readonly reference: ReferencePort;
  /** Resolve the delivery port for a channel — null means unconfigured, and an
   * unconfigured channel FAILS a dispatch closed, never guesses (M-IP6-3). */
  readonly delivery: (channel: DispatchChannel) => DeliveryPort | null;
  /** Disposable artifact storage (ADR-9) — the export event's digest is truth. */
  readonly artifacts: ArtifactStorePort;
  readonly digest: DigestFn;
  readonly now: () => number;
  readonly newId: () => string;
}

export interface FinopsDepsOverrides {
  readonly now?: () => number;
  readonly newId?: () => string;
  /** Delivery adapters keyed by channel. Defaults: in-app (register-visible)
   * and an email filesystem OUTBOX; provider-backed adapters are drop-ins
   * behind the same port (pre-deploy configuration, the Razorpay precedent). */
  readonly delivery?: Readonly<Partial<Record<DispatchChannel, DeliveryPort>>>;
  readonly artifacts?: ArtifactStorePort;
  /** Root for the default filesystem stores (outbox + artifacts). */
  readonly storageDir?: string;
}

export function finopsDeps(db: Db, overrides: FinopsDepsOverrides = {}): FinopsDeps {
  const storageDir = overrides.storageDir ?? join(tmpdir(), "desiauction-finops");
  const delivery = new Map<DispatchChannel, DeliveryPort>([
    ["in-app", createInAppAdapter()],
    ["email", createOutboxAdapter("email", join(storageDir, "outbox"))],
  ]);
  for (const [channel, port] of Object.entries(overrides.delivery ?? {})) {
    delivery.set(channel as DispatchChannel, port);
  }
  return {
    store: createFinopsStore(db),
    source: createSettlementSource(db),
    orgs: createOrgDirectory(db),
    reference: createOrgReference(db),
    delivery: (channel) => delivery.get(channel) ?? null,
    artifacts: overrides.artifacts ?? createFilesystemArtifactStore(join(storageDir, "artifacts")),
    digest: sha256,
    now: overrides.now ?? (() => Date.now()),
    newId: overrides.newId ?? newId,
  };
}
