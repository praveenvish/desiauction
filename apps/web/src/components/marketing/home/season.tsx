import Image from "next/image";
import type { ReactNode } from "react";

import { STAR_LOT, TEAMS, price } from "../../../content/home-story";
import styles from "../../../app/home.module.css";
import { Glyph, type GlyphName } from "./glyphs";

/**
 * 3 · THE SEASON. After the gavel, everything that follows the auction — each
 * product surface once, in the order a season meets it. A swipe row by
 * default; where scroll timelines run, the scroll pulls the track sideways.
 *
 * Every card states only what the product does today. Messages are email in
 * English or हिन्दी; WhatsApp sending is not live, and the card says "next".
 */
function SeasonCard({
  glyph,
  label,
  color,
  title,
  text,
  children,
}: {
  glyph: GlyphName;
  label: string;
  color: string;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <li className={[styles.card, styles.lift, styles.seasonCard].join(" ")}>
      <div className={styles.cardHead}>
        <span className={styles.tile}>
          <Glyph name={glyph} />
        </span>
        <span className={styles.cap} style={{ color }}>
          {label}
        </span>
      </div>
      <h3 className={styles.cardTitle}>{title}</h3>
      <p className={styles.cardText}>{text}</p>
      <div className={styles.mock} aria-hidden="true">
        {children}
      </div>
    </li>
  );
}

const FORM = { W: "#7FD1A8", L: "#FF7A66" } as const;
const TABLE: readonly { team: string; form: readonly ("W" | "L")[]; points: number }[] = [
  { team: "Falcons", form: ["W", "W", "W"], points: 6 },
  { team: "Titans", form: ["W", "L", "W"], points: 4 },
  { team: "Voyagers", form: ["L", "W", "L"], points: 2 },
  { team: "Strikers", form: ["L", "L", "L"], points: 0 },
];

