import { codeMailCopy } from "../../../server/auth/email-sender";
import {
  bookingCancellationMail,
  bookingConfirmationMail,
  bookingReminderMail,
} from "../../../server/marketing/demo-booking-mail";
import { requesterAcknowledgement } from "../../../server/marketing/demo-mail";
import {
  appointmentMail,
  ownerSummaryMail,
  soldMail,
  squadSheetMail,
  unsoldMail,
} from "../../../server/messaging/player-mail";
import { reviewAskMail, seasonAskMail } from "../../../server/reviews/review-mail";
import "./emails.css";

export const metadata = { title: "Emails · Gallery" };

/**
 * EVERY EMAIL A CUSTOMER RECEIVES, rendered from the same builders that send
 * them — nothing here is a mock-up, and nothing here sends. Dev-only, like the
 * rest of /gallery (its layout 404s outside development).
 */
export default function EmailGalleryPage() {
  const booking = {
    to: "rohan@example.com",
    name: "Rohan",
    orgName: "Malad Cricket Club",
    token: "sample-token",
    requestId: "sample",
    slotStart: new Date("2026-10-02T12:30:00Z"),
    slotEnd: new Date("2026-10-02T13:00:00Z"),
    sequence: 0,
  };
  const squad = [
    { name: "Arjun Sharma", note: "₹75,000" },
    { name: "Vikram Patel", note: "Captain · ₹25,000" },
    { name: "Rahul Desai", note: "Icon" },
  ];
  const samples: { name: string; mail: { subject: string; text: string; html: string } }[] = [
    {
      name: "Sold — with the bidding story",
      mail: soldMail({
        name: "Arjun",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        teamName: "Cup Kings",
        price: "₹75,000",
        basePrice: "₹25,000",
        multiple: 3,
        bidders: ["Tigers", "Cup Kings", "Falcons"],
        bidCount: 7,
        highlight: "You were the most expensive buy of the night",
        squad,
        cardUrl: "https://desiauction.in/c/malad-premier-league/p/R8KQ2X1",
      }),
    },
    {
      name: "Not picked",
      mail: unsoldMail({
        name: "Rohit",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
      }),
    },
    {
      name: "Named captain — signed before the auction",
      mail: appointmentMail({
        name: "Vikram",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        teamName: "Cup Kings",
        roles: ["captain"],
        bought: false,
      }),
    },
    {
      name: "Named captain and icon — one email",
      mail: appointmentMail({
        name: "Rahul",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        teamName: "Cup Kings",
        roles: ["icon", "captain"],
        bought: false,
      }),
    },
    {
      name: "Named captain after the auction bought them",
      mail: appointmentMail({
        name: "Arjun",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        teamName: "Cup Kings",
        roles: ["captain"],
        bought: true,
      }),
    },
    {
      name: "Meet your squad — every squad member, after the auction",
      mail: squadSheetMail({
        name: "Arjun",
        season: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        teamName: "Cup Kings",
        squad: [
          { name: "Vikram Patel", note: "Captain" },
          { name: "Rahul Desai", note: "Icon" },
          { name: "Arjun Sharma (you)", note: "Player" },
          { name: "Karan Mehta", note: "Player" },
        ],
        coach: "Suresh Iyer",
        firstMatch: "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground",
      }),
    },
    {
      name: "Owner — the squad after the auction",
      mail: ownerSummaryMail({
        name: "Priya",
        season: "Malad Premier League 2026",
        teamName: "Cup Kings",
        squad,
        spent: "₹1,00,000",
        purseLeft: "₹1,99,00,000",
        squadSize: 3,
        squadMin: 8,
        squadMax: 15,
        teamUrl: "https://desiauction.in/seasons/malad-premier-league/teams",
      }),
    },
    { name: "Sign-in code", mail: codeMailCopy("482913", "login") },
    { name: "Sign-up code", mail: codeMailCopy("482913", "signup") },
    { name: "Confirm email", mail: codeMailCopy("482913", "email_change") },
    {
      name: "Review request (organizer)",
      mail: reviewAskMail("Rohan", "https://desiauction.in/review/sample", "organizer"),
    },
    {
      name: "Season review request (player)",
      mail: seasonAskMail({
        name: "Rohan",
        seasonName: "Malad Premier League 2026",
        orgName: "Malad Cricket Club",
        role: "player",
        link: "https://desiauction.in/review/sample",
      }),
    },
    {
      name: "Demo request received",
      mail: requesterAcknowledgement({
        name: "Rohan",
        phone: "+919820000000",
        email: "rohan@example.com",
        orgName: "Malad Cricket Club",
        sport: "cricket",
        tournamentSize: "8-16",
        auctionOn: "2026-11-14",
        preferredWindow: "weekday-evening",
        note: null,
        source: "schedule-demo",
        requestIp: null,
      }),
    },
    { name: "Demo booked", mail: bookingConfirmationMail(booking) },
    { name: "Demo reminder (24h)", mail: bookingReminderMail(booking, 24) },
    { name: "Demo cancelled", mail: bookingCancellationMail(booking) },
  ];

  return (
    <main className="email-gallery">
      <h1>Emails</h1>
      <p className="email-gallery-intro">
        Every email a customer receives, rendered by the code that sends it. Desktop width on the
        left, a phone on the right; the plain-text part under each.
      </p>
      {samples.map(({ name, mail }) => (
        <section key={name} className="email-sample">
          <h2>{name}</h2>
          <p className="email-subject">
            <span>Subject</span> {mail.subject}
          </p>
          <div className="email-frames">
            <iframe title={`${name} — desktop`} srcDoc={mail.html} className="email-frame" />
            <iframe
              title={`${name} — phone`}
              srcDoc={mail.html}
              className="email-frame email-frame--phone"
            />
          </div>
          <details>
            <summary>Plain text</summary>
            <pre>{mail.text}</pre>
          </details>
        </section>
      ))}
    </main>
  );
}
