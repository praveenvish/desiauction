const views = {
  home: "Home",
  delivery: "Cricket scoring",
  timed: "Timed scoring",
  placement: "Round entry",
  public: "Public match",
  auction: "Auction room",
};
let state = {
  view: new URLSearchParams(location.search).get("view") ?? "home",
  scenario: "ready",
  runs: 86,
  balls: ["1", "0", "4", "1"],
  pending: 0,
  goals: 2,
  awayGoals: 1,
  scorer: "",
  assist: "",
  side: "home",
  clockRunning: true,
  collapsed: {},
  rounds: 0,
  kills: {},
  placements: {},
  publicTab: "live",
  bid: 125000,
  events: [],
  finished: false,
};
if (!views[state.view]) state.view = "home";
const viewStates = Object.fromEntries(
  Object.keys(views).map((view) => [view, { ...structuredClone(state), view }]),
);
state = viewStates[state.view];
function selectView(view) {
  state = viewStates[views[view] ? view : "home"];
  if (state.view === "public") {
    state.runs = viewStates.delivery.runs;
    state.balls = [...viewStates.delivery.balls];
    state.finished = viewStates.delivery.finished;
  }
}
const rosters = {
  home: [
    ["h7", "Aarav Mehta · 7"],
    ["h11", "Rohan Shah · 11"],
  ],
  away: [
    ["a9", "Dev Kumar · 9"],
    ["a4", "Ishaan Patel · 4"],
  ],
};
const playerLabel = (id) => rosters[state.side].find((p) => p[0] === id)?.[1] ?? "Unattributed";
const main = document.querySelector("#main");
const button = (label, action, primary = false, extra = "") =>
  `<button type="button" data-action="${action}" ${extra} class="${primary ? "primary" : ""}">${label}</button>`;
const link = (label, view, primary = false) =>
  `<a class="button ${primary ? "primary" : ""}" href="/?view=${view}">${label}</a>`;
const strip = () => {
  const messages =
    state.view === "public"
      ? {
          ready: "Example visible snapshot · through18:42 · read18:42",
          delayed: "Delayed example · through18:40 · read18:42",
          waiting: "Updates unavailable · last visible snapshot18:42",
          empty: "Example match unavailable · no eligible details",
        }
      : state.view === "auction"
        ? {
            ready: "Connected example · last bid acknowledged",
            offline: "Disconnected example · bidding disabled",
            waiting: "Awaiting connection example · bidding disabled",
            claim: "Permission lost example · bidding disabled",
            rejected: "Example bid rejected · amount unchanged",
            empty: "Example room unavailable",
          }
        : {
            ready: "Example accepted state",
            offline: "Offline example · stored on this device",
            rejected: "Example rejected · no change accepted",
            claim: "Example claim lost · entry disabled",
            waiting: "Example waiting · no accepted change",
            empty: "Example unavailable · no eligible data",
          };
  return `<div class="state-strip" role="status"><strong>${messages[state.scenario]}</strong>${state.pending ? `<span>${state.pending} example entries pending for this fixture. Accepted state remains unchanged.</span>` : ""}</div>`;
};
const scenario = () => {
  const entries =
    state.view === "public"
      ? [
          ["ready", "Visible snapshot"],
          ["delayed", "Delayed snapshot"],
          ["waiting", "Updates unavailable"],
          ["empty", "Match unavailable"],
        ]
      : [
          ["ready", "Ready / accepted example"],
          ["offline", "Offline / pending example"],
          ["rejected", "Rejected example"],
          ["claim", "Claim / permission lost example"],
          ["waiting", "Waiting example"],
          ["empty", "Unavailable / empty example"],
        ];
  return `<div class="field"><label for="scenario">Explore a design state</label><select id="scenario">${entries.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><p class="note">Synthetic outcomes for design review. Production acceptance and authorisation are unchanged.</p>`;
};
const context = (role, back = "home") =>
  `<div class="context"><a href="/?view=${back}">← ${back === "home" ? "Home" : views[back]}</a><small>Monsoon Cup · ${role} · Example workspace</small></div>`;
