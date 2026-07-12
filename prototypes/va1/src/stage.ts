import { follow, Sim, SimState, SimEvent } from './sim';
import { initChrome, makeRing, makeCeremony, makeBanner, makeDev, rollMoney, short, inr, teamName, reduced } from './shared';

initChrome();
document.body.classList.add('stage');

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const ring = makeRing($('#ring'), Math.min(150, innerWidth * .14));
const ceremony = makeCeremony($('#ceremony'));
const banner = makeBanner();

const roleNames: Record<string, string> = { BAT: 'Batter', BOWL: 'Bowler', ALL: 'All-rounder', WK: 'Wicket-keeper' };
let lastPhase = '';

function render(s: SimState, e: SimEvent) {
  // header
  $('#lotNo').textContent = s.player ? `Lot ${String(s.lotNo).padStart(2, '0')} · ${s.queue.length} to come` : `${s.queue.length} in pool`;

  // player identity — one subject (EP-4)
  if (s.player) {
    $('#pRole').textContent = (s.player.marquee ? '★ Marquee · ' : '') + roleNames[s.player.role];
    $('#pName').textContent = s.player.name;
    $('#pSub').textContent = s.player.sub || '';
    $('#pBase').innerHTML = `Base price <span class="money">${short(s.player.base)}</span>`;
  }

  // bid box
  const waiting = s.bids.length === 0;
  $('#bidbox').classList.toggle('s-wait', waiting);
  $('#curLabel').textContent = waiting ? 'Opening at' : 'Current bid';
  rollMoney($('#cur'), waiting && s.player ? s.player.base : s.current);
  $('#leader').innerHTML = waiting
    ? '<span class="dim">Awaiting first bid</span>'
    : `with <b>${teamName(s.teams, s.leader)}</b>`;
  ring.update(s.endsAt, s.phase === 'live' && s.conn === 'live');

  // order book + purses
  $('#book').innerHTML = s.results.slice(0, 8).map(r =>
    `<div class="s-sale"><span class="who">${r.player}</span>${
      r.team ? `<span class="amt">${short(r.amount)}</span><span class="who">${r.team}</span>`
             : `<span class="amt pass">passes</span>`}</div>`).join('');
  $('#purses').innerHTML = s.teams.map(t =>
    `<div class="s-purse"><div class="tn">${t.short}</div><div class="tv">${short(t.purse - t.spent)}</div></div>`).join('');

  // rest state between lots
  const resting = s.phase === 'idle';
  $('#rest').classList.toggle('on', resting);
  if (resting) $('#restName').textContent = s.queue[0] ? s.queue[0].name : 'That’s the auction';
  if (resting) $('#restLabel').textContent = s.queue[0] ? 'Next on the block' : 'All lots complete';

  // events
  if (e.type === 'extend') ring.pop();
  if (e.type === 'sold') {
    ceremony.sold(s.player!.name, inr(s.current), teamName(s.teams, s.leader));
    setTimeout(() => ceremony.hide(), reduced() ? 2400 : 3900);
  }
  if (e.type === 'unsold') {
    ceremony.unsold(s.player!.name);
    setTimeout(() => ceremony.hide(), 1900); // brief, neutral, the night moves on (EP-7)
  }
  if (e.type === 'conn') {
    if (e.conn === 'offline') banner.show('Signal lost · the record is safe · rejoining…', 'warn');
    else if (e.conn === 'reconnecting') banner.show('Rejoining the auction…', 'warn');
    else if (e.conn === 'stalled') banner.show('Feed paused · bids continue to be recorded', 'warn');
    else banner.show('Live · fully caught up', 'ok');
  }
  if (s.phase === 'paused' && lastPhase !== 'paused') banner.show('Auction paused by the auctioneer', 'warn');
  if (lastPhase === 'paused' && s.phase === 'live') banner.show('Auction resumes', 'ok');
  lastPhase = s.phase;
}

const wire = follow(render, {}, () => new Sim());

makeDev([
  { label: 'Projector scale', onClick: () => { const h = document.documentElement; h.dataset.projector = h.dataset.projector === '1' ? '0' : '1'; } },
  { label: 'Disconnect', onClick: () => wire.local()?.simulateDisconnect() },
  { label: 'Unsold next', onClick: () => wire.local()?.forceUnsoldNext() },
]);
