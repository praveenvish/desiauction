import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { LEAGUE, LIVE_LOT, POOL, STAR_LOT, TEAMS, price } from "../../../content/home-story";
import styles from "../../../app/home.module.css";
import { Glyph } from "./glyphs";
import { SwipeDots } from "./swipe";

/**
 * 2 · ONE AUCTION NIGHT. Five moments of the example night, hour by hour.
 *
 * Written once as an ordered list, so it reads in order to everyone — a
 * screen reader, a browser without scroll-driven animation, a visitor who
 * asked for less motion. Where scroll timelines run, the CSS pins the stage
 * and the scroll becomes the clock: captions and screens slide through their
 * `data-state`, and the price climbs while "going… going…" is on screen.
 */
type State = "pool" | "lot" | "bidding" | "sold" | "board";

const MOMENTS: readonly { state: State; time: string; title: ReactNode; text: string }[] = [
  {
    state: "pool",
    time: "6:00 pm",
    title: "The pool is set.",
    text: `${String(LEAGUE.lots)} players, imported from your Google Form with their photos — or signed up through one link on the team WhatsApp. Four teams, ${price(LEAGUE.purse)} each.`,
  },
  {
    state: "lot",
    time: "7:40 pm",
    title: `Lot ${String(STAR_LOT.lot)} is up.`,
    text: `${STAR_LOT.player.name}, ${STAR_LOT.player.role.toLowerCase()}. Owners are in the hall — or on their sofas — and every paddle is a phone. No app to install.`,
  },
  {
    state: "bidding",
    time: "7:41 pm",
    title: "Going… going…",
    text: "Every bid lands on every screen at the same moment, and the server checks each one against the purse.",
  },
  {
    state: "sold",
    time: "7:42 pm",
    title: <span className={styles.sold}>SOLD.</span>,
    text: `${STAR_LOT.player.name.split(" ")[0] ?? ""} goes to ${STAR_LOT.soldTo} for ${price(STAR_LOT.price)}. The room erupts — and he gets a card with his price to share.`,
  },
  {
    state: "board",
    time: "8:05 pm",
    title: "The board keeps score.",
    text: `Spend, purses and squads update after every gavel — ${String(LIVE_LOT.sold)} of ${String(LEAGUE.lots)} sold and counting. Tomorrow: fixtures and receipts, same place.`,
  },
];

const TINTS = ["#2A3550", "#3A2F1A", "#1F3A33", "#3A2230", "#2E2A45"];

