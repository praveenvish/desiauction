// VA-1 auction simulation. Fake data, honest rules: base price, increments,
// anti-snipe extension that never shrinks, purse checks, SOLD/UNSOLD outcomes.
// Prototype only — nothing here is production architecture.

export type Role = 'BAT' | 'BOWL' | 'ALL' | 'WK';
export type Phase = 'idle' | 'live' | 'sold' | 'unsold' | 'paused';
export type Conn = 'live' | 'reconnecting' | 'offline' | 'stalled';

export interface Player {
  id: string; name: string; sub?: string; role: Role; base: number;
  marquee?: boolean; value: number; // hidden AI valuation
}
export interface Team {
  id: string; name: string; short: string; purse: number; spent: number;
  squad: number; hue: number; you?: boolean; aggression: number;
}
export interface Bid { teamId: string; amount: number; at: number; }
export interface SimState {
  seq: number; phase: Phase; conn: Conn;
  lotNo: number; player: Player | null;
  current: number; leader: string | null; bids: Bid[];
  endsAt: number; extended: boolean;
  teams: Team[]; queue: Player[]; results: { player: string; team: string | null; amount: number }[];
  auto: boolean;
}
export type SimEvent =
  | { type: 'open' } | { type: 'bid'; bid: Bid } | { type: 'extend'; by: number }
  | { type: 'sold' } | { type: 'unsold' } | { type: 'pause' } | { type: 'resume' }
  | { type: 'conn'; conn: Conn } | { type: 'sync' };

const TIMER_INITIAL = 24_000;
const TIMER_EXTENSION = 12_000;

/* Increments escalate with price (IPL-style slabs) so duels resolve in ~15–25 bids */
export const increment = (cur: number) => Math.max(25_000, Math.round((cur * 0.08) / 25_000) * 25_000);
export const nextBid = (s: SimState) => (s.bids.length === 0 ? s.player!.base : s.current + increment(s.current));

const P = (id: string, name: string, role: Role, base: number, opts: Partial<Player> = {}): Player =>
  ({ id, name, role, base, value: base * (1.8 + Math.random() * 3) * (opts.marquee ? 1.6 : 1), ...opts });

export function makeState(): SimState {
  const queue: Player[] = [
    P('p1', 'Rohit Deshmukh', 'BAT', 200_000, { marquee: true, sub: 'Opening batter · Sitapur' }),
    P('p2', 'अर्जुन पवार', 'ALL', 100_000, { sub: 'Arjun Pawar · All-rounder' }),
    P('p3', 'Imran Shaikh', 'BOWL', 100_000, { sub: 'Left-arm quick' }),
    P('p4', 'साहिल जाधव', 'WK', 75_000, { sub: 'Sahil Jadhav · Keeper-bat' }),
    P('p5', 'Devang Patel', 'BAT', 75_000, { sub: 'Middle order' }),
    P('p6', 'प्रकाश यादव', 'BOWL', 50_000, { sub: 'Prakash Yadav · Off-spin' }),
    P('p7', 'Sunil Kambli', 'ALL', 125_000, { marquee: true, sub: 'Captain material' }),
    P('p8', 'Faisal Khan', 'BOWL', 50_000, { sub: 'Death overs' }),
  ];
  const T = (id: string, name: string, short: string, hue: number, you = false): Team =>
    ({ id, name, short, purse: 9_000_000, spent: 0, squad: 0, hue, you, aggression: .35 + Math.random() * .5 });
  return {
    seq: 0, phase: 'idle', conn: 'live', lotNo: 0, player: null,
    current: 0, leader: null, bids: [], endsAt: 0, extended: false,
    teams: [T('t1', 'Sitapur Strikers', 'SS', 84, true), T('t2', 'Nadi Royals', 'NR', 210),
            T('t3', 'Bazaar Titans', 'BT', 28), T('t4', 'Kila Falcons', 'KF', 330)],
    queue, results: [], auto: false,
  };
}

type Listener = (s: SimState, e: SimEvent) => void;

