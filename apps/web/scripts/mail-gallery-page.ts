// The gallery page `mail-gallery.ts` fills with every rendered mail. Plain
// HTML with one small script: a list of mails, the inbox line, and the mail at
// phone and desktop width in srcdoc frames. The mail itself is never styled
// by this page — what the frame shows is exactly the document we send.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DesiAuction mail gallery</title>
<style>
  :root { --bg:#F7F6F2; --panel:#FFFFFF; --sunken:#F0EEE8; --rule:#E7E4DC; --heading:#1A1814; --text:#2B2822; --muted:#58534A; --gold:#F0B43C; --gold-edge:#B57F14; --gold-ink:#865D12; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Devanagari", sans-serif; }
  .app { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:100vh; }
  aside { border-right:1px solid var(--rule); background:var(--panel); padding:16px; overflow:auto; max-height:100vh; position:sticky; top:0; }
  aside h1 { margin:0 0 4px; font-size:16px; color:var(--heading); }
  aside p { margin:0 0 12px; color:var(--muted); font-size:13px; }
  input[type=search] { width:100%; padding:8px 10px; border:1px solid var(--rule); border-radius:8px; font:inherit; margin-bottom:10px; }
  .list { display:grid; gap:2px; }
  .list button { text-align:left; font:inherit; border:0; background:transparent; padding:7px 9px; border-radius:7px; cursor:pointer; color:var(--text); }
  .list button[aria-current="true"] { background:var(--gold); color:#070A0F; font-weight:700; }
  .list button small { color:var(--muted); display:block; font-size:11.5px; }
  main { padding:20px 24px 48px; display:grid; gap:18px; align-content:start; }
  .bar { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  .seg { display:inline-flex; background:var(--sunken); border:1px solid var(--rule); border-radius:10px; padding:3px; gap:2px; }
  .seg button { font:inherit; font-weight:600; border:0; background:transparent; color:var(--muted); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .seg button[aria-pressed="true"] { background:var(--gold); color:#070A0F; box-shadow:inset 0 0 0 1px var(--gold-edge); }
  .inbox { background:var(--panel); border:1px solid var(--rule); border-radius:12px; padding:12px 16px; max-width:680px; display:grid; gap:2px; }
  .inbox b { color:var(--heading); }
  .inbox span { color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .meta { color:var(--muted); font-size:13px; }
  .frames { display:grid; grid-template-columns:390px 680px; gap:24px; align-items:start; overflow-x:auto; }
  .frames h2 { margin:0 0 8px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); }
  iframe { display:block; border:1px solid var(--rule); border-radius:14px; background:#fff; height:900px; }
  #phone { width:390px; } #desk { width:680px; }
  :focus-visible { outline:2px solid var(--gold-edge); outline-offset:2px; }
</style>
</head>
<body>
<div class="app">
  <aside>
    <h1>Mail gallery</h1>
    <p id="count"></p>
    <input type="search" id="q" placeholder="Filter by kind" aria-label="Filter mails">
    <div class="list" id="list"></div>
  </aside>
  <main>
    <div class="bar">
      <div class="seg" id="lang" aria-label="Language"><button data-v="en">English</button><button data-v="hi">हिन्दी</button></div>
      <div class="seg" id="theme" aria-label="Theme"><button data-v="light">Light</button><button data-v="dark">Dark</button></div>
      <span class="meta" id="meta"></span>
    </div>
    <div class="inbox" aria-live="polite"><b id="subj"></b><span id="pre"></span></div>
    <div class="frames">
      <section><h2>Phone · 390 px</h2><iframe id="phone" title="Mail at phone width"></iframe></section>
      <section><h2>Desktop · 680 px</h2><iframe id="desk" title="Mail at desktop width"></iframe></section>
    </div>
  </main>
</div>
<script>
  const MAILS = /*__DATA__*/[];
  const groups = [...new Map(MAILS.map((m) => [m.kind + "." + m.variant, m])).values()];
  const state = { key: groups[0].kind + "." + groups[0].variant, lang: "en", theme: "light", q: "" };
  document.getElementById("count").textContent = MAILS.length + " mails · " + groups.length + " kinds and versions";
  const fit = (f) => { try { f.style.height = Math.max(400, f.contentDocument.documentElement.scrollHeight) + "px"; } catch (e) {} };
  for (const f of document.querySelectorAll("iframe")) f.addEventListener("load", () => { fit(f); setTimeout(() => fit(f), 120); });
  function current() {
    return MAILS.find((m) => m.kind + "." + m.variant === state.key && m.lang === state.lang)
      || MAILS.find((m) => m.kind + "." + m.variant === state.key);
  }
  function draw() {
    const list = document.getElementById("list"); list.textContent = "";
    for (const g of groups) {
      const key = g.kind + "." + g.variant;
      if (state.q && !key.includes(state.q)) continue;
      const b = document.createElement("button");
      b.innerHTML = g.label.replace(/</g, "&lt;") + "<small>" + MAILS.filter((m) => m.kind + "." + m.variant === key).map((m) => m.lang).join(" · ") + (g.plain ? " · plain text" : "") + "</small>";
      b.setAttribute("aria-current", String(key === state.key));
      b.onclick = () => { state.key = key; draw(); };
      list.append(b);
    }
    const m = current();
    const html = state.theme === "dark" ? m.dark : m.light;
    document.getElementById("phone").srcdoc = html;
    document.getElementById("desk").srcdoc = html;
    document.getElementById("subj").textContent = m.subject;
    document.getElementById("pre").textContent = m.preheader;
    document.getElementById("meta").textContent = m.id + " · " + m.kb + " KB" + (m.lang !== state.lang ? " · not sent in this language" : "");
    for (const [id, k] of [["lang", "lang"], ["theme", "theme"]]) for (const b of document.getElementById(id).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === state[k]));
  }
  for (const [id, k] of [["lang", "lang"], ["theme", "theme"]]) document.getElementById(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state[k] = b.dataset.v; draw(); } });
  document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value.trim(); draw(); });
  draw();
</script>
</body>
</html>
`;
