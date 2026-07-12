(() => {
  // src/sim.ts
  var TIMER_INITIAL = 24e3;
  var TIMER_EXTENSION = 12e3;
  var increment = (cur) => Math.max(25e3, Math.round(cur * 0.08 / 25e3) * 25e3);
  var nextBid = (s) => s.bids.length === 0 ? s.player.base : s.current + increment(s.current);
  var P = (id, name, role, base, opts = {}) => ({ id, name, role, base, value: base * (1.8 + Math.random() * 3) * (opts.marquee ? 1.6 : 1), ...opts });
  function makeState() {
    const queue = [
      P("p1", "Rohit Deshmukh", "BAT", 2e5, { marquee: true, sub: "Opening batter \xB7 Sitapur" }),
      P("p2", "\u0905\u0930\u094D\u091C\u0941\u0928 \u092A\u0935\u093E\u0930", "ALL", 1e5, { sub: "Arjun Pawar \xB7 All-rounder" }),
      P("p3", "Imran Shaikh", "BOWL", 1e5, { sub: "Left-arm quick" }),
      P("p4", "\u0938\u093E\u0939\u093F\u0932 \u091C\u093E\u0927\u0935", "WK", 75e3, { sub: "Sahil Jadhav \xB7 Keeper-bat" }),
      P("p5", "Devang Patel", "BAT", 75e3, { sub: "Middle order" }),
      P("p6", "\u092A\u094D\u0930\u0915\u093E\u0936 \u092F\u093E\u0926\u0935", "BOWL", 5e4, { sub: "Prakash Yadav \xB7 Off-spin" }),
      P("p7", "Sunil Kambli", "ALL", 125e3, { marquee: true, sub: "Captain material" }),
      P("p8", "Faisal Khan", "BOWL", 5e4, { sub: "Death overs" })
    ];
    const T = (id, name, short2, hue, you = false) => ({ id, name, short: short2, purse: 9e6, spent: 0, squad: 0, hue, you, aggression: 0.35 + Math.random() * 0.5 });
    return {
      seq: 0,
      phase: "idle",
      conn: "live",
      lotNo: 0,
      player: null,
      current: 0,
      leader: null,
      bids: [],
      endsAt: 0,
      extended: false,
      teams: [
        T("t1", "Sitapur Strikers", "SS", 84, true),
        T("t2", "Nadi Royals", "NR", 210),
        T("t3", "Bazaar Titans", "BT", 28),
        T("t4", "Kila Falcons", "KF", 330)
      ],
      queue,
      results: [],
      auto: false
    };
  }
  var Sim = class {
    s = makeState();
    listeners = [];
    aiTimer = null;
    clock = null;
    ceremonyTimer = null;
    onEvent(fn) {
      this.listeners.push(fn);
      fn(this.s, { type: "sync" });
    }
    emit(e) {
      this.s.seq++;
      this.listeners.forEach((f) => f(this.s, e));
    }
    start() {
      if (this.clock != null) return;
      this.clock = window.setInterval(() => this.tick(), 120);
    }
    stop() {
      if (this.clock != null) {
        clearInterval(this.clock);
        this.clock = null;
      }
      if (this.aiTimer) clearTimeout(this.aiTimer);
      if (this.ceremonyTimer) clearTimeout(this.ceremonyTimer);
      this.listeners = [];
    }
    tick() {
      const s = this.s;
      if (s.phase === "live" && s.conn === "live" && Date.now() >= s.endsAt) this.close();
    }
    openNext() {
      const s = this.s;
      if (s.phase === "live" || s.queue.length === 0) return;
      s.player = s.queue.shift();
      s.lotNo++;
      s.phase = "live";
      s.bids = [];
      s.current = 0;
      s.leader = null;
      s.endsAt = Date.now() + TIMER_INITIAL;
      s.extended = false;
      this.emit({ type: "open" });
      this.scheduleAI();
    }
    canBid(teamId) {
      const s = this.s;
      if (s.phase !== "live") return { ok: false, reason: "No live lot" };
      if (s.conn !== "live") return { ok: false, reason: "Reconnecting" };
      if (s.leader === teamId) return { ok: false, reason: "You lead" };
      const t = s.teams.find((t2) => t2.id === teamId);
      if (nextBid(s) > t.purse - t.spent) return { ok: false, reason: "Purse limit" };
      return { ok: true };
    }
    bid(teamId) {
      if (!this.canBid(teamId).ok) return false;
      const s = this.s;
      const amount = nextBid(s);
      const b = { teamId, amount, at: Date.now() };
      s.bids.push(b);
      s.current = amount;
      s.leader = teamId;
      const newEnd = Math.max(s.endsAt, Date.now() + TIMER_EXTENSION);
      if (newEnd > s.endsAt + 400) {
        s.endsAt = newEnd;
        s.extended = true;
        this.emit({ type: "extend", by: TIMER_EXTENSION });
      }
      this.emit({ type: "bid", bid: b });
      this.scheduleAI();
      return true;
    }
    scheduleAI() {
      if (this.aiTimer) clearTimeout(this.aiTimer);
      const s = this.s;
      if (s.phase !== "live") return;
      const delay = 900 + Math.random() * 2400;
      this.aiTimer = window.setTimeout(() => {
        if (s.phase !== "live" || s.conn !== "live") return;
        const price = nextBid(s);
        const rivals = s.teams.filter((t) => !t.you && t.id !== s.leader && price <= t.purse - t.spent && price <= s.player.value * (0.6 + t.aggression * 0.55));
        if (rivals.length && Math.random() < 0.82) {
          const r = rivals[Math.floor(Math.random() * rivals.length)];
          this.bid(r.id);
        } else {
          this.scheduleAI();
        }
      }, delay);
    }
    close() {
      const s = this.s;
      if (s.phase !== "live") return;
      if (this.aiTimer) clearTimeout(this.aiTimer);
      if (s.leader) {
        const t = s.teams.find((t2) => t2.id === s.leader);
        t.spent += s.current;
        t.squad++;
        s.results.unshift({ player: s.player.name, team: t.short, amount: s.current });
        s.phase = "sold";
        this.emit({ type: "sold" });
      } else {
        s.results.unshift({ player: s.player.name, team: null, amount: 0 });
        s.phase = "unsold";
        this.emit({ type: "unsold" });
      }
      if (this.ceremonyTimer) clearTimeout(this.ceremonyTimer);
      this.ceremonyTimer = window.setTimeout(() => {
        s.phase = "idle";
        this.emit({ type: "sync" });
        if (s.auto && s.queue.length) window.setTimeout(() => {
          if (s.phase === "idle") this.openNext();
        }, 2200);
      }, 4200);
    }
    pause() {
      if (this.s.phase === "live") {
        this.s.phase = "paused";
        this.emit({ type: "pause" });
      }
    }
    resume() {
      if (this.s.phase !== "paused") return;
      this.s.phase = "live";
      this.s.endsAt = Math.max(this.s.endsAt, Date.now() + 8e3);
      this.emit({ type: "resume" });
      this.scheduleAI();
    }
    setAuto(v) {
      this.s.auto = v;
      this.emit({ type: "sync" });
      if (v && this.s.phase === "idle") this.openNext();
    }
    /* Failure theatre — EP-10 is tested, not assumed */
    simulateDisconnect(ms = 4200) {
      const s = this.s;
      if (s.conn !== "live") return;
      s.conn = "offline";
      this.emit({ type: "conn", conn: "offline" });
      const wasEnd = s.endsAt;
      window.setTimeout(() => {
        s.conn = "reconnecting";
        this.emit({ type: "conn", conn: "reconnecting" });
      }, ms * 0.45);
      window.setTimeout(() => {
        s.conn = "live";
        if (s.phase === "live") s.endsAt = Math.max(wasEnd, Date.now() + 6e3);
        this.emit({ type: "conn", conn: "live" });
        this.scheduleAI();
      }, ms);
    }
    simulateStall(ms = 3600) {
      const s = this.s;
      if (s.conn !== "live") return;
      s.conn = "stalled";
      this.emit({ type: "conn", conn: "stalled" });
      window.setTimeout(() => {
        s.conn = "live";
        if (s.phase === "live") s.endsAt = Math.max(s.endsAt, Date.now() + 6e3);
        this.emit({ type: "conn", conn: "live" });
        this.scheduleAI();
      }, ms);
    }
    forceUnsoldNext() {
      const s = this.s;
      if (s.queue.length) {
        s.queue[0].value = 0;
        this.emit({ type: "sync" });
      }
    }
  };
  function follow(onState, intent, makeLocal, graceMs = 700) {
    const ch = new BroadcastChannel("va1");
    let driven = false;
    let local = null;
    ch.onmessage = (m) => {
      if (m.data.kind === "driver-here") driven = true;
      if (m.data.kind === "state") {
        driven = true;
        if (local) {
          local.stop();
          local = null;
        }
        onState(m.data.s, m.data.e);
      }
    };
    ch.postMessage({ kind: "who-drives" });
    window.setTimeout(() => {
      if (!driven) {
        local = makeLocal();
        local.onEvent(onState);
        local.start();
        local.setAuto(true);
      }
    }, graceMs);
    return {
      bid: (teamId) => {
        if (local) local.bid(teamId);
        else ch.postMessage({ kind: "intent", action: "bid", teamId });
      },
      local: () => local
    };
  }

  // src/shared.ts
  var inr = (n) => {
    const s = Math.round(n).toString();
    if (s.length <= 3) return "\u20B9" + s;
    return "\u20B9" + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
  };
  var short = (n) => {
    const t = (x) => (Math.round(x * 100) / 100).toString();
    if (n >= 1e7) return "\u20B9" + t(n / 1e7) + "Cr";
    if (n >= 1e5) return "\u20B9" + t(n / 1e5) + "L";
    if (n >= 1e3) return "\u20B9" + t(n / 1e3) + "k";
    return "\u20B9" + n;
  };
  function initChrome() {
    const html = document.documentElement;
    html.dataset.dir = localStorage.getItem("va1dir") || "A";
    html.dataset.motion = localStorage.getItem("va1motion") || "full";
  }
  function setDir(d) {
    document.documentElement.dataset.dir = d;
    localStorage.setItem("va1dir", d);
  }
  function setMotion(m) {
    document.documentElement.dataset.motion = m;
    localStorage.setItem("va1motion", m);
  }
  var reduced = () => document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "full";
  function rollMoney(el, to, fmt = short) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = String(to);
    if (reduced() || from === to) {
      el.textContent = fmt(to);
      return;
    }
    const t0 = performance.now();
    const dur = 240;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = fmt(to);
    };
    requestAnimationFrame(step);
  }
  function makeRing(mount, size = 120) {
    const r = (size - 10) / 2, c = 2 * Math.PI * r;
    mount.classList.add("ring-wrap");
    mount.innerHTML = `<svg width="${size}" height="${size}">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"/>
      <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"
        stroke-dasharray="${c}" stroke-dashoffset="0"/></svg>
    <div class="ring-num" style="font-size:${size * 0.3}px"></div>`;
    const arc = mount.querySelector(".ring-arc");
    const num = mount.querySelector(".ring-num");
    let endsAt = 0, live = false;
    const frame = () => {
      if (live) {
        const left = Math.max(0, endsAt - Date.now());
        const frac = Math.min(1, left / 24e3);
        arc.style.strokeDashoffset = String(c * (1 - frac));
        arc.classList.toggle("closing", left < 5e3);
        num.textContent = String(Math.ceil(left / 1e3));
        num.style.color = left < 5e3 ? "var(--warn)" : "var(--text)";
      } else {
        num.textContent = "\xB7";
        arc.style.strokeDashoffset = String(c);
        arc.classList.remove("closing");
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return {
      update: (e, l) => {
        endsAt = e;
        live = l;
      },
      pop: () => {
        if (reduced()) return;
        const p = document.createElement("div");
        p.className = "extend-pop";
        p.textContent = "+12s";
        mount.appendChild(p);
        setTimeout(() => p.remove(), 1400);
      }
    };
  }
  function makeCeremony(root) {
    root.className = "ceremony";
    root.innerHTML = `<div class="c-inner">
      <div class="c-kind"></div><div class="c-name display"></div>
      <div class="c-amount"></div><div class="c-team"></div></div>`;
    const q = (sel) => root.querySelector(sel);
    const show = (kind, name, amount, team) => {
      q(".c-kind").textContent = kind === "sold" ? "SOLD" : "PASSES \xB7 RETURNS TO POOL";
      q(".c-kind").className = "c-kind " + kind;
      q(".c-name").textContent = name;
      q(".c-amount").textContent = amount;
      q(".c-amount").className = "c-amount" + (kind === "unsold" ? " muted" : "");
      q(".c-team").innerHTML = team;
      root.classList.add("on");
      root.classList.remove("play", "still");
      void root.offsetWidth;
      root.classList.add(reduced() ? "still" : "play");
    };
    return {
      sold: (n, a, t) => show("sold", n, a, `to <b>${t}</b>`),
      unsold: (n) => show("unsold", n, "", ""),
      // neutral fact, then the night moves on (EP-7)
      hide: () => root.classList.remove("on", "play", "still")
    };
  }
  function makeBanner() {
    const el = document.createElement("div");
    el.className = "banner";
    el.innerHTML = `<span class="dot"></span><span class="msg"></span>`;
    document.body.appendChild(el);
    let hideT = 0;
    return {
      show: (msg, tone = "warn") => {
        clearTimeout(hideT);
        el.className = `banner on ${tone === "ok" ? "ok" : tone === "err" ? "err" : ""}`;
        el.querySelector(".msg").textContent = msg;
        if (tone === "ok") hideT = window.setTimeout(() => el.classList.remove("on"), 2600);
      },
      hide: () => el.classList.remove("on")
    };
  }
  function makeDev(extra = []) {
    const t = document.createElement("button");
    t.className = "dev-toggle";
    t.textContent = "\u2699";
    t.title = "Prototype controls";
    const d = document.createElement("div");
    d.className = "dev";
    d.innerHTML = `<h4>Direction</h4><div class="row dir">
      <button data-d="A">A \xB7 Floodlight</button><button data-d="B">B \xB7 Maidan</button></div>
    <h4>Motion</h4><div class="row mo">
      <button data-m="full">Full</button><button data-m="reduced">Reduced</button></div>
    ${extra.length ? '<h4>Simulate</h4><div class="row ex"></div>' : ""}
    <div class="fps"></div>`;
    document.body.append(t, d);
    t.onclick = () => d.classList.toggle("on");
    const sync = () => {
      d.querySelectorAll(".dir button").forEach((b) => b.classList.toggle("active", b.dataset.d === document.documentElement.dataset.dir));
      d.querySelectorAll(".mo button").forEach((b) => b.classList.toggle("active", b.dataset.m === document.documentElement.dataset.motion));
    };
    d.querySelectorAll(".dir button").forEach((b) => b.onclick = () => {
      setDir(b.dataset.d);
      sync();
    });
    d.querySelectorAll(".mo button").forEach((b) => b.onclick = () => {
      setMotion(b.dataset.m);
      sync();
    });
    const ex = d.querySelector(".ex");
    extra.forEach((x) => {
      const b = document.createElement("button");
      b.textContent = x.label;
      b.onclick = x.onClick;
      ex?.appendChild(b);
    });
    sync();
    const fpsEl = d.querySelector(".fps");
    let frames = 0, last = performance.now();
    const loop = (t2) => {
      frames++;
      if (t2 - last > 1e3) {
        fpsEl.textContent = `${frames} fps`;
        frames = 0;
        last = t2;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  var teamName = (teams, id) => id ? teams.find((t) => t.id === id)?.name ?? "\u2014" : "\u2014";

  // src/stage.ts
  initChrome();
  document.body.classList.add("stage");
  var $ = (s) => document.querySelector(s);
  var ring = makeRing($("#ring"), Math.min(150, innerWidth * 0.14));
  var ceremony = makeCeremony($("#ceremony"));
  var banner = makeBanner();
  var roleNames = { BAT: "Batter", BOWL: "Bowler", ALL: "All-rounder", WK: "Wicket-keeper" };
  var lastPhase = "";
  function render(s, e) {
    $("#lotNo").textContent = s.player ? `Lot ${String(s.lotNo).padStart(2, "0")} \xB7 ${s.queue.length} to come` : `${s.queue.length} in pool`;
    if (s.player) {
      $("#pRole").textContent = (s.player.marquee ? "\u2605 Marquee \xB7 " : "") + roleNames[s.player.role];
      $("#pName").textContent = s.player.name;
      $("#pSub").textContent = s.player.sub || "";
      $("#pBase").innerHTML = `Base price <span class="money">${short(s.player.base)}</span>`;
    }
    const waiting = s.bids.length === 0;
    $("#bidbox").classList.toggle("s-wait", waiting);
    $("#curLabel").textContent = waiting ? "Opening at" : "Current bid";
    rollMoney($("#cur"), waiting && s.player ? s.player.base : s.current);
    $("#leader").innerHTML = waiting ? '<span class="dim">Awaiting first bid</span>' : `with <b>${teamName(s.teams, s.leader)}</b>`;
    ring.update(s.endsAt, s.phase === "live" && s.conn === "live");
    $("#book").innerHTML = s.results.slice(0, 8).map((r) => `<div class="s-sale"><span class="who">${r.player}</span>${r.team ? `<span class="amt">${short(r.amount)}</span><span class="who">${r.team}</span>` : `<span class="amt pass">passes</span>`}</div>`).join("");
    $("#purses").innerHTML = s.teams.map((t) => `<div class="s-purse"><div class="tn">${t.short}</div><div class="tv">${short(t.purse - t.spent)}</div></div>`).join("");
    const resting = s.phase === "idle";
    $("#rest").classList.toggle("on", resting);
    if (resting) $("#restName").textContent = s.queue[0] ? s.queue[0].name : "That\u2019s the auction";
    if (resting) $("#restLabel").textContent = s.queue[0] ? "Next on the block" : "All lots complete";
    if (e.type === "extend") ring.pop();
    if (e.type === "sold") {
      ceremony.sold(s.player.name, inr(s.current), teamName(s.teams, s.leader));
      setTimeout(() => ceremony.hide(), reduced() ? 2400 : 3900);
    }
    if (e.type === "unsold") {
      ceremony.unsold(s.player.name);
      setTimeout(() => ceremony.hide(), 1900);
    }
    if (e.type === "conn") {
      if (e.conn === "offline") banner.show("Signal lost \xB7 the record is safe \xB7 rejoining\u2026", "warn");
      else if (e.conn === "reconnecting") banner.show("Rejoining the auction\u2026", "warn");
      else if (e.conn === "stalled") banner.show("Feed paused \xB7 bids continue to be recorded", "warn");
      else banner.show("Live \xB7 fully caught up", "ok");
    }
    if (s.phase === "paused" && lastPhase !== "paused") banner.show("Auction paused by the auctioneer", "warn");
    if (lastPhase === "paused" && s.phase === "live") banner.show("Auction resumes", "ok");
    lastPhase = s.phase;
  }
  var wire = follow(render, {}, () => new Sim());
  makeDev([
    { label: "Projector scale", onClick: () => {
      const h = document.documentElement;
      h.dataset.projector = h.dataset.projector === "1" ? "0" : "1";
    } },
    { label: "Disconnect", onClick: () => wire.local()?.simulateDisconnect() },
    { label: "Unsold next", onClick: () => wire.local()?.forceUnsoldNext() }
  ]);
})();
