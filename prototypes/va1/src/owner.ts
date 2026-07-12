import { follow, Sim, SimState, SimEvent, nextBid } from './sim';
import { initChrome, makeRing, makeCeremony, makeDev, rollMoney, short, inr, teamName, reduced } from './shared';

initChrome();
document.body.classList.add('owner');

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const HOLD_THRESHOLD = 500_000; // ≥ this, money moves like stone (EP-6)
const ring = makeRing($('#oring'), 66);
const ceremony = makeCeremony($('#ceremony'));
const live = $('#a11y');

let S: SimState | null = null;
let wasLeading = false;

function render(s: SimState, e: SimEvent) {
  S = s;
  const you = s.teams.find(t => t.you)!;
  const left = you.purse - you.spent;

  ($('#dot') as HTMLElement).className = 'o-dot' + (s.conn === 'live' ? '' : ' bad');
  rollMoney($('#purse'), left);
  $('#squad').textContent = `${you.squad} / 8`;
  $('#spent').textContent = short(you.spent);

  const idle = !s.player || s.phase === 'idle';
  $('#lotLabel').textContent = idle ? (s.queue[0] ? 'Next on the block' : 'Auction complete') : `Lot ${String(s.lotNo).padStart(2, '0')}`;
  $('#pname').textContent = idle ? (s.queue[0]?.name ?? '—') : s.player!.name;
  $('#psub').textContent = idle ? 'Get ready' : (s.player!.sub || '');

  const youLead = s.leader === you.id;
  const amt = $('#cur');
  amt.className = 'amt money roll' + (youLead ? ' yours' : '');
  rollMoney(amt, s.bids.length ? s.current : (s.player?.base ?? 0));
  $('#stateLine').innerHTML =
    s.phase !== 'live' ? '<span class="lead-them">Bidding closed</span>'
    : s.bids.length === 0 ? '<span class="lead-them">Awaiting opening bid</span>'
    : youLead ? '<span class="lead-you">You lead</span>'
    : `<span class="lead-them"><b>${teamName(s.teams, s.leader)}</b> leads</span>`;

  ring.update(s.endsAt, s.phase === 'live' && s.conn === 'live');

  $('#recent').innerHTML = s.bids.slice(-3).reverse().map(b =>
    `<div class="r"><span>${teamName(s.teams, b.teamId)}${b.teamId === you.id ? ' (you)' : ''}</span><span class="a">${short(b.amount)}</span></div>`).join('');

  // The one button — its label is its consequence (§8)
  const btn = $('#bid') as HTMLButtonElement;
  const price = s.phase === 'live' && s.player ? nextBid(s) : 0;
  const needHold = price >= HOLD_THRESHOLD;
  const gate = s.phase !== 'live' ? 'Bidding is closed'
    : s.conn !== 'live' ? 'Reconnecting — bids paused'
    : youLead ? 'You hold the top bid'
    : price > left ? `Beyond your purse (${short(left)} left)`
    : '';
  btn.disabled = !!gate;
  btn.innerHTML = gate && s.phase === 'live' && youLead
    ? `You lead at ${short(s.current)}`
    : s.phase === 'live'
      ? `Bid ${short(price)}${needHold ? '<span class="sub">HOLD TO CONFIRM</span>' : ''}`
      : 'Waiting for next lot';
  $('#hint').textContent = gate || (needHold ? 'Large bid — press and hold' : 'One tap places this exact amount');

  // events → announcements + moments
  if (e.type === 'bid') {
    live.textContent = `${teamName(s.teams, e.bid.teamId)} bids ${short(e.bid.amount)}`;
    if (wasLeading && s.leader !== you.id) { live.textContent += '. You were outbid.'; if (navigator.vibrate && !reduced()) navigator.vibrate(30); }
  }
  wasLeading = s.leader === you.id;
  if (e.type === 'sold') {
    const won = s.leader === you.id;
    ceremony.sold(s.player!.name, inr(s.current), won ? `${you.name} — yours` : teamName(s.teams, s.leader));
    live.textContent = `Sold. ${s.player!.name} to ${teamName(s.teams, s.leader)} for ${inr(s.current)}.`;
    if (won && navigator.vibrate && !reduced()) navigator.vibrate([20, 60, 40]);
    setTimeout(() => ceremony.hide(), reduced() ? 2200 : 3600);
  }
  if (e.type === 'unsold') { ceremony.unsold(s.player!.name); setTimeout(() => ceremony.hide(), 1700); }
  if (e.type === 'conn') handleConn(s);
}

/* Narrated resync: the room re-earns trust out loud (EP-10) */
function handleConn(s: SimState) {
  const panel = $('#resync');
  const steps = Array.from(panel.querySelectorAll<HTMLElement>('.step'));
  const you = s.teams.find(t => t.you)!;
  if (s.conn === 'offline') {
    panel.classList.add('on');
    steps.forEach(st => st.classList.remove('done'));
    steps[0].classList.add('done');
  } else if (s.conn === 'reconnecting') {
    steps[1].classList.add('done');
  } else if (s.conn === 'live' && panel.classList.contains('on')) {
    ($('#resyncFacts') as HTMLElement).innerHTML =
      `Purse <span class="money">${short(you.purse - you.spent)}</span> · ` +
      (S?.phase === 'live'
        ? `${S.leader === you.id ? 'you lead' : teamName(S!.teams, S!.leader) + ' leads'} at <span class="money">${short(S!.current)}</span>`
        : 'no lot live');
    steps[2].classList.add('done');
    setTimeout(() => panel.classList.remove('on'), reduced() ? 900 : 1600);
    live.textContent = 'Reconnected. ' + ($('#resyncFacts') as HTMLElement).textContent;
  }
}

const wire = follow(render, {}, () => new Sim());

/* Bid input: tap for routine amounts, hold for heavy ones */
const btn = $('#bid') as HTMLButtonElement;
let holdT0 = 0, holdRaf = 0;
const fill = document.createElement('div'); fill.className = 'hold-fill'; btn.appendChild(fill);
const commit = () => {
  const you = S!.teams.find(t => t.you)!;
  wire.bid(you.id);
  if (navigator.vibrate && !reduced()) navigator.vibrate(12);
};
const startPress = (e: Event) => {
  if (btn.disabled || !S || S.phase !== 'live') return;
  e.preventDefault();
  const needHold = nextBid(S) >= HOLD_THRESHOLD && !reduced();
  if (!needHold) { commit(); return; }
  holdT0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - holdT0) / 600);
    fill.style.transform = `scaleX(${k})`;
    if (k >= 1) { endPress(); commit(); } else holdRaf = requestAnimationFrame(tick);
  };
  holdRaf = requestAnimationFrame(tick);
};
const endPress = () => { cancelAnimationFrame(holdRaf); fill.style.transform = 'scaleX(0)'; };
btn.addEventListener('pointerdown', startPress);
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, endPress));
btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { if (!e.repeat) startPress(e); } });
btn.addEventListener('keyup', () => endPress());

makeDev([
  { label: 'Disconnect', onClick: () => wire.local()?.simulateDisconnect() },
  { label: 'Unsold next', onClick: () => wire.local()?.forceUnsoldNext() },
]);
