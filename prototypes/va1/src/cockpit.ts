import { Sim, drive, SimState, SimEvent } from './sim';
import { initChrome, makeRing, makeBanner, makeDev, rollMoney, short, teamName, holdButton } from './shared';

initChrome();
document.body.classList.add('cockpit');

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const sim = new Sim();
const banner = makeBanner();
const ring = makeRing($('#kring'), 92);

function render(s: SimState, e: SimEvent) {
  // status chips
  $('#phase').textContent = s.phase === 'live' ? 'Live' : s.phase === 'paused' ? 'Paused' : s.phase === 'idle' ? 'Ready' : 'Settling';
  ($('#phase') as HTMLElement).className = 'chip' + (s.phase === 'live' ? ' accent' : '');
  $('#connChip').textContent = s.conn === 'live' ? 'Feed healthy' : s.conn === 'stalled' ? 'Feed stalled' : 'Reconnecting';
  ($('#connChip') as HTMLElement).className = 'chip ' + (s.conn === 'live' ? 'ok' : 'warn');

  // one next action (EP-4): what matters right now
  const idle = s.phase === 'idle' || s.phase === 'sold' || s.phase === 'unsold';
  const openBtn = $('#open') as HTMLButtonElement;
  openBtn.disabled = !(s.phase === 'idle' && s.queue.length > 0);
  openBtn.textContent = s.queue.length ? `Open next lot — ${s.queue[0].name}` : 'Pool complete';
  $('#nextLbl').textContent = s.phase === 'live' ? 'Lot in progress' : s.phase === 'paused' ? 'Auction paused' : s.queue.length ? 'Next decision' : 'All lots done';
  const gavel = $('#gavel') as HTMLButtonElement;
  gavel.disabled = s.phase !== 'live';
  gavel.classList.toggle('armed', s.phase === 'live' && Date.now() > s.endsAt - 6000);
  ($('#pause') as HTMLButtonElement).textContent = s.phase === 'paused' ? 'Resume auction' : 'Pause auction';
  ($('#pause') as HTMLButtonElement).disabled = !(s.phase === 'live' || s.phase === 'paused');
  ($('#auto') as HTMLButtonElement).textContent = `Auto-run ${s.auto ? 'on' : 'off'}`;

  // live truth
  $('#klot').textContent = s.player ? `LOT ${String(s.lotNo).padStart(2, '0')}` : '—';
  $('#knm').textContent = s.player ? s.player.name : 'No lot on the block';
  const cur = $('#kcur');
  cur.className = 'cur money roll' + (s.bids.length ? ' has' : '');
  rollMoney(cur, s.bids.length ? s.current : (s.player?.base ?? 0));
  $('#kwho').innerHTML = s.phase !== 'live' && !s.bids.length ? '' :
    s.bids.length === 0 ? '<span class="idle-hint">No bids yet · opens at base</span>'
    : `<b>${teamName(s.teams, s.leader)}</b> leads · ${s.bids.length} bid${s.bids.length > 1 ? 's' : ''}`;
  ring.update(s.endsAt, s.phase === 'live' && s.conn === 'live');
  $('#kbids').innerHTML = s.bids.slice(-3).reverse().map(b =>
    `<div class="b"><span>${teamName(s.teams, b.teamId)}</span><span class="a">${short(b.amount)}</span></div>`).join('');

  // attention rail
  $('#queue').innerHTML = s.queue.slice(0, 4).map(p =>
    `<div class="q"><span>${p.name}</span><span class="b">base ${short(p.base)}</span></div>`).join('') || '<div class="q dim">Pool complete</div>';
  const flags: string[] = [];
  s.teams.forEach(t => { const left = t.purse - t.spent;
    if (left < 1_500_000) flags.push(`<div class="f warn">${t.name} purse low · ${short(left)}</div>`); });
  if (s.extended && s.phase === 'live') flags.push('<div class="f">Timer extended by late bid</div>');
  $('#flags').innerHTML = flags.join('') || '<div class="f">Nothing needs you</div>';
  $('#teams').innerHTML = s.teams.map(t =>
    `<div class="tm"><span>${t.short} · ${t.squad} bought</span><span class="v">${short(t.purse - t.spent)} left</span></div>`).join('');
  $('#done').textContent = `${s.results.length} of ${s.results.length + s.queue.length + (s.player && s.phase === 'live' ? 1 : 0)} lots settled`;

  // events → composed reactions, never alarms
  if (e.type === 'extend') ring.pop();
  if (e.type === 'sold') banner.show(`${s.player!.name} → ${teamName(s.teams, s.leader)} · recorded`, 'ok');
  if (e.type === 'unsold') banner.show(`${s.player!.name} passes · returns to pool`, 'ok');
  if (e.type === 'conn') {
    if (s.conn === 'stalled') banner.show('Feed stalled · bids are safe · retrying…', 'warn');
    else if (s.conn === 'live') banner.show('Feed recovered · fully caught up', 'ok');
  }
}

sim.onEvent(render);
drive(sim);
sim.start();

/* Conduct */
($('#open') as HTMLButtonElement).onclick = () => sim.openNext();
holdButton($('#gavel'), 700, () => sim.close());
($('#pause') as HTMLButtonElement).onclick = () => (sim.s.phase === 'paused' ? sim.resume() : sim.pause());
($('#auto') as HTMLButtonElement).onclick = () => sim.setAuto(!sim.s.auto);

/* Keyboard-first (13): O open · Space hold to gavel · P pause */
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
  if (e.key === 'o' || e.key === 'O') sim.openNext();
  if (e.key === 'p' || e.key === 'P') (sim.s.phase === 'paused' ? sim.resume() : sim.pause());
  if (e.key === ' ') { e.preventDefault(); ($('#gavel') as HTMLElement).focus(); }
});

makeDev([
  { label: 'Stall feed', onClick: () => sim.simulateStall() },
  { label: 'Unsold next', onClick: () => sim.forceUnsoldNext() },
]);
