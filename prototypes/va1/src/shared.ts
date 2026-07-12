// VA-1 shared helpers: direction/motion switches, Indian money formatting,
// countdown ring, number roll, hold-to-commit (EP-6), ceremony, dev drawer.

export const inr = (n: number): string => {
  const s = Math.round(n).toString();
  if (s.length <= 3) return '₹' + s;
  return '₹' + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
};
export const short = (n: number): string => {
  const t = (x: number) => (Math.round(x * 100) / 100).toString();
  if (n >= 1e7) return '₹' + t(n / 1e7) + 'Cr';
  if (n >= 1e5) return '₹' + t(n / 1e5) + 'L';
  if (n >= 1e3) return '₹' + t(n / 1e3) + 'k';
  return '₹' + n;
};

/* Direction + motion persistence */
export function initChrome(): void {
  const html = document.documentElement;
  html.dataset.dir = localStorage.getItem('va1dir') || 'A';
  html.dataset.motion = localStorage.getItem('va1motion') || 'full';
}
export function setDir(d: 'A' | 'B'): void {
  document.documentElement.dataset.dir = d; localStorage.setItem('va1dir', d);
}
export function setMotion(m: 'full' | 'reduced'): void {
  document.documentElement.dataset.motion = m; localStorage.setItem('va1motion', m);
}
export const reduced = (): boolean =>
  document.documentElement.dataset.motion === 'reduced' ||
  (matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motion !== 'full');

/* Rolling money value — the number travels, it never teleports (§9) */
export function rollMoney(el: HTMLElement, to: number, fmt: (n: number) => string = short): void {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(); const dur = 240;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

/* Countdown ring bound to state.endsAt (client interpolates; truth is the timestamp) */
export function makeRing(mount: HTMLElement, size = 120): { update: (endsAt: number, live: boolean) => void; pop: () => void } {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  mount.classList.add('ring-wrap');
  mount.innerHTML = `<svg width="${size}" height="${size}">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"/>
      <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"
        stroke-dasharray="${c}" stroke-dashoffset="0"/></svg>
    <div class="ring-num" style="font-size:${size * .3}px"></div>`;
  const arc = mount.querySelector('.ring-arc') as SVGCircleElement;
  const num = mount.querySelector('.ring-num') as HTMLElement;
  let endsAt = 0, live = false;
  const frame = () => {
    if (live) {
      const left = Math.max(0, endsAt - Date.now());
      const frac = Math.min(1, left / 24_000);
      arc.style.strokeDashoffset = String(c * (1 - frac));
      arc.classList.toggle('closing', left < 5000);
      num.textContent = String(Math.ceil(left / 1000));
      num.style.color = left < 5000 ? 'var(--warn)' : 'var(--text)';
    } else { num.textContent = '·'; arc.style.strokeDashoffset = String(c); arc.classList.remove('closing'); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    update: (e, l) => { endsAt = e; live = l; },
    pop: () => {
      if (reduced()) return;
      const p = document.createElement('div');
      p.className = 'extend-pop'; p.textContent = '+12s';
      mount.appendChild(p); setTimeout(() => p.remove(), 1400);
    },
  };
}

/* Hold-to-commit: weight communicates irreversibility (EP-6) */
export function holdButton(btn: HTMLElement, ms: number, onCommit: () => void): void {
  let t0 = 0; let raf = 0; let fill = btn.querySelector('.hold-fill') as HTMLElement | null;
  if (!fill) { fill = document.createElement('div'); fill.className = 'hold-fill'; btn.appendChild(fill); }
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    fill!.style.transform = `scaleX(${k})`;
    if (k >= 1) { cancel(); onCommit(); } else raf = requestAnimationFrame(tick);
  };
  const start = (e: Event) => { e.preventDefault(); if ((btn as HTMLButtonElement).disabled) return;
    if (reduced()) { onCommit(); return; } t0 = performance.now(); raf = requestAnimationFrame(tick); };
  const cancel = () => { cancelAnimationFrame(raf); fill!.style.transform = 'scaleX(0)'; };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, cancel));
  btn.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === ' ' && !e.repeat) start(e); });
  btn.addEventListener('keyup', e => { if ((e as KeyboardEvent).key === ' ') cancel(); });
}

