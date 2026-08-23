# DesiAuction social post templates

Three reusable post templates, 1080 × 1350 px (Instagram's 4:5 feed size).

| Template | File | What it's for |
|---|---|---|
| T1 — Statement | `t1-statement.html` | One sentence, very large. One word underlined in Volt. |
| T2 — Number | `t2-number.html` | One enormous figure with a small label above it. |
| T7 — Ledger | `t7-ledger.html` | Terminal-style proof rows. The trust format. |

Each `.html` file makes one `.png`. The `.png` is the file you upload to Instagram.

---

## How to change the words

Open the `.html` file in any text editor (TextEdit, Notepad, VS Code — anything).
Near the bottom of the file there is a block that starts with:

```
<!-- ====== COPY — ... ====== -->
```

…and ends with:

```
<!-- ==================== end copy ==================== -->
```

**Only change text inside that block.** Everything above it is fonts and layout.
If you delete something above it by accident, close the file without saving and start again.

### T1 — `t1-statement.html`, lines 52–57

```html
<p class="statement">Somewhere<br>
tonight, an<br>
argument is<br>
starting about<br>
a bid nobody<br>
<span class="op">wrote down</span>.</p>
```

- Each `<br>` is a **line break you control**. The text does not wrap on its own — you
  decide where each line ends. Type your sentence, put `<br>` where you want a new line.
- `<span class="op">…</span>` puts the **Volt underline** under whatever is inside it.
  Wrap it around the one word or short phrase that carries the point. **Use it once only.**
- Aim for **5 or 6 lines**, with the longest line no wider than about **14 characters**.
  If a line runs off the right edge, break it earlier or drop the font size.
- Font size lives on **line 32** (`font-size:124px; line-height:132px;`). If your copy is
  longer, step both down together in fours: 120/128, 116/124, and so on. Keep the
  line-height about 8px larger than the font size.

### T2 — `t2-number.html`, lines 60 and 62

```html
<p class="label">Moves in one evening. On a spreadsheet.</p>
<p class="numeral">&#8377;2,00,000</p>
```

- **Line 60** is the small grey label. Type it in normal sentence case — it is
  turned into CAPITALS automatically. Keep it to one line (about 40 characters).
- **Line 62** is the big figure. `&#8377;` is the rupee sign — leave it as it is and
  change only the digits after it.
- Use **Indian digit grouping**: `2,00,000` — not `200,000`.
- The figure is sized to fill the width for **9 characters** (`₹2,00,000`). If your
  number is longer or shorter, adjust `font-size` and `line-height` on **line 42**
  together, keeping line-height 8px above the font size:
  - 7 characters (`₹80,000`) → about `font-size:208px; line-height:216px;`
  - 9 characters (`₹2,00,000`) → `font-size:184px; line-height:192px;` (as shipped)
  - 11 characters (`₹1,20,00,000`) → about `font-size:132px; line-height:140px;`
  Re-render and check the figure does not touch the right edge.
- The small Volt dash above the label is the one accent. Do not add a second one.

### T7 — `t7-ledger.html`, lines 65–72

```html
<div class="ledger"><span class="head">seq   event          lot               amount</span></div>
<div class="rule"></div>
<div class="ledger"><span class="row">0041  bid.placed     Player 12        &#8377;75,000</span>
<span class="row">0042  bid.placed     Player 12        &#8377;80,000</span>
<span class="lit">0043  lot.sold       Player 12        &#8377;80,000</span></div>

<p class="note">A bid, once recorded, cannot be edited or deleted.<br>
By anyone. Including us.</p>
```

- This is **fixed-width type**: every character, including a space, is the same width.
  The columns line up because the spaces are counted, not because anything is centred.
- **Every ledger line is exactly 45 characters long.** Count them. Columns start at:
  `seq` = character 1, `event` = 7, `lot` = 22, and the `amount` column **ends** at 45
  (amounts are right-aligned, so pad with spaces *before* the ₹, not after).
  If you add a character somewhere, remove a space in the same gap to stay at 45.
- `class="row"` = a normal white line. `class="lit"` = **the one Volt line.**
  Exactly one line may be `lit`. If you move the highlight, change the old `lit`
  back to `row` first.
- **Line 71–72** is the small sentence underneath. `<br>` sets where it breaks.
- **Lot names must stay placeholders** — `Player 12`, `Player 3`, `Lot 07`.
  Never put a real player's name or a real bid in a template. This is a hard brand rule.
- You can add or remove ledger rows: copy a whole `<span class="row">…</span>` line and
  paste it. Above 5 rows, reduce `line-height` on **line 36** from `72px` to `56px`.

---

## How to make the PNG again after editing

Open a terminal in this folder and run:

```
node render-html.js t1-statement.html
```

That writes `t1-statement.png` next to it. To rebuild all three at once:

```
node render-html.js t1-statement.html t2-number.html t7-ledger.html
```

Other sizes (width then height at the end) — for a 1:1 square, for example:

```
node render-html.js t1-statement.html t1-square.png 1080 1080
```

You only need this once, if `node render-html.js` complains it can't find Playwright:

```
npm install playwright
```

You can also just **open the `.html` file in Chrome** to preview it before rendering.
It will look correct, because the fonts are built into the file.

---

## The rules these templates already follow — don't break them

- **Ink field `#0B1018`.** Never pure black, never a photo, never a gradient.
- **Exactly one Volt `#CDF53C` element per post.** One underline, or one dash, or one
  ledger line. Never two. Never a second accent colour.
- **No gold.** Gold is reserved for SOLD and champion artwork. These are not that.
- **No bold heavier than 600.** No 700, no Black. Restraint is the look.
- **Nothing centred.** Everything sits on the left margin at 96px.
- **Nothing critical in the top or bottom 15% of the frame.** Instagram's profile grid
  crops the post, and the middle 70% is the part that always survives. All the copy and
  the logo already sit inside it — if you add anything, keep it between **y 203 and 1148**.
- **The mark is a signature, not a hero.** Bottom-left, 56px tall. Don't enlarge it,
  don't recolour it, don't add a wordmark next to it.
- **Never publish fabricated auction data.** Placeholder lots only.

## Files

```
t1-statement.html   t1-statement.png
t2-number.html      t2-number.png
t7-ledger.html      t7-ledger.png
render-html.js      README.md
```

Each `.html` is fully self-contained — the Geist fonts are embedded inside it, so you can
email the file, open it on another machine, and it will still look identical.