export class Sim {
  s = makeState();
  private listeners: Listener[] = [];
  private aiTimer: number | null = null;
  private clock: number | null = null;
  private ceremonyTimer: number | null = null;

  onEvent(fn: Listener) { this.listeners.push(fn); fn(this.s, { type: 'sync' }); }
  private emit(e: SimEvent) { this.s.seq++; this.listeners.forEach(f => f(this.s, e)); }

  start() {
    if (this.clock != null) return;
    this.clock = window.setInterval(() => this.tick(), 120);
  }

  stop() { // fully silence a local sim when a driver takes over
    if (this.clock != null) { clearInterval(this.clock); this.clock = null; }
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.ceremonyTimer) clearTimeout(this.ceremonyTimer);
    this.listeners = [];
  }

  private tick() {
    const s = this.s;
    if (s.phase === 'live' && s.conn === 'live' && Date.now() >= s.endsAt) this.close();
  }

  openNext() {
    const s = this.s;
    if (s.phase === 'live' || s.queue.length === 0) return;
    s.player = s.queue.shift()!;
    s.lotNo++; s.phase = 'live'; s.bids = []; s.current = 0; s.leader = null;
    s.endsAt = Date.now() + TIMER_INITIAL; s.extended = false;
    this.emit({ type: 'open' });
    this.scheduleAI();
  }

  canBid(teamId: string): { ok: boolean; reason?: string } {
    const s = this.s;
    if (s.phase !== 'live') return { ok: false, reason: 'No live lot' };
    if (s.conn !== 'live') return { ok: false, reason: 'Reconnecting' };
    if (s.leader === teamId) return { ok: false, reason: 'You lead' };
    const t = s.teams.find(t => t.id === teamId)!;
    if (nextBid(s) > t.purse - t.spent) return { ok: false, reason: 'Purse limit' };
    return { ok: true };
  }

  bid(teamId: string) {
    if (!this.canBid(teamId).ok) return false;
    const s = this.s;
    const amount = nextBid(s);
    const b: Bid = { teamId, amount, at: Date.now() };
    s.bids.push(b); s.current = amount; s.leader = teamId;
    const newEnd = Math.max(s.endsAt, Date.now() + TIMER_EXTENSION); // never shrinks
    if (newEnd > s.endsAt + 400) { s.endsAt = newEnd; s.extended = true; this.emit({ type: 'extend', by: TIMER_EXTENSION }); }
    this.emit({ type: 'bid', bid: b });
    this.scheduleAI();
    return true;
  }

  private scheduleAI() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    const s = this.s;
    if (s.phase !== 'live') return;
    const delay = 900 + Math.random() * 2400;
    this.aiTimer = window.setTimeout(() => {
      if (s.phase !== 'live' || s.conn !== 'live') return;
      const price = nextBid(s);
      const rivals = s.teams.filter(t => !t.you && t.id !== s.leader
        && price <= (t.purse - t.spent) && price <= s.player!.value * (0.6 + t.aggression * 0.55));
      if (rivals.length && Math.random() < .82) {
        const r = rivals[Math.floor(Math.random() * rivals.length)];
        this.bid(r.id);
      } else {
        this.scheduleAI(); // rivals hesitate; timer decides
      }
    }, delay);
  }

  close() {
    const s = this.s;
    if (s.phase !== 'live') return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (s.leader) {
      const t = s.teams.find(t => t.id === s.leader)!;
      t.spent += s.current; t.squad++;
      s.results.unshift({ player: s.player!.name, team: t.short, amount: s.current });
      s.phase = 'sold'; this.emit({ type: 'sold' });
    } else {
      s.results.unshift({ player: s.player!.name, team: null, amount: 0 });
      s.phase = 'unsold'; this.emit({ type: 'unsold' });
    }
    if (this.ceremonyTimer) clearTimeout(this.ceremonyTimer);
    this.ceremonyTimer = window.setTimeout(() => {
      s.phase = 'idle'; this.emit({ type: 'sync' });
      if (s.auto && s.queue.length) window.setTimeout(() => { if (s.phase === 'idle') this.openNext(); }, 2200);
    }, 4200);
  }

  pause() { if (this.s.phase === 'live') { this.s.phase = 'paused'; this.emit({ type: 'pause' }); } }
  resume() {
    if (this.s.phase !== 'paused') return;
    this.s.phase = 'live'; this.s.endsAt = Math.max(this.s.endsAt, Date.now() + 8000);
    this.emit({ type: 'resume' }); this.scheduleAI();
  }

  setAuto(v: boolean) { this.s.auto = v; this.emit({ type: 'sync' }); if (v && this.s.phase === 'idle') this.openNext(); }

  /* Failure theatre — EP-10 is tested, not assumed */
  simulateDisconnect(ms = 4200) {
    const s = this.s;
    if (s.conn !== 'live') return;
    s.conn = 'offline'; this.emit({ type: 'conn', conn: 'offline' });
    const wasEnd = s.endsAt;
    window.setTimeout(() => { s.conn = 'reconnecting'; this.emit({ type: 'conn', conn: 'reconnecting' }); }, ms * .45);
    window.setTimeout(() => {
      s.conn = 'live';
      if (s.phase === 'live') s.endsAt = Math.max(wasEnd, Date.now() + 6000); // server would have held truth
      this.emit({ type: 'conn', conn: 'live' }); this.scheduleAI();
    }, ms);
  }
  simulateStall(ms = 3600) {
    const s = this.s;
    if (s.conn !== 'live') return;
    s.conn = 'stalled'; this.emit({ type: 'conn', conn: 'stalled' });
    window.setTimeout(() => {
      s.conn = 'live';
      if (s.phase === 'live') s.endsAt = Math.max(s.endsAt, Date.now() + 6000);
      this.emit({ type: 'conn', conn: 'live' }); this.scheduleAI();
    }, ms);
  }
  forceUnsoldNext() { // dignity test hook: next lot receives no bids
    const s = this.s;
    if (s.queue.length) { s.queue[0].value = 0; this.emit({ type: 'sync' }); }
  }
}

