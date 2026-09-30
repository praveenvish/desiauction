import Image from "next/image";
import type { ReactNode } from "react";

import { LEAGUE, LIVE_LOT, STAR_LOT, price, purseLeft, PURSES } from "../../../content/home-story";
import styles from "../../../app/home.module.css";
import { Glyph, type GlyphName } from "./glyphs";
import { SeatTabs } from "./swipe";

/**
 * 4 · FOUR SEATS, ONE NIGHT. The same moment of the example night — Lot 6 on
 * the block, 5 of 17 sold — from each seat in the room. The pictures share one
 * height so no card reads emptier than its neighbour.
 */
function Seat({
  index,
  glyph,
  label,
  color,
  title,
  text,
  children,
}: {
  /** Which tab shows this seat on a phone. */
  index: number;
  glyph: GlyphName;
  label: string;
  color: string;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <li
      className={[styles.card, styles.lift, styles.seat, styles.reveal].join(" ")}
      data-seat={index}
    >
      <div className={styles.cardHead}>
        <span className={styles.tile}>
          <Glyph name={glyph} />
        </span>
        <span className={styles.cap} style={{ color }}>
          {label}
        </span>
      </div>
      <h3 className={styles.seatTitle}>{title}</h3>
      <p className={styles.seatText}>{text}</p>
      <div className={styles.seatVisual} aria-hidden="true">
        {children}
      </div>
    </li>
  );
}

