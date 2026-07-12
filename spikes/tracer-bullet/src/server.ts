// THROWAWAY (IP-0_DESIGN §32): the vertical spike that prices the substrate.
// append event -> pure reduce -> project -> ack over WS. Deleted at IP-0 exit.
import Fastify from "fastify";
import postgres from "postgres";
import { ulid } from "ulidx";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

import { env } from "./env.js";

const sql = postgres(env.DATABASE_URL, { max: 10 });

// --- toy domain: highest-bid per auction, reduced purely from the ledger ---
interface SpikeState {
  highestBidPaise: number;
  bidCount: number;
  lastSeq: number;
}
const zeroState: SpikeState = { highestBidPaise: 0, bidCount: 0, lastSeq: 0 };

interface SpikeEvent {
  seq: number;
  type: string;
  payload: { amountPaise: number };
}

function reduce(state: SpikeState, event: SpikeEvent): SpikeState {
  return {
    highestBidPaise: Math.max(state.highestBidPaise, event.payload.amountPaise),
    bidCount: state.bidCount + 1,
    lastSeq: event.seq,
  };
}

// --- single-writer discipline: one in-process queue per auction ---
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(auctionId: string, work: () => Promise<T>): Promise<T> {
  const tail = queues.get(auctionId) ?? Promise.resolve();
  const next = tail.then(work, work);
  queues.set(auctionId, next);
  return next;
}

// --- fan-out: WS subscribers per auction ---
const subscribers = new Map<string, Set<WebSocket>>();
function broadcast(auctionId: string, message: string): void {
  const subs = subscribers.get(auctionId);
  if (subs === undefined) {
    return;
  }
  for (const socket of subs) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

const states = new Map<string, SpikeState>();

const cmdSchema = z.object({
  auctionId: z.string().min(1),
  type: z.literal("bid"),
  amountPaise: z.number().int().positive(),
});

const server = Fastify({ logger: false });

server.post("/cmd", async (request, reply) => {
  const cmd = cmdSchema.parse(request.body);
  const result = await enqueue(cmd.auctionId, async () => {
    const started = process.hrtime.bigint();
    const state = states.get(cmd.auctionId) ?? zeroState;
    const seq = state.lastSeq + 1;
    await sql`
      insert into spike_ledger (id, auction_id, seq, type, payload)
      values (${ulid()}, ${cmd.auctionId}, ${seq}, ${cmd.type}, ${sql.json({ amountPaise: cmd.amountPaise })})
    `;
    const next = reduce(state, { seq, type: cmd.type, payload: { amountPaise: cmd.amountPaise } });
    states.set(cmd.auctionId, next);
    const internalMs = Number(process.hrtime.bigint() - started) / 1e6;
    broadcast(cmd.auctionId, JSON.stringify({ seq, state: next, publishedAtMs: Date.now() }));
    return { seq, internalMs };
  });
  return reply.send(result);
});

server.get("/replay/:auctionId", async (request, reply) => {
  const { auctionId } = request.params as { auctionId: string };
  const started = process.hrtime.bigint();
  const rows = await sql<{ seq: string; type: string; payload: { amountPaise: number } }[]>`
    select seq, type, payload from spike_ledger
    where auction_id = ${auctionId} order by seq asc
  `;
  let state = zeroState;
  for (const row of rows) {
    state = reduce(state, { seq: Number(row.seq), type: row.type, payload: row.payload });
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return reply.send({ events: rows.length, ms, state });
});

server.get("/healthz", async (_request, reply) => {
  await sql`select 1`;
  return reply.send({ status: "ok" });
});

const wss = new WebSocketServer({ noServer: true });
server.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const auctionId = url.searchParams.get("auction");
  if (url.pathname === "/sub" && auctionId !== null) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const subs = subscribers.get(auctionId) ?? new Set<WebSocket>();
      subs.add(ws);
      subscribers.set(auctionId, subs);
      ws.on("close", () => {
        subs.delete(ws);
      });
    });
  } else {
    socket.destroy();
  }
});

await server.listen({ host: "0.0.0.0", port: env.PORT });
console.log(`tracer-bullet serving on :${String(env.PORT)}`);