/* ---------- Cross-tab wiring: Cockpit drives, Stage/Owner follow ---------- */
export type WireMsg =
  | { kind: 'state'; s: SimState; e: SimEvent }
  | { kind: 'intent'; action: 'bid'; teamId: string }
  | { kind: 'who-drives' } | { kind: 'driver-here' };

export function drive(sim: Sim): void {
  const ch = new BroadcastChannel('va1');
  sim.onEvent((s, e) => ch.postMessage({ kind: 'state', s, e } satisfies WireMsg));
  ch.onmessage = (m: MessageEvent<WireMsg>) => {
    if (m.data.kind === 'who-drives') ch.postMessage({ kind: 'driver-here' } satisfies WireMsg);
    if (m.data.kind === 'intent' && m.data.action === 'bid') sim.bid(m.data.teamId);
  };
  ch.postMessage({ kind: 'driver-here' } satisfies WireMsg);
}

/** Follow a driver if one exists; otherwise run standalone demo after `graceMs`. */
export function follow(
  onState: (s: SimState, e: SimEvent) => void,
  intent: { bid?: (teamId: string) => void },
  makeLocal: () => Sim, graceMs = 700,
): { bid: (teamId: string) => void; local: () => Sim | null } {
  const ch = new BroadcastChannel('va1');
  let driven = false; let local: Sim | null = null;
  ch.onmessage = (m: MessageEvent<WireMsg>) => {
    if (m.data.kind === 'driver-here') driven = true;
    if (m.data.kind === 'state') { driven = true; if (local) { local.stop(); local = null; } onState(m.data.s, m.data.e); }
  };
  ch.postMessage({ kind: 'who-drives' } satisfies WireMsg);
  window.setTimeout(() => {
    if (!driven) { local = makeLocal(); local.onEvent(onState); local.start(); local.setAuto(true); }
  }, graceMs);
  return {
    bid: (teamId) => { if (local) local.bid(teamId); else ch.postMessage({ kind: 'intent', action: 'bid', teamId } satisfies WireMsg); },
    local: () => local,
  };
}