const recent = () =>
  `<section class="panel"><p class="eyebrow">RECENT EXAMPLE EVENTS</p><h2>What changed</h2><ol class="timeline">${
    state.events.length
      ? state.events
          .slice(-5)
          .reverse()
          .map((e) => `<li>${e}</li>`)
          .join("")
      : "<li><strong>18:42</strong> · Example match resumed</li><li><strong>18:41</strong> · Example score accepted</li>"
  }</ol><p class="note">Pending and rejected entries never appear as accepted history.</p></section>`;
const side = () =>
  `<aside class="stack">${recent()}<section class="panel"><h2>Review this journey</h2>${scenario()}<div class="retention">Back keeps supported example input. No real queue, claim or account is used.</div></section></aside>`;
function home() {
  if (state.scenario === "empty")
    return `${context("Signed-in person")}<h1>No tasks available</h1><section class="panel"><p>No eligible tasks are available in this example scope.</p>${link("Explore public match", "public")}${scenario()}</section>`;
  return `${context("Organiser + scorer")}<p class="eyebrow">SUNDAY, 11 OCTOBER · MATCH DAY</p><h1>Good evening, Aarav.</h1><p class="lead">Your live match comes first. The rest of your responsibilities stay within reach.</p><div class="workspace"><div class="stack"><section class="hero"><div class="score-head"><span class="tag">Live · Scorer</span><span class="note">Fixture MC-12 · Riverside Ground</span></div><h2 style="margin-top:24px">Tigers vs Falcons</h2><div class="score">86/2 <small>12.4 overs</small></div><p>Continue scoring from the last accepted ball.</p>${link("Continue scoring →", "delivery", true)}<p class="note">Your supported fixture-bound queue stays with this fixture.</p></section><section class="panel"><h2>Also needs your attention</h2><div class="row"><div><h3>Monsoon Cup auction</h3><p>Team owner · Room live</p></div>${link("Open room", "auction")}</div><div class="row"><div><h3>Football · Evening fixture</h3><p>Scorer · Match ready at 19:00</p></div>${link("Open match", "timed")}</div><div class="row"><div><h3>Lobby · Round 3</h3><p>Scorer · All squads required</p></div>${link("Enter round", "placement")}</div></section></div><aside class="stack"><section class="panel"><p class="eyebrow">MONSOON CUP · ORGANISER</p><h2>Match-day readiness</h2><div class="row"><span>Squads confirmed</span><strong>8 / 8</strong></div><div class="row"><span>Officials assigned</span><strong>4 / 4</strong></div><div class="row"><span>Fixtures published</span><strong>4 / 4</strong></div><p class="note">Example readiness. In production each action uses current season grants.</p>${link("View public match", "public")}</section><section class="panel"><h2>One person, several roles</h2><p class="lead">Each task names its team, season and responsibility. Opening one never switches your permissions.</p>${scenario()}</section></aside></div>`;
}
function delivery() {
  const disabled = ["claim", "empty"].includes(state.scenario) || state.finished ? "disabled" : "";
  return `${context("Scorer")}<p class="eyebrow">CRICKET · FIXTURE MC-12</p><h1>Tigers vs Falcons</h1>${strip()}<div class="workspace"><div class="stack"><section class="hero"><div class="score-head"><h2>Tigers batting</h2><span class="tag">${state.finished ? "Example finished" : "1st innings · T20"}</span></div><div class="score">${state.runs}/2 <small>12.4 overs</small></div><div class="row"><div><h3>Aarav Mehta *</h3><p>On strike · 32 (24)</p></div><div><h3>Rohan Shah</h3><p>24 (18)</p></div></div><p class="note">Bowler · Dev Kumar · 2–0–14–1</p><div class="keys" aria-label="Runs for this delivery">${[0, 1, 2, 3, 4, 6].map((n) => button(String(n), `run:${n}`, false, `aria-label="Record ${n} runs in example" ${disabled}`)).join("")}</div><div class="actions">${button("Extras", "extras", false, disabled)}${button("Wicket", "wicket", false, disabled)}${button("Undo last ball", "undo", false, disabled)}</div></section><section class="panel"><h2>This over</h2><div class="ball-row">${state.balls.map((n) => `<span class="ball">${n}</span>`).join("")}</div><div class="actions">${link("Watch example live", "public")}${button("Finish match", "finish", false, state.pending ? "disabled" : disabled)}</div><p class="note">Finish and correction always expose the consequence before confirmation.</p></section></div>${side()}</div>`;
}
function timed() {
  const disabled = ["claim", "empty"].includes(state.scenario) || state.finished ? "disabled" : "";
  return `${context("Scorer")}<p class="eyebrow">FOOTBALL · FIXTURE MC-14</p><h1>Every event, in context.</h1>${strip()}<div class="workspace"><div class="stack"><section class="hero"><div class="split-score"><div><h2>Tigers</h2><div class="score">${state.goals}</div></div><div class="clock">62:18<p class="note">Second half<br>${state.clockRunning ? "Example running" : "Example paused"}</p></div><div><h2>Falcons</h2><div class="score">${state.awayGoals}</div></div></div>${button(state.clockRunning ? "Pause example clock" : "Resume example clock", "clock", false, disabled)}</section><section class="panel"><h2>Record a goal</h2><fieldset><legend>Attributed team</legend><div class="segments">${button("Tigers", "side:home", false, `aria-pressed="${state.side === "home"}"`)}${button("Falcons", "side:away", false, `aria-pressed="${state.side === "away"}"`)}</div></fieldset><div class="field"><label for="scorer">Goal scorer · ${state.side === "home" ? "Tigers" : "Falcons"}</label><select id="scorer"><option value="">Select a player / unattributed</option>${rosters[state.side].map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></div><div class="field"><label for="assist">Assist (optional)</label><select id="assist"><option value="">No assist recorded</option>${rosters[
    state.side
  ]
    .filter(([id]) => id !== state.scorer)
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join(
      "",
    )}</select></div>${button("Record example goal", "goal", true, disabled)}<div class="actions">${button("Card / substitution", "event-options", false, disabled)}${button("Finish match", "finish", false, state.pending ? "disabled" : disabled)}</div><p class="note">Other sport formats keep their canonical periods and legal point choices.</p></section></div>${side()}</div>`;
}
function placement() {
  return `${context("Scorer")}<p class="eyebrow">BATTLE ROYALE · ROUND 3</p><h1>One round. Every squad.</h1>${strip()}<div class="workspace"><section class="panel"><h2>Squad results</h2><p class="note">${state.rounds} example rounds accepted. Tied placements are allowed.</p><p class="lead">Enter placement and every player's kills. Zero is a valid entry. A collapsed squad keeps its inputs.</p>${["Tigers", "Falcons"].map((name, i) => `<details class="squad" data-squad="${i}" ${state.collapsed[i] ? "" : "open"}><summary>${name} · ${i === 0 ? "Represented squad" : "Other participating squad"}</summary><div class="field"><label for="placement-${i}">${name} placement</label><input id="placement-${i}" type="number" min="1" max="2" required value="${state.placements[i] ?? ""}" data-placement="${i}"></div>${["Aarav", "Rohan", "Dev", "Ishaan"].map((player, j) => `<div class="player-row"><label for="kills-${i}-${j}">${player} · kills</label><input id="kills-${i}-${j}" type="number" min="0" value="${state.kills[`${i}-${j}`] ?? 0}" data-kills="${i}-${j}"></div>`).join("")}</details>`).join("")}<div class="actions">${button("Review round", "round", true, ["claim", "empty"].includes(state.scenario) ? "disabled" : "")}${button("Undo last round", "undo")}</div><p class="note">Example has two squads of four. Production must retain every participating squad and roster entry, limits, ties and exclusions.</p></section><aside class="stack"><section class="hero"><p class="eyebrow">COMPLETENESS</p><h2>Review before saving</h2><p>Placement is required for both squads. Player kills remain explicit, including zero.</p><p class="note">Result confirmation stays with the current eligible managers of every other participating squad.</p></section><section class="panel"><h2>Review this journey</h2>${scenario()}</section>${recent()}</aside></div>`;
}
function publicMatch() {
  if (state.scenario === "empty")
    return `${context("Public spectator")}<h1>Match unavailable</h1>${strip()}<section class="panel"><h2>These details are unavailable</h2><p>Private, withdrawn or ineligible information is not shown.</p>${scenario()}</section>`;
  return `${context("Public spectator")}<p class="eyebrow">MONSOON CUP · RIVERSIDE GROUND</p><h1>Tigers vs Falcons</h1>${strip()}<div class="workspace"><div class="stack"><section class="hero"><div class="score-head"><h2>Tigers</h2><span class="tag">${state.finished && state.scenario !== "delayed" ? "Example result" : "Example live · 1st innings"}</span></div><div class="score">${state.scenario === "delayed" ? 80 : state.runs}/2 <small>${state.scenario === "delayed" ? "12.0" : "12.4"} overs</small></div><p>${state.scenario === "delayed" ? "Snapshot run rate · 6.67" : "Snapshot run rate · 6.79"}</p><p class="note">${state.scenario === "delayed" ? "Delayed example: visible through 18:40 · read at 18:42. This is an earlier eligible snapshot, not current scoring." : "Example snapshot through 18:42 · read at 18:42."}</p></section><section class="panel"><div class="segments" aria-label="Match detail views">${button("Live", "tab:live", false, `aria-pressed="${state.publicTab === "live"}"`)}${button("Scorecard", "tab:scorecard", false, `aria-pressed="${state.publicTab === "scorecard"}"`)}</div>${state.scenario === "empty" ? '<div class="empty"><h3>These details are unavailable</h3><p>Private, ineligible or missing details are not filled with invented statistics.</p></div>' : state.publicTab === "live" ? `<h2>Last over</h2><div class="ball-row">${(state.scenario === "delayed" ? ["0", "1", "0"] : state.balls).map((n) => `<span class="ball">${n}</span>`).join("")}</div><p class="note">The same visibility and trust policy applies to commentary and charts.</p>` : `<table class="stat-table"><caption>Tigers · example batting scorecard</caption><thead><tr><th scope="col">Batter</th><th scope="col">Runs (balls)</th></tr></thead><tbody><tr><td>Aarav Mehta *</td><td>${state.scenario === "delayed" ? "28 (23)" : "32 (24)"}</td></tr><tr><td>Rohan Shah</td><td>24 (18)</td></tr></tbody></table>`}</section></div><aside class="stack"><section class="panel"><h2>Follow the match</h2><p>Know what changed, and when this visible snapshot was updated.</p>${button("Copy example public link", "share")}<p class="note">No bearer token or private profile details enter this example link.</p></section><section class="panel"><h2>Review this journey</h2>${scenario()}</section></aside></div>`;
}
function auction() {
  return `${context("Team owner · Tigers")}<p class="eyebrow">MONSOON CUP · AUCTION LIVE</p><h1>Your next bid, clearly.</h1>${strip()}<div class="workspace"><div class="stack"><section class="hero"><div class="player-hero"><div class="jersey" aria-hidden="true">07</div><div><p class="eyebrow">PLAYER ON THE BLOCK · EXAMPLE #24</p><h2>Aarav Mehta</h2><p>All-rounder · Right-hand bat</p><span class="tag">Falcons leading</span></div></div><p class="note" style="margin-top:24px">Current accepted example bid</p><div class="score">₹${state.bid.toLocaleString("en-IN")}</div><p>Next example bid · ₹${(state.bid + 5000).toLocaleString("en-IN")}</p>${button(`Review bid ₹${(state.bid + 5000).toLocaleString("en-IN")}`, "bid", true, ["claim", "offline", "waiting", "empty"].includes(state.scenario) ? "disabled" : "")}<p class="note">This button opens a consequence review. Only an engine acknowledgement establishes a real bid.</p></section><section class="panel"><h2>Your team · Tigers</h2><div class="metrics"><div><strong>₹4,00,000</strong><span>Purse available</span></div><div><strong>8 / 16</strong><span>Squad places</span></div><div><strong>₹2,50,000</strong><span>Spend so far</span></div></div><p class="note">Amounts are examples. Production enforces purse and slot rules on each bid.</p>${button("View example squad", "squad")}</section></div>${side()}</div>`;
}
function render(focus = false) {
  if (state.view === "placement")
    document.querySelectorAll("[data-squad]").forEach((el) => {
      state.collapsed[el.dataset.squad] = !el.open;
    });
  const active = document.activeElement;
  const focusedId = active?.id;
  const focusedAction = active?.dataset?.action;
  document.querySelector("#navigation").innerHTML = Object.entries(views)
    .map(
      ([id, name]) =>
        `<a href="/?view=${id}" ${state.view === id ? 'aria-current="page"' : ""}>${name}</a>`,
    )
    .join("");
  main.innerHTML = { home, delivery, timed, placement, public: publicMatch, auction }[state.view]();
  document.querySelector("#scenario").value = state.scenario;
  if (document.querySelector("#scorer")) document.querySelector("#scorer").value = state.scorer;
  if (document.querySelector("#assist")) document.querySelector("#assist").value = state.assist;
  document.title = `${views[state.view]} · DesiAuction design study`;
  if (focus) main.focus();
  else {
    const target = focusedId
      ? document.getElementById(focusedId)
      : focusedAction
        ? main.querySelector(`[data-action="${CSS.escape(focusedAction)}"]`)
        : null;
    if (target && !target.disabled) target.focus();
    else if (focusedAction) main.focus();
  }
}
function notify(message) {
  const n = document.querySelector("#notice");
  n.textContent = message;
  n.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    n.hidden = true;
  }, 5000);
}
let confirmAction;
function confirm(title, copy, action) {
  document.querySelector("#dialog-title").textContent = title;
  document.querySelector("#dialog-copy").textContent = copy;
  confirmAction = action;
  document.querySelector("#dialog").showModal();
  document.querySelector("#cancel-dialog").focus();
}
function accept(message, action) {
  if (["claim", "empty"].includes(state.scenario)) {
    notify("Example claim lost. Entry is disabled.");
    return;
  }
  if (state.scenario === "rejected") {
    notify("Example rejected. Accepted state is unchanged; review and retry.");
    return;
  }
  if (["offline", "waiting"].includes(state.scenario)) {
    state.pending++;
    render();
    notify("Example pending. Accepted state is unchanged.");
    return;
  }
  action();
  state.events.push(message);
  render();
  notify(`${message} · example only`);
}
document.addEventListener("click", (event) => {
  const anchor = event.target.closest('a[href^="/?view="]');
  if (anchor) {
    event.preventDefault();
    selectView(new URL(anchor.href).searchParams.get("view"));
    history.pushState({}, "", anchor.getAttribute("href"));
    render(true);
    return;
  }
  const a = event.target.closest("[data-action]")?.dataset.action;
  if (!a) return;
  if (a.startsWith("run:")) {
    const n = Number(a.split(":")[1]);
    accept(`${n} runs accepted`, () => {
      state.runs += n;
      state.balls.push(String(n));
    });
  } else if (a === "undo" && state.view === "placement")
    confirm(
      "Correct the last example round",
      "This corrects a whole example round; it never modifies cricket history.",
      () =>
        accept("Example round corrected", () => {
          state.rounds = Math.max(0, state.rounds - 1);
        }),
    );
  else if (a === "undo")
    confirm(
      "Review correction",
      "This example corrects the last entry. Production appends a correction and preserves accepted history.",
      () =>
        accept("Example correction accepted", () => {
          const n = Number(state.balls.pop());
          if (Number.isFinite(n)) state.runs -= n;
        }),
    );
  else if (a === "finish" && state.pending)
    notify("Pending entries must resolve before example finalisation.");
  else if (a === "finish")
    confirm(
      "Finish this example match?",
      "Review the terminal result before confirming. Production validates canonical completion and independently eligible result confirmations.",
      () =>
        accept("Example match finished", () => {
          state.finished = true;
        }),
    );
  else if (a === "extras" || a === "wicket")
    confirm(
      a === "extras" ? "Example extra choice" : "Example wicket choice",
      "Production sheets preserve every legal extra or dismissal, batter attribution and correction rules. This study demonstrates the return flow only.",
      () => notify("Example choice reviewed. No canonical event was recorded."),
    );
  else if (a === "clock")
    accept("Example clock changed", () => {
      state.clockRunning = !state.clockRunning;
    });
  else if (a.startsWith("side:")) {
    state.side = a.split(":")[1];
    state.scorer = "";
    state.assist = "";
    render();
  } else if (a === "goal")
    confirm(
      "Review attributed goal",
      `Example team: ${state.side === "home" ? "Tigers" : "Falcons"}. Goal scorer: ${playerLabel(state.scorer)}. Assist: ${state.assist ? playerLabel(state.assist) : "None recorded"}. Clock:62:18, second half.`,
      () =>
        accept("Example goal accepted", () => {
          if (state.side === "home") state.goals++;
          else state.awayGoals++;
        }),
    );
  else if (a === "event-options")
    confirm(
      "Event controls",
      "Card and substitution production controls retain active-player, bench and disciplinary limits. This example demonstrates secondary control disclosure.",
      () => notify("Returned to event workspace."),
    );
  else if (a === "round") {
    const ranks = Object.values(state.placements);
    if (Object.values(state.kills).some((n) => !Number.isInteger(n) || n < 0)) {
      notify("Player kills must be whole numbers of zero or more. Inputs are retained.");
      const key = Object.keys(state.kills).find(
        (key) => !Number.isInteger(state.kills[key]) || state.kills[key] < 0,
      );
      const field = document.getElementById(`kills-${key}`);
      field.closest("details").open = true;
      field.focus();
      return;
    }
    if (ranks.length !== 2 || ranks.some((n) => !Number.isInteger(n) || n < 1 || n > 2)) {
      notify("Enter a placement of 1 or 2 for each example squad. Inputs are retained.");
      const invalid =
        [0, 1].find(
          (i) =>
            !Number.isInteger(state.placements[i]) ||
            state.placements[i] < 1 ||
            state.placements[i] > 2,
        ) ?? 0;
      const field = document.querySelector(`#placement-${invalid}`);
      field.closest("details").open = true;
      state.collapsed[invalid] = false;
      field.focus();
      return;
    }
    confirm(
      "Review both squad results",
      ["Tigers", "Falcons"]
        .map(
          (name, i) =>
            `${name}: placement ${state.placements[i]}, kills ${[0, 1, 2, 3].reduce((sum, j) => sum + (state.kills[`${i}-${j}`] ?? 0), 0)} (zeroes included).`,
        )
        .join(" ") + " No real result is written.",
      () =>
        accept("Example round saved", () => {
          state.rounds++;
        }),
    );
  } else if (a.startsWith("tab:")) {
    state.publicTab = a.split(":")[1];
    render();
  } else if (a === "share")
    notify("Example public address: /c/monsoon-cup/m/MC-12. No token copied.");
  else if (a === "bid")
    confirm(
      `Example bid ₹${(state.bid + 5000).toLocaleString("en-IN")} for Tigers`,
      `Example remaining purse after this bid: ₹${(400000 - state.bid - 5000).toLocaleString("en-IN")}. This is a prototype, not a real bid.`,
      () =>
        accept("Example bid acknowledged", () => {
          state.bid += 5000;
        }),
    );
  else if (a === "squad")
    confirm(
      "Tigers · example squad",
      "8 of 16 places filled. Production roster, retention and slot eligibility remain available.",
      () => notify("Returned to the live room."),
    );
});
document.addEventListener("change", (event) => {
  if (event.target.id === "scorer") {
    state.scorer = event.target.value;
    if (state.assist === state.scorer) state.assist = "";
    render();
  }
  if (event.target.id === "assist") state.assist = event.target.value;
  if (event.target.id === "scenario") {
    state.scenario = event.target.value;
    render();
  }
  if (event.target.dataset.placement !== undefined)
    state.placements[event.target.dataset.placement] = Number(event.target.value);
  if (event.target.dataset.kills !== undefined)
    state.kills[event.target.dataset.kills] = Number(event.target.value);
});
document.querySelector("#theme").addEventListener("click", () => {
  const light = document.documentElement.dataset.theme === "daylight";
  document.documentElement.dataset.theme = light ? "floodlight" : "daylight";
  const b = document.querySelector("#theme");
  b.textContent = light ? "Daylight" : "Floodlight";
  b.setAttribute("aria-label", `Switch to ${light ? "Daylight" : "Floodlight"} theme`);
});
document
  .querySelector("#cancel-dialog")
  .addEventListener("click", () => document.querySelector("#dialog").close());
document.querySelector("#confirm-dialog").addEventListener("click", () => {
  document.querySelector("#dialog").close();
  confirmAction?.();
});
window.addEventListener("popstate", () => {
  selectView(new URLSearchParams(location.search).get("view") ?? "home");
  render(true);
});
render();