/* Ceremony controller — plays, then settles into stillness (finality) */
export function makeCeremony(root: HTMLElement): { sold: (name: string, amount: string, team: string) => void; unsold: (name: string) => void; hide: () => void } {
  root.className = 'ceremony';
  root.innerHTML = `<div class="c-inner">
      <div class="c-kind"></div><div class="c-name display"></div>
      <div class="c-amount"></div><div class="c-team"></div></div>`;
  const q = (sel: string) => root.querySelector(sel) as HTMLElement;
  const show = (kind: 'sold' | 'unsold', name: string, amount: string, team: string) => {
    q('.c-kind').textContent = kind === 'sold' ? 'SOLD' : 'PASSES · RETURNS TO POOL';
    q('.c-kind').className = 'c-kind ' + kind;
    q('.c-name').textContent = name;
    q('.c-amount').textContent = amount;
    q('.c-amount').className = 'c-amount' + (kind === 'unsold' ? ' muted' : '');
    q('.c-team').innerHTML = team;
    root.classList.add('on');
    root.classList.remove('play', 'still'); void root.offsetWidth;
    root.classList.add(reduced() ? 'still' : 'play');
  };
  return {
    sold: (n, a, t) => show('sold', n, a, `to <b>${t}</b>`),
    unsold: (n) => show('unsold', n, '', ''),   // neutral fact, then the night moves on (EP-7)
    hide: () => root.classList.remove('on', 'play', 'still'),
  };
}

/* Recovery banner — narrated resync (EP-10) */
export function makeBanner(): { show: (msg: string, tone?: 'warn' | 'ok' | 'err') => void; hide: () => void } {
  const el = document.createElement('div'); el.className = 'banner';
  el.innerHTML = `<span class="dot"></span><span class="msg"></span>`;
  document.body.appendChild(el);
  let hideT = 0;
  return {
    show: (msg, tone = 'warn') => {
      clearTimeout(hideT);
      el.className = `banner on ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`;
      (el.querySelector('.msg') as HTMLElement).textContent = msg;
      if (tone === 'ok') hideT = window.setTimeout(() => el.classList.remove('on'), 2600);
    },
    hide: () => el.classList.remove('on'),
  };
}

/* Dev drawer — evidence-instrument controls, shared across pages */
export function makeDev(extra: { label: string; onClick: () => void }[] = []): void {
  const t = document.createElement('button'); t.className = 'dev-toggle'; t.textContent = '⚙'; t.title = 'Prototype controls';
  const d = document.createElement('div'); d.className = 'dev';
  d.innerHTML = `<h4>Direction</h4><div class="row dir">
      <button data-d="A">A · Floodlight</button><button data-d="B">B · Maidan</button></div>
    <h4>Motion</h4><div class="row mo">
      <button data-m="full">Full</button><button data-m="reduced">Reduced</button></div>
    ${extra.length ? '<h4>Simulate</h4><div class="row ex"></div>' : ''}
    <div class="fps"></div>`;
  document.body.append(t, d);
  t.onclick = () => d.classList.toggle('on');
  const sync = () => {
    d.querySelectorAll<HTMLElement>('.dir button').forEach(b => b.classList.toggle('active', b.dataset.d === document.documentElement.dataset.dir));
    d.querySelectorAll<HTMLElement>('.mo button').forEach(b => b.classList.toggle('active', b.dataset.m === document.documentElement.dataset.motion));
  };
  d.querySelectorAll<HTMLElement>('.dir button').forEach(b => b.onclick = () => { setDir(b.dataset.d as 'A' | 'B'); sync(); });
  d.querySelectorAll<HTMLElement>('.mo button').forEach(b => b.onclick = () => { setMotion(b.dataset.m as 'full' | 'reduced'); sync(); });
  const ex = d.querySelector('.ex');
  extra.forEach(x => { const b = document.createElement('button'); b.textContent = x.label; b.onclick = x.onClick; ex?.appendChild(b); });
  sync();
  // fps: evidence for A-V4 (motion budget on modest devices)
  const fpsEl = d.querySelector('.fps') as HTMLElement;
  let frames = 0, last = performance.now();
  const loop = (t2: number) => { frames++; if (t2 - last > 1000) { fpsEl.textContent = `${frames} fps`; frames = 0; last = t2; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

export const teamName = (teams: { id: string; name: string; short: string }[], id: string | null): string =>
  id ? (teams.find(t => t.id === id)?.name ?? '—') : '—';