export function Seats() {
  const live = LIVE_LOT.player;
  const star = STAR_LOT.player;
  const voyagers = PURSES["Voyagers"]?.before ?? LEAGUE.purse;
  return (
    <section className={styles.seats} aria-labelledby="seats-title">
      <div className={styles.wrap}>
        <div className={[styles.head, styles.reveal].join(" ")}>
          <p className={styles.kicker}>Four seats, one night</p>
          <h2 id="seats-title" className={[styles.display, styles.title].join(" ")}>
            Built for everyone in the room.
          </h2>
        </div>
        {/* A phone shows one seat at a time, chosen by these tabs. */}
        <SeatTabs listId="seat-list" labels={["Organizer", "Owner", "Player", "Fans"]} />
        <ul
          id="seat-list"
          className={styles.seatGrid}
          style={{ listStyle: "none", padding: 0 }}
          data-active="0"
          aria-label="Four seats"
        >
          <Seat
            index={0}
            glyph="gavel"
            label="The organizer"
            color="var(--gold-ink)"
            title="You run it."
            text="Set purses and rules, open registration, then conduct the night: next lot, pause, re-open — one screen."
          >
            <div className={styles.desk}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className={styles.cap}>Conductor desk</span>
                <span
                  className={styles.cap}
                  style={{ color: "var(--green)", whiteSpace: "nowrap" }}
                >
                  ● Live · {LIVE_LOT.sold}/{LEAGUE.lots}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                  Lot {LIVE_LOT.lot} · {live.name}
                </span>
                <span
                  className={styles.num}
                  style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}
                >
                  {price(LIVE_LOT.bid)}
                </span>
              </div>
              <div className={styles.bar}>
                <i />
              </div>
              <div className={styles.deskButtons}>
                <span>Sell</span>
                <span>Pause</span>
                <span>Next lot</span>
              </div>
              <span className={styles.cap} style={{ marginTop: 6 }}>
                Up next
              </span>
              {LIVE_LOT.next.map((entry) => (
                <div key={entry.lot} className={styles.row}>
                  <span className={styles.cap} style={{ width: 42 }}>
                    Lot {entry.lot}
                  </span>
                  {entry.player.name}
                  <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                    {entry.player.role}
                  </span>
                </div>
              ))}
            </div>
          </Seat>
          <Seat
            index={1}
            glyph="phone"
            label="The owner"
            color="var(--blue)"
            title="They bid."
            text="From any phone, in the hall or at home — with a private plan: their shortlist and their limit."
          >
            <div className={styles.phone}>
              <div className={styles.phoneScreen}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className={styles.cap}>Voyagers</span>
                  <span className={styles.cap}>{purseLeft(voyagers)} left</span>
                </div>
                <div className={styles.phoneLot}>
                  {live.face === undefined ? null : (
                    <Image
                      src={live.face}
                      alt=""
                      width={80}
                      height={80}
                      sizes="40px"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        objectFit: "cover",
                        margin: "0 auto 4px",
                        display: "block",
                      }}
                    />
                  )}
                  <div className={styles.cap}>Lot {LIVE_LOT.lot}</div>
                  <div style={{ fontWeight: 700, color: "var(--ink)", marginTop: 2 }}>
                    {live.name}
                  </div>
                  <div
                    className={[styles.display, styles.num].join(" ")}
                    style={{ fontSize: 30, marginTop: 6 }}
                  >
                    {price(LIVE_LOT.bid)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gold-ink)" }}>
                    {LIVE_LOT.leader} lead
                  </div>
                </div>
                <div className={styles.phoneBid}>Bid {price(LIVE_LOT.bid + 5000)}</div>
                <div className={styles.phoneChips}>
                  <span>+₹5,000</span>
                  <span>Plan · ₹60,000</span>
                </div>
              </div>
            </div>
          </Seat>
          <Seat
            index={2}
            glyph="sold"
            label="The player"
            color="var(--coral)"
            title="They get picked — and share it."
            text="Every signing gets a card with the price and the team. It ends up on WhatsApp status by midnight."
          >
            <div className={styles.phone}>
              <div className={styles.status}>
                <i />
                <i />
                <i />
              </div>
              <div className={styles.share}>
                <span className={styles.cap} style={{ color: "var(--gold-ink)" }}>
                  {LEAGUE.name}
                </span>
                {star.face === undefined ? null : (
                  <Image
                    className={styles.shareFace}
                    src={star.face}
                    alt=""
                    width={156}
                    height={156}
                    sizes="78px"
                  />
                )}
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>
                  {star.name}
                </span>
                <span className={styles.soldTag}>SOLD · {STAR_LOT.soldTo.toUpperCase()}</span>
                <span
                  className={[styles.display, styles.num].join(" ")}
                  style={{ fontSize: 34, color: "var(--gold-ink)" }}
                >
                  {price(STAR_LOT.price)}
                </span>
                <span style={{ fontSize: 11, color: "var(--soft)" }}>desiauction.in</span>
              </div>
            </div>
          </Seat>
          <Seat
            index={3}
            glyph="live"
            label="The fans"
            color="var(--violet)"
            title="Everyone else watches."
            text="A public link to watch live with no account, a stream overlay for your YouTube broadcast, and a replay of every lot."
          >
            <div className={styles.stream}>
              <Image
                src="/marketing/multisport-hero-da.webp"
                alt=""
                fill
                sizes="(max-width: 760px) 80vw, 280px"
                style={{ objectFit: "cover", objectPosition: "55% 20%" }}
              />
              <span className={styles.streamLive}>LIVE</span>
              <span className={styles.streamBug}>DesiAuction</span>
              <div className={styles.streamBar}>
                <span>
                  Lot {LIVE_LOT.lot} · {live.name}
                </span>
                <span className={styles.num} style={{ color: "var(--gold-ink)" }}>
                  {price(LIVE_LOT.bid)}
                </span>
              </div>
            </div>
            <div className={styles.desk} style={{ padding: "12px 14px", gap: 2 }}>
              <span className={styles.cap} style={{ marginBottom: 4 }}>
                Replay
              </span>
              <div className={styles.row}>
                <span className={styles.cap} style={{ width: 42 }}>
                  Lot {STAR_LOT.lot}
                </span>
                {star.name}
                <b className={styles.num} style={{ marginLeft: "auto", color: "var(--gold-ink)" }}>
                  {price(STAR_LOT.price)}
                </b>
              </div>
              <div className={styles.row}>
                <span className={styles.cap} style={{ width: 42 }}>
                  Lot 5
                </span>
                Kiran Shah
                <b className={styles.num} style={{ marginLeft: "auto", color: "var(--text)" }}>
                  {price(30000)}
                </b>
              </div>
            </div>
          </Seat>
        </ul>
      </div>
    </section>
  );
}
