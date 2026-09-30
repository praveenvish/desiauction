import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { LEAGUE, PURSES, STAR_LOT, TEAMS, price, purseLeft } from "../../../content/home-story";
import styles from "../../../app/home.module.css";
import { Glyph } from "./glyphs";

/**
 * 1 · YOUR LEAGUE, ON AIR. The page opens the way an auction night looks on
 * TV: the athletes, a LIVE bug, and a lower third that bids Lot 3 up to
 * ₹85,000 and sweeps SOLD across — on a CSS loop, no JavaScript. The loop is
 * decorative (aria-hidden); its meaning is one sentence for assistive tech.
 *
 * The crests on the jerseys are part of the photograph
 * (public/marketing/multisport-hero-da.webp): the hero's only image, and the
 * page's LCP, so it is `priority` and sized to the frame it fills.
 */
const WORDS: readonly { text: string; gold?: true }[] = [
  { text: "Every" },
  { text: "league" },
  { text: "deserves" },
  { text: "an" },
  { text: "auction", gold: true },
  { text: "night.", gold: true },
];

export function Hero({
  signupHref,
  signupLabel,
  sportCount,
}: {
  signupHref: string;
  signupLabel: string;
  sportCount: number;
}) {
  const star = STAR_LOT.player;
  return (
    <section id="hero" className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroPhoto}>
        <div className={styles.heroFrame}>
          <Image
            src="/marketing/multisport-hero-da.webp"
            alt="Four players in DesiAuction team kit — cricket, basketball, football and badminton"
            fill
            priority
            sizes="(max-width: 1060px) 100vw, 82vw"
            className={styles.heroImage}
          />
        </div>
        <div className={styles.heroShade} />
        <span className={styles.bug}>
          <span className={styles.dot} aria-hidden="true" />
          LIVE ·<span className={styles.bugLong}> {LEAGUE.name.toUpperCase()} ·</span>{" "}
          <span className={styles.muted}>EXAMPLE</span>
        </span>
        <div
          className={styles.lower}
          role="img"
          aria-label={`Example: Lot ${String(STAR_LOT.lot)}, ${star.name}, bid up from ${price(star.base)} and sold to ${STAR_LOT.soldTo} for ${price(STAR_LOT.price)}.`}
        >
          <div className={styles.lowerTop} aria-hidden="true">
            <span className={styles.cap} style={{ color: "var(--gold-ink)" }}>
              Lot {STAR_LOT.lot} of {LEAGUE.lots} · {star.role} · {LEAGUE.sport}
            </span>
            <span className={[styles.cap, styles.lotBase].join(" ")}>Base {price(star.base)}</span>
          </div>
          <div className={styles.lowerMain} aria-hidden="true">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className={[styles.display, styles.lotName].join(" ")}>{star.name}</span>
              <span className={styles.paddles}>
                {TEAMS.map((team) => {
                  const bids = STAR_LOT.bids.some((bid) => bid.team === team.name);
                  return (
                    <span
                      key={team.name}
                      className={styles.pad}
                      data-bids={bids ? team.name : undefined}
                      style={{ "--team": team.color } as CSSProperties}
                    >
                      {team.initial}
                    </span>
                  );
                })}
              </span>
            </div>
            <div>
              <div className={[styles.odo, styles.num].join(" ")}>
                <div className={styles.odoCol}>
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
                </div>
              </div>
              <div className={styles.leader}>
                <div className={styles.odoCol}>
                  {STAR_LOT.bids.map((bid, index) => {
                    const team = TEAMS.find((entry) => entry.name === bid.team);
                    const last = index === STAR_LOT.bids.length - 1;
                    return (
                      <span key={bid.amount}>
                        {team === undefined ? (
                          "Opening bid"
                        ) : (
                          <>
                            <b style={{ color: team.color }}>{team.name}</b>
                            {last ? " · going, going…" : " lead"}
                          </>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className={styles.timer} aria-hidden="true">
            <i />
          </div>
          <div className={styles.purses} aria-hidden="true">
            {TEAMS.map((team) => {
              const purse = PURSES[team.name];
              return (
                <span
                  key={team.name}
                  className={styles.purse}
                  style={{ "--team": team.color } as CSSProperties}
                >
                  <span className={styles.purseName}>
                    <i />
                    {team.name}
                  </span>
                  <span className={[styles.purseLeft, styles.num].join(" ")}>
                    {purse?.after === undefined ? (
                      purseLeft(purse?.before ?? LEAGUE.purse)
                    ) : (
                      <span className={styles.purseRoll}>
                        <span>{purseLeft(purse.before)}</span>
                        <span style={{ color: "var(--gold-ink)" }}>{purseLeft(purse.after)}</span>
                      </span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
          <div className={styles.wipe} aria-hidden="true">
            <b>SOLD</b>
            <span style={{ textAlign: "right" }}>
              <span className={styles.wipeTo}>TO {STAR_LOT.soldTo.toUpperCase()}</span>
              <span className={styles.wipePrice}>{price(STAR_LOT.price)}</span>
            </span>
          </div>
        </div>
      </div>
      <div className={[styles.wrap, styles.heroIn].join(" ")}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <span className={styles.dot} aria-hidden="true" />
            Live player auctions for local leagues
          </p>
          {/* One accessible name for the headline; the words animate in as
              separate boxes, which a screen reader would otherwise read with
              gaps. */}
          <h1
            id="hero-title"
            className={[styles.display, styles.h1].join(" ")}
            aria-label="Every league deserves an auction night."
          >
            {WORDS.map((word, index) => (
              <span key={word.text} aria-hidden="true">
                <span
                  className={[styles.word, word.gold === true ? styles.gold : undefined].join(" ")}
                  style={{ "--i": index } as CSSProperties}
                >
                  {word.text}
                </span>{" "}
              </span>
            ))}
          </h1>
          <p className={styles.heroLead}>
            Owners bid from their phones. The hall watches the big screen. Every player finds out
            their price, live.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href={signupHref} data-track="hero:signup">
              <Glyph name="paddle" size={20} strokeWidth={2} />
              {signupLabel}
            </Link>
            <a className={styles.secondary} href="#demo-auction" data-track="hero:mock">
              <Glyph name="gavel" size={20} strokeWidth={2} />
              Bid in a mock auction
            </a>
          </div>
          <p className={styles.fine}>
            <span className={styles.tick} aria-hidden="true">
              ✓
            </span>{" "}
            Free during beta · No card required · {sportCount} sports
          </p>
          <p className={styles.fine} style={{ marginTop: -10 }}>
            Got a link from your league?{" "}
            <Link className={styles.textLink} href="/c" data-track="hero:browse">
              Find your tournament →
            </Link>
          </p>
        </div>
      </div>
      <a className={styles.cue} href="#night">
        <i aria-hidden="true" />
        What happens on the night
      </a>
    </section>
  );
}
