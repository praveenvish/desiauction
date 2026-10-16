import type { ScoringPublicProof } from "@desiauction/db";
import type {
  PublicScoringState as PublicLiveState,
  RaidClockContext,
} from "@desiauction/core/scoring";
export interface Peer {
  send(data: string): void;
  close(code: number): void;
  bufferedAmount: number;
}
export type Reader = (
  fixtureId: string,
  proof: ScoringPublicProof,
) => Promise<{ allowed: boolean; live: PublicLiveState | null; clock?: RaidClockContext }>;
interface Member {
  peer: Peer;
  proof: ScoringPublicProof;
  last: string;
}
/** Members holding the same proof see the same release; they share one read. */
function proofKey(proof: ScoringPublicProof): string {
  return JSON.stringify([proof.s ?? null, proof.t ?? null]);
}
/** One bounded serial reader and a coalescing room queue. Each release rechecks P1/P3. */
export function createHub(read: Reader, onError: (error: unknown) => void) {
  const rooms = new Map<string, Set<Member>>();
  const pending = new Set<string>();
  let running = false;
  let closed = false;
  const isClosed = () => closed;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (pending.size && !isClosed()) {
        const fixtureId = pending.values().next().value as string;
        pending.delete(fixtureId);
        const members = rooms.get(fixtureId);
        if (!members) continue;
        // F05: one read per proof per tick, fanned out to every socket that
        // holds it — a 2,000-viewer room costs one query, not 2,000.
        const groups = new Map<string, Member[]>();
        for (const member of members) {
          const key = proofKey(member.proof);
          const group = groups.get(key);
          if (group) group.push(member);
          else groups.set(key, [member]);
        }
        for (const group of groups.values()) {
          const proof = group[0]?.proof;
          if (!proof) continue;
          let result: Awaited<ReturnType<Reader>>;
          try {
            result = await read(fixtureId, proof);
          } catch (error) {
            onError(error);
            for (const member of group) {
              member.peer.close(1011);
              members.delete(member);
            }
            continue;
          }
          if (isClosed()) break;
          const identity = JSON.stringify({
            live: result.live,
            ...(result.clock ? { delayMs: result.clock.delayMs } : {}),
          });
          const frame = JSON.stringify({
            t: "live",
            live: result.live,
            ...(result.clock ? { clock: result.clock } : {}),
          });
          for (const member of group) {
            if (!members.has(member)) continue;
            if (!result.allowed) {
              member.peer.close(1008);
              members.delete(member);
              continue;
            }
            if (identity === member.last) continue;
            if (member.peer.bufferedAmount > 64 * 1024) {
              member.peer.close(1013);
              members.delete(member);
              continue;
            }
            member.peer.send(frame);
            member.last = identity;
          }
        }
        if (!members.size) rooms.delete(fixtureId);
      }
    } finally {
      running = false;
    }
  }
  function notify(fixtureId: string) {
    if (!closed && rooms.has(fixtureId)) {
      pending.add(fixtureId);
      void drain();
    }
  }
  return {
    join(fixtureId: string, proof: ScoringPublicProof, peer: Peer) {
      if (closed || (rooms.size >= 2000 && !rooms.has(fixtureId))) {
        peer.close(1013);
        return () => {};
      }
      const members = rooms.get(fixtureId) ?? new Set<Member>();
      if (members.size >= 2000) {
        peer.close(1013);
        return () => {};
      }
      const member = { peer, proof, last: "" };
      members.add(member);
      rooms.set(fixtureId, members);
      notify(fixtureId);
      return () => {
        members.delete(member);
        if (!members.size) rooms.delete(fixtureId);
      };
    },
    notify,
    // Release delayed entries without a subsequent append; also catch quiet revocations.
    refresh() {
      for (const fixtureId of rooms.keys()) notify(fixtureId);
    },
    close() {
      closed = true;
      pending.clear();
      for (const members of rooms.values()) for (const m of members) m.peer.close(1001);
      rooms.clear();
    },
  };
}