export function Season() {
  const star = STAR_LOT.player;
  return (
    <section className={styles.season} aria-labelledby="season-title">
      <div className={styles.seasonStage}>
        {/* A swipe row where the scroll track does not run: focusable, so a
            keyboard can scroll it too. */}
        <ul
          className={styles.track}
          style={{ listStyle: "none", margin: 0 }}
          tabIndex={0}
          aria-label="The season, after the auction"
        >
          <li className={styles.seasonIntro}>
            <p className={styles.kicker}>After the gavel</p>
            <h2
              id="season-title"
              className={styles.display}
              style={{ fontSize: 54, lineHeight: "56px" }}
            >
              The season runs here too.
            </h2>
            <p className={styles.lead}>
              Squads become teams. Everything that follows lives in the same place — and reaches
              everyone on their phone.
            </p>
          </li>
          <SeasonCard
            glyph="squad"
            label="Lineups"
            color="var(--blue)"
            title="Owners pick the XI."
            text="Each owner sets their side for match day — captain included — from their phone."
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className={styles.cap}>Voyagers · Match 3</span>
              <span className={styles.cap} style={{ color: "var(--green)" }}>
                11 of 11
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.chip} style={{ background: "var(--gold)", color: "#141008" }}>
                C
              </span>
              Neel Kapoor<span style={{ marginLeft: "auto", color: "var(--muted)" }}>Batter</span>
            </div>
            <div className={styles.row}>
              <span className={styles.chip}>WK</span>Om Mishra
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>Keeper</span>
            </div>
            <div className={styles.row}>
              <span className={styles.chip}>7</span>Pooja Joshi
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>Bowler</span>
            </div>
            <div className={styles.row} style={{ color: "var(--muted)" }}>
              + 8 more
            </div>
          </SeasonCard>
          <SeasonCard
            glyph="fixture"
            label="Fixtures"
            color="var(--gold-ink)"
            title="Fixtures, generated."
            text="Grounds and times for every round — published for everyone in one go."
          >
            {[
              ["Sat 4", "Falcons", "Voyagers", "7:00"],
              ["Sat 4", "Titans", "Strikers", "10:30"],
              ["Sun 5", "Falcons", "Titans", "7:00"],
              ["Sun 5", "Voyagers", "Strikers", "10:30"],
            ].map(([day, home, away, time]) => (
              <div key={`${String(day)}${String(home)}`} className={styles.row}>
                <span className={styles.cap} style={{ width: 52 }}>
                  {day}
                </span>
                {home} <span style={{ color: "var(--muted)" }}>vs</span> {away}
                <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{time}</span>
              </div>
            ))}
          </SeasonCard>
          <SeasonCard
            glyph="trophy"
            label="Scores & table"
            color="var(--green)"
            title="Scores in. Table moves."
            text="Enter a result and the table, form and next match update on every screen."
          >
            {TABLE.map((row, index) => (
              <div key={row.team} className={styles.row}>
                <span style={{ width: 16, color: index === 0 ? "var(--gold-ink)" : undefined }}>
                  {index + 1}
                </span>
                {row.team}
                <span className={styles.form} style={{ marginLeft: "auto" }}>
                  {row.form.map((result, i) => (
                    <i key={i} style={{ background: FORM[result] }} />
                  ))}
                </span>
                <b className={styles.num} style={{ width: 28, textAlign: "right" }}>
                  {row.points}
                </b>
              </div>
            ))}
          </SeasonCard>
          <SeasonCard
            glyph="receipt"
            label="Money"
            color="var(--gold-ink)"
            title="Every rupee, receipted."
            text="Record entry fees and payments; each one gets a receipt. No chasing in the group chat."
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className={styles.cap}>Collected</span>
              <b className={styles.num} style={{ color: "var(--ink)" }}>
                {price(120000)}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 500 }}>of {price(150000)}</span>
              </b>
            </div>
            <div className={styles.bar}>
              <i style={{ width: "80%", background: "var(--green)" }} />
            </div>
            <div className={styles.row}>
              Falcons
              <span
                className={styles.chip}
                style={{
                  marginLeft: "auto",
                  background: "rgb(127 209 168 / 15%)",
                  color: "var(--green)",
                }}
              >
                Paid · #0001
              </span>
            </div>
            <div className={styles.row}>
              Titans
              <span
                className={styles.chip}
                style={{
                  marginLeft: "auto",
                  background: "rgb(127 209 168 / 15%)",
                  color: "var(--green)",
                }}
              >
                Paid · #0002
              </span>
            </div>
            <div className={styles.row}>
              Voyagers
              <span
                className={styles.chip}
                style={{
                  marginLeft: "auto",
                  background: "rgb(243 208 120 / 15%)",
                  color: "var(--gold-ink)",
                }}
              >
                {price(30000)} due
              </span>
            </div>
          </SeasonCard>
          <SeasonCard
            glyph="message"
            label="Messages"
            color="var(--violet)"
            title="Everyone hears first."
            text="Reminders and results go out by email — in English or हिन्दी. WhatsApp is next."
          >
            <div className={styles.bubble}>
              Match 3 · Sun 7:00 am · Ground 2. Falcons vs Titans.
            </div>
            <div className={styles.bubble} lang="hi">
              मैच 3 · रविवार सुबह 7 बजे · ग्राउंड 2
            </div>
            <span className={styles.chip} style={{ alignSelf: "flex-start" }}>
              EN · हिन्दी
            </span>
          </SeasonCard>
          <SeasonCard
            glyph="career"
            label="Careers"
            color="var(--coral)"
            title="Every player keeps a record."
            text="One profile across seasons and leagues: teams, prices, and the sports they play."
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {star.face === undefined ? null : (
                <Image
                  src={star.face}
                  alt=""
                  width={88}
                  height={88}
                  sizes="44px"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    objectFit: "cover",
                    border: "1px solid var(--gold)",
                  }}
                />
              )}
              <div>
                <b style={{ color: "var(--ink)" }}>{star.name}</b>
                <div style={{ color: "var(--muted)" }}>{star.role} · 2 seasons</div>
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.cap} style={{ width: 44 }}>
                2026
              </span>
              {STAR_LOT.soldTo}
              <b className={styles.num} style={{ marginLeft: "auto", color: "var(--gold-ink)" }}>
                {price(STAR_LOT.price)}
              </b>
            </div>
            <div className={styles.row}>
              <span className={styles.cap} style={{ width: 44 }}>
                2025
              </span>
              {TEAMS[2]?.name}
              <b className={styles.num} style={{ marginLeft: "auto", color: "var(--text)" }}>
                {price(55000)}
              </b>
            </div>
          </SeasonCard>
        </ul>
        <div className={styles.progress} aria-hidden="true">
          <b />
        </div>
      </div>
    </section>
  );
}
