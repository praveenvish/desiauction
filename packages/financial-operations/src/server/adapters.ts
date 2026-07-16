import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

import type { ArtifactStorePort, DeliveryPort, DispatchChannel } from "..";

/**
 * The built-in adapters (M-IP6-3). The IP-5 manual-adapter doctrine on the
 * delivery plane: first-class channels that need NO external service, wired
 * by default so the pipeline is real from day one — a provider-backed
 * email/SMS/WhatsApp adapter is a drop-in behind the same `DeliveryPort`
 * (pre-deploy configuration, the Razorpay-credentials precedent), never a
 * rewrite. No provider SDK exists anywhere in this package.
 */

/**
 * IN-APP: delivery IS visibility — the dispatch register (org-scoped, RLS'd)
 * is the tray a signed-in officer reads. Send therefore succeeds
 * deterministically and confirms inline; the providerRef is derived from the
 * dispatch id, so a replayed send derives the identical refs.
 */
export function createInAppAdapter(): DeliveryPort {
  return {
    channel: "in-app",
    send(request) {
      return Promise.resolve({
        ok: true as const,
        providerRef: `in-app:${request.dispatchId}`,
        confirmed: { providerEventRef: `in-app:${request.dispatchId}:read-model` },
      });
    },
  };
}

/**
 * FILESYSTEM OUTBOX (the classic dev/pickup pattern): writes one immutable
 * message file per dispatch and confirms inline (the write IS the delivery
 * truth for an outbox). File name derives from the dispatch id —
 * deterministic, replay-safe, duplicate-proof (a re-send overwrites the
 * identical bytes).
 */
export function createOutboxAdapter(channel: DispatchChannel, rootDir: string): DeliveryPort {
  return {
    channel,
    send(request) {
      try {
        const dir = join(rootDir, request.orgId);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${request.dispatchId}.${channel}.txt`);
        const bytes = [
          `channel: ${channel}`,
          `to: ${request.recipientRef}`,
          `template: ${request.templateId}@${request.templateVersion}`,
          `subject: ${request.subjectRef}`,
          `body-digest: ${request.bodyDigest}`,
          "",
          request.body,
        ].join("\n");
        writeFileSync(file, bytes, "utf8");
        return Promise.resolve({
          ok: true as const,
          providerRef: `outbox:${request.dispatchId}`,
          confirmed: { providerEventRef: `outbox:${request.dispatchId}:written` },
        });
      } catch (error) {
        return Promise.resolve({
          ok: false as const,
          code: `outbox_io:${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        });
      }
    },
  };
}

/**
 * FILESYSTEM ARTIFACT STORE. Artifacts are DISPOSABLE (ADR-9): the digest in
 * the export event is the truth; this store never claims authority. Keys are
 * confined to the root (a ref that escapes it reads as missing — fail closed).
 */
export function createFilesystemArtifactStore(rootDir: string): ArtifactStorePort {
  const root = resolve(rootDir);
  const confine = (ref: string): string | null => {
    const full = resolve(root, normalize(ref));
    return full === root || full.startsWith(root + sep) ? full : null;
  };
  return {
    put(key, bytes) {
      const full = confine(key);
      if (full === null) {
        return Promise.reject(new Error("artifact_key_escapes_root"));
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes, "utf8");
      return Promise.resolve({ ref: key });
    },
    get(ref) {
      const full = confine(ref);
      if (full === null) {
        return Promise.resolve(null);
      }
      try {
        return Promise.resolve(readFileSync(full, "utf8"));
      } catch {
        return Promise.resolve(null);
      }
    },
  };
}

/** sha-256 of artifact/delivery bytes — the adapters' local sealing helper. */
export function bytesDigest(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