export function Night() {
  const star = STAR_LOT.player;
  return (
    <section id="night" className={styles.story} aria-labelledby="night-title">
      <div className={styles.stage}>
        <div>
          <h2 id="night-title" className={styles.kicker}>
            One auction night · scroll the clock
          </h2>
          <div className={styles.clockBox} aria-hidden="true">
            <div className={[styles.clock, styles.num].join(" ")}>
              {MOMENTS.map((moment) => (
                <span key={moment.state}>{moment.time}</span>
              ))}
            </div>
          </div>
          <ol className={styles.captions}>
            {MOMENTS.map((moment) => (
              <li key={moment.state} className={styles.caption} data-state={moment.state}>
                <span className={styles.captionTime}>{moment.time}</span>
                <h3>{moment.title}</h3>
                <p className={styles.lead}>{moment.text}</p>
              </li>
            ))}
          </ol>
          <div className={styles.steps} aria-hidden="true">
            {MOMENTS.map((moment) => (
              <i key={moment.state}>
                <b />
              </i>
            ))}
          </div>
        </div>

        {/* The big screen in the hall. Decorative: the list above says it all. */}
        <div className={styles.room} aria-hidden="true">
          <div className={styles.bezel}>
            <div className={styles.screen}>
              <div className={styles.layer} data-state="pool">
                <div className={styles.poolHead}>
                  <span className={styles.scap} style={{ color: "var(--green)" }}>
                    ● Registration closed · player pool
                  </span>
                  <span className={styles.scap}>{LEAGUE.name}</span>
                </div>
                <div className={styles.poolGrid}>
                  {POOL.map((player, index) => (
                    <div
                      key={player.name}
                      className={styles.poolCard}
                      data-star={player.name === star.name ? "" : undefined}
                    >
                      <span
                        className={styles.poolAvatar}
                        style={{ "--tint": TINTS[index % TINTS.length] } as CSSProperties}
                      >
                        {player.face === undefined ? (
                          player.initials
                        ) : (
                          <Image src={player.face} alt="" width={76} height={76} sizes="48px" />
                        )}
                      </span>
                      <span className={styles.poolName}>{player.name}</span>
                      <span className={styles.poolMeta}>
                        {player.role} · {price(player.base)}
                      </span>
                    </div>
                  ))}
                  <div className={[styles.poolCard, styles.poolSource].join(" ")}>
                    <Glyph name="form" size={24} />
                    <span className={styles.poolName} style={{ color: "var(--green)" }}>
                      Google Form
                    </span>
                    <span className={styles.poolMeta}>
                      {LEAGUE.lots} rows · {LEAGUE.lots} photos ✓
                    </span>
                  </div>
                </div>
                <div className={styles.poolFoot}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: "1.6cqi" }}>
                    <span className={styles.poolCount} />
                    <span className={styles.scap}>
                      players · {TEAMS.length} teams · {price(LEAGUE.purse)} purse each
                    </span>
                  </span>
                  <span className={styles.scap} style={{ color: "var(--gold-ink)" }}>
                    Lot {STAR_LOT.lot} is {star.name.split(" ")[0]} →
                  </span>
                </div>
              </div>

              <div className={[styles.layer, styles.lotUp].join(" ")} data-state="lot">
                <span className={styles.scap} style={{ color: "var(--gold-ink)" }}>
                  Lot {STAR_LOT.lot} of {LEAGUE.lots} · {star.role} · {LEAGUE.sport}
                </span>
                {star.face === undefined ? null : (
                  <Image
                    className={styles.lotFace}
                    src={star.face}
                    alt=""
                    width={160}
                    height={160}
                    sizes="20vw"
                  />
                )}
                <span className={styles.lotTitle}>{star.name}</span>
                <span className={styles.scap}>Base {price(star.base)} · paddles up</span>
              </div>

              <div className={[styles.layer, styles.bidding].join(" ")} data-state="bidding">
                <div className={styles.poolHead}>
                  <span className={styles.scap} style={{ color: "var(--gold-ink)" }}>
                    Lot {STAR_LOT.lot} · {star.name}
                  </span>
                  <span className={styles.scap}>Bids</span>
                </div>
                <div className={[styles.climb, styles.bigPrice, styles.num].join(" ")}>
                  <span>
                    {STAR_LOT.bids.map((bid, index) => (
                      <span
                        key={bid.amount}
                        style={
                          index === STAR_LOT.bids.length - 1
                            ? { color: "var(--gold-ink)" }
                            : undefined
                        }
                      >
                        {price(bid.amount)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className={[styles.climb, styles.bidder].join(" ")}>
                  <span>
                    {STAR_LOT.bids.map((bid, index) => {
                      const team = TEAMS.find((entry) => entry.name === bid.team);
                      return (
                        <span key={bid.amount} style={{ color: team?.color ?? "var(--soft)" }}>
                          {team === undefined
                            ? "Waiting for a paddle"
                            : index === STAR_LOT.bids.length - 1
                              ? `${team.name} — going, going…`
                              : team.name}
                        </span>
                      );
                    })}
                  </span>
                </div>
              </div>

              <div className={[styles.layer, styles.soldLayer].join(" ")} data-state="sold">
                <div>
                  <div className={styles.soldWord}>SOLD</div>
                  <div className={styles.soldLine}>
                    {star.name.toUpperCase()} · {STAR_LOT.soldTo.toUpperCase()} ·{" "}
                    {price(STAR_LOT.price)}
                  </div>
                </div>
                <Image
                  className={styles.soldPhone}
                  src="/marketing/product/owner-phone-sold-v2.webp"
                  alt=""
                  width={560}
                  height={933}
                  sizes="(max-width: 760px) 30vw, 240px"
                />
              </div>

              <div className={[styles.layer, styles.boardLayer].join(" ")} data-state="board">
                <Image
                  src="/marketing/product/auction-board-v2.webp"
                  alt=""
                  width={1600}
                  height={900}
                  sizes="(max-width: 900px) 100vw, 900px"
                />
              </div>
            </div>
          </div>
          <svg className={styles.crowd} preserveAspectRatio="none">
            <defs>
              <pattern id="crowd-row" width="74" height="86" patternUnits="userSpaceOnUse">
                <circle cx="37" cy="28" r="13" fill="#010203" stroke="rgba(243,208,120,.12)" />
                <path
                  d="M8 86c0-22 13-38 29-38s29 16 29 38z"
                  fill="#010203"
                  stroke="rgba(243,208,120,.09)"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#crowd-row)" />
          </svg>
          <span
            className={styles.glow}
            style={{ left: "14%", bottom: 8, transform: "rotate(-8deg)" }}
          />
          <span className={styles.glow} style={{ left: "46%", bottom: 4 }} />
          <span
            className={styles.glow}
            style={{ left: "78%", bottom: 10, transform: "rotate(10deg)" }}
          />
        </div>
      </div>

      {/* THE PHONE'S NIGHT: five cards, swiped sideways with the phone's own
          momentum. The pinned big-screen stage above is a laptop's; at phone
          width it was a miniature nobody could read, holding the page still
          for five screens. (Shown instead of the stage below 761px.) */}
      <div className={styles.nightPhone}>
        <div className={styles.phoneHead}>
          <p className={styles.kicker}>One auction night</p>
          <h2 className={[styles.display, styles.title].join(" ")}>
            6 pm to SOLD, in five swipes.
          </h2>
        </div>
        <ol
          id="night-rail"
          className={styles.rail}
          aria-label="One auction night, hour by hour"
          tabIndex={0}
        >
          {MOMENTS.map((moment, index) => (
            <li key={moment.state} className={[styles.card, styles.storyCard].join(" ")}>
              <div className={styles.storyTop}>
                <span className={[styles.display, styles.num].join(" ")}>{moment.time}</span>
                <span className={styles.cap}>
                  {index + 1} / {MOMENTS.length}
                </span>
              </div>
              <h3 className={styles.storyTitle}>{moment.title}</h3>
              <p className={styles.storyText}>{moment.text}</p>
              <div className={styles.storyVisual} aria-hidden="true">
                <StoryVisual state={moment.state} />
              </div>
            </li>
          ))}
        </ol>
        <SwipeDots railId="night-rail" />
      </div>
    </section>
  );
}

/** Each moment's picture, drawn for a phone rather than shrunk from a screen. */
function StoryVisual({ state }: { state: State }) {
  const star = STAR_LOT.player;
  if (state === "pool") {
    const faces = POOL.filter((player) => player.face !== undefined).slice(0, 2);
    return (
      <div className={styles.storyPool}>
        {faces.map((player) => (
          <span key={player.name} data-star={player.name === star.name ? "" : undefined}>
            {player.face === undefined ? null : (
              <Image src={player.face} alt="" width={80} height={80} sizes="40px" />
            )}
            <b>{player.name.split(" ")[0]}</b>
            <small>{player.role}</small>
          </span>
        ))}
        <span className={styles.storyMore}>
          <b>+{LEAGUE.lots - faces.length}</b>
          <small>from the form</small>
        </span>
      </div>
    );
  }
  if (state === "lot") {
    return (
      <div className={styles.storyLot}>
        {star.face === undefined ? null : (
          <Image src={star.face} alt="" width={128} height={128} sizes="64px" />
        )}
        <span>
          <b>{star.name}</b>
          <small>Base {price(star.base)} · paddles up</small>
        </span>
      </div>
    );
  }
  if (state === "bidding") {
    const bidders = STAR_LOT.bids.filter((bid) => bid.team !== null).slice(0, 3);
    const top = bidders[bidders.length - 1];
    return (
      <div className={styles.storyBid}>
        <b className={styles.num}>{price(top?.amount ?? star.base)}</b>
        <span>
          {bidders.map((bid, index) => {
            const team = TEAMS.find((entry) => entry.name === bid.team);
            return (
              <i key={bid.amount} style={{ "--team": team?.color } as CSSProperties}>
                {bid.team}
                {index === bidders.length - 1 ? " ↑" : ""}
              </i>
            );
          })}
        </span>
      </div>
    );
  }
  if (state === "sold") {
    return (
      <div className={styles.storySold}>
        <span>
          <b>SOLD</b>
          <small>
            {STAR_LOT.soldTo.toUpperCase()} · {price(STAR_LOT.price)}
          </small>
        </span>
        <Image
          src="/marketing/product/owner-phone-sold-v2.webp"
          alt=""
          width={168}
          height={280}
          sizes="84px"
        />
      </div>
    );
  }
  return (
    <Image
      className={styles.storyBoard}
      src="/marketing/product/auction-board-v2.webp"
      alt=""
      width={640}
      height={360}
      sizes="300px"
    />
  );
}
