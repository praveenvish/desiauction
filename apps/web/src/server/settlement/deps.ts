import { newId, type Db } from "@desiauction/db";
import {
  CHECKPOINT_CADENCE,
  type AuctionSourcePort,
  type DigestFn,
  type PaymentGatewayPort,
} from "@desiauction/settlement";

import { env } from "../../env";
import { createManualAdapter, MANUAL_METHODS } from "./adapters/manual";
import { createRazorpayAdapter } from "./adapters/razorpay";
import {
  createAuctionSource,
  createSettlementStore,
  sha256,
  type SettlementStoreWithRows,
} from "./store";

/**
 * What the Settlement Writer depends on — all of it injected (IP-5_ARCHITECTURE
 * §23): the store and the read-only auction source behind their ports, the
 * digest algorithm, the id factory, THE CLOCK, and the gateway resolver. The
 * domain never reads a clock, never mints an id, and never imports a provider
 * SDK; the writer does all three at the edge (ports over providers).
 */
export interface SettlementDeps {
  readonly store: SettlementStoreWithRows;
  readonly source: AuctionSourcePort;
  readonly digest: DigestFn;
  readonly now: () => number;
  readonly newId: () => string;
  /** Journal checkpoint cadence (§13a). Injected so drills can exercise the chain. */
  readonly checkpointCadence: number;
  /** Resolve the gateway for a payment method — a port, never an SDK. */
  readonly gateway: (method: string) => PaymentGatewayPort | null;
}

export interface SettlementDepsOverrides {
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly checkpointCadence?: number;
  /** Gateway adapters keyed by method (e.g. a Razorpay adapter). Manual methods
   * are always available. Tests inject fakes here; production wires the real
   * Razorpay adapter from validated env. */
  readonly gateways?: Readonly<Record<string, PaymentGatewayPort>>;
}

/**
 * The real gateway, wired from validated env — or nothing at all.
 *
 * All three variables or none: a half-configured gateway would accept orders it
 * could never reconcile. When absent, `gateway("gateway:razorpay")` returns null
 * and the webhook route answers 503 `gateway_unconfigured`, which is the honest
 * answer and the one the ingress already knew how to give.
 */
function configuredGateways(): Map<string, PaymentGatewayPort> {
  const gateways = new Map<string, PaymentGatewayPort>();
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (keyId !== undefined && keySecret !== undefined && webhookSecret !== undefined) {
    gateways.set("gateway:razorpay", createRazorpayAdapter({ keyId, keySecret, webhookSecret }));
  }
  return gateways;
}

export function settlementDeps(db: Db, overrides: SettlementDepsOverrides = {}): SettlementDeps {
  const manual = new Map<string, PaymentGatewayPort>(
    MANUAL_METHODS.map((method) => [method, createManualAdapter(method)]),
  );
  const configured = configuredGateways();
  const injected = new Map<string, PaymentGatewayPort>(Object.entries(overrides.gateways ?? {}));
  return {
    store: createSettlementStore(db),
    source: createAuctionSource(db),
    digest: sha256,
    now: overrides.now ?? (() => Date.now()),
    newId: overrides.newId ?? newId,
    checkpointCadence: overrides.checkpointCadence ?? CHECKPOINT_CADENCE,
    // Tests inject first, then real configured gateways, then the manual
    // adapters that are always available.
    gateway: (method) =>
      injected.get(method) ?? configured.get(method) ?? manual.get(method) ?? null,
  };
}
