"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowRight, IconCheck, IconGavel, IconRefresh, IconTrophy } from "./icons";
import styles from "../../app/guest-home.module.css";

/** Content remains visible before hydration and when motion is disabled. */
export function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !root.current ||
      !("IntersectionObserver" in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-revealed", "true");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    root.current.querySelectorAll("[data-reveal]").forEach((element) => {
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return <div ref={root}>{children}</div>;
}

type SportOption = { key: string; label: string; role: string };
const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;

export function AuctionLab({ sports }: { sports: SportOption[] }) {
  const [selected, setSelected] = useState("football");
  const [bid, setBid] = useState(0);
  const sport = sports.find((item) => item.key === selected) ?? sports[0];
  const sold = bid === 3;
  const amount = 20000 + bid * 5000;
  const team = bid === 0 ? "Waiting for the first bid" : bid === 2 ? "Falcons" : "Voyagers";
  return (
    <section id="playground" className={styles.playground} aria-labelledby="sports-title">
      <div className={styles.container}>
        <div className={styles.sportsHeading} data-reveal>
          <div>
            <p className={styles.eyebrow}>DIFFERENT GAMES. SAME COMPETITIVE SPIRIT.</p>
            <h2 id="sports-title">Your sport belongs here.</h2>
          </div>
          <p>
            <strong>{sports.length} sport formats.</strong>
            <br />
            Pick yours. Get a feel for auction day.
          </p>
        </div>
        <div
          className={styles.sportsGrid}
          role="group"
          aria-label="Choose a sport for the auction demo"
        >
          {sports.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={selected === item.key}
              onClick={() => {
                setSelected(item.key);
                setBid(0);
              }}
            >
              <SportGlyph sport={item.key} />
              <span>{item.label}</span>
              {selected === item.key && (
                <span className={styles.sportCheck}>
                  <IconCheck size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.demoLayout}>
          <div className={styles.demoCopy} data-reveal>
            <p className={styles.eyebrow}>
              <IconGavel size={16} /> THE AUCTION EXPERIENCE
            </p>
            <h2>
              A little rivalry.
              <br />
              <span>A lot of possibility.</span>
            </h2>
            <p>That one player. Two determined owners. A room waiting for the next bid.</p>
            <p>Try it for yourself. Place three demo bids and see a new teammate join the squad.</p>
            <Link className={styles.textLink} href="/help/conducting-the-auction">
              See how a real auction works <IconArrowRight size={17} />
            </Link>
            <div className={styles.demoHint}>
              <span>01</span> Pick a sport <i />
              <span>02</span> Place a bid <i />
              <span>03</span> Make a team
            </div>
          </div>
          <div className={styles.auctionStage}>
            <div className={styles.auctionBoard}>
              <div className={styles.boardTop}>
                <span>
                  <span className={styles.demoDot} /> INTERACTIVE DEMO
                </span>
                <span>{sport?.label}</span>
              </div>
              <div className={styles.player}>
                <div className={styles.playerAvatar}>
                  <SportGlyph sport={selected} />
                </div>
                <div>
                  <span>PLAYER 007</span>
                  <h3>Riya Mehta</h3>
                  <p>
                    {sport?.role} <span>·</span> {sport?.label}
                  </p>
                </div>
                <span className={styles.playerNumber} aria-hidden="true">
                  07
                </span>
              </div>
              <div className={styles.bidZone} aria-live="polite" aria-atomic="true">
                <span>{sold ? "WINNING BID" : bid === 0 ? "OPENING PRICE" : "CURRENT BID"}</span>
                <strong key={String(bid)}>{money(amount)}</strong>
                <p>{sold ? "Sold to Voyagers" : team}</p>
                {sold && (
                  <span className={styles.soldStamp}>
                    SOLD <IconCheck size={17} />
                  </span>
                )}
              </div>
              <div className={styles.demoTeams}>
                <div data-leading={bid === 2}>
                  <span className={styles.teamBadge}>F</span>
                  <span>
                    Falcons<small>{bid === 2 ? "Leading bid" : "Team owner"}</small>
                  </span>
                  {bid === 2 && <IconTrophy size={15} />}
                </div>
                <div data-leading={bid === 1 || sold}>
                  <span className={styles.teamBadge}>V</span>
                  <span>
                    Voyagers
                    <small>
                      {sold ? "Player signed" : bid === 1 ? "Leading bid" : "Team owner"}
                    </small>
                  </span>
                  {(bid === 1 || sold) && <IconTrophy size={15} />}
                </div>
              </div>
              <button
                type="button"
                className={styles.bidButton}
                onClick={() => {
                  setBid((current) => (current >= 3 ? 0 : current + 1));
                }}
              >
                {sold ? (
                  <>
                    <IconRefresh size={17} /> Try again
                  </>
                ) : (
                  <>
                    Place a demo bid{" "}
                    <span>
                      {money(amount + 5000)} <IconArrowRight size={16} />
                    </span>
                  </>
                )}
              </button>
              <div className={styles.demoProgress}>
                <div aria-hidden="true">
                  {[1, 2, 3].map((step) => (
                    <i key={step} data-complete={bid >= step} />
                  ))}
                </div>
                <span>{sold ? "A new team begins." : `${String(bid)} of 3 demo bids`}</span>
              </div>
            </div>
            <p className={styles.demoDisclaimer}>
              Fictional players & teams. No real bids or payments.
            </p>
            <noscript>
              <p className={styles.demoDisclaimer}>
                Enable JavaScript to try the interactive auction demo.
              </p>
            </noscript>
          </div>
        </div>
      </div>
    </section>
  );
}

function SportGlyph({ sport }: { sport: string }) {
  let glyph: ReactNode;
  if (sport === "football")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7 5 4-2 6H9l-2-6 5-4Zm0-4v4m8 0-3 4m0 9-2-3M4 7l3 4m0 9 2-3" />
      </>
    );
  else if (sport === "basketball")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3v18M6 5c8 5 8 9 0 14M18 5c-8 5-8 9 0 14" />
      </>
    );
  else if (sport === "cricket" || sport === "box_cricket")
    glyph = (
      <>
        <path d="m15 3 2 2-5 6m-1-2 4 4-8 8-4-4 8-8Z" />
        <circle cx="19" cy="17" r="2.5" />
        {sport === "box_cricket" && <path d="M3 9V3h6" />}
      </>
    );
  else if (["badminton", "table_tennis", "pickleball"].includes(sport))
    glyph = (
      <>
        <ellipse cx="14" cy="8" rx="5" ry="6" transform="rotate(35 14 8)" />
        <path d="m10 13-7 8m1-4 3 3M11 5l7 6m-8-3 6 5m-5-2 5-7" />
        <circle cx="20" cy="19" r="2" />
      </>
    );
  else if (sport === "volleyball")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 12 8-4m-8 4-1 9m1-9L5 6m5-3c0 4 4 8 9 10M4 9c5 0 9 5 10 11M5 17c2-3 6-4 8-3" />
      </>
    );
  else if (sport === "hockey")
    glyph = (
      <>
        <path d="m17 3-6 15c-1 3-7 4-8 0-1-2 2-3 5-2L14 3m2 17h5" />
        <circle cx="19" cy="17" r="1.5" />
      </>
    );
  else if (sport === "kabaddi")
    glyph = (
      <>
        <circle cx="8" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="m3 12 5-4 5 3 4-2 4 4m-14-3 1 5-5 6m5-6 5 4m4-8-1 6 5 4m-5-4-4 4" />
      </>
    );
  else
    glyph = (
      <>
        <path d="M7 7h10c3 0 5 10 3 11-2 1-4-3-5-3H9c-1 0-3 4-5 3C2 17 4 7 7 7Z" />
        <path d="M8 9v5m-2-2h4m5-1h.01m3 2h.01" />
        {sport === "battle_royale" && <path d="m10 4 2-2 2 2" />}
      </>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
