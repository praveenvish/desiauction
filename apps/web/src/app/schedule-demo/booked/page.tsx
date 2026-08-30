import type { Metadata } from "next";
import Link from "next/link";

import "../../content.css";
import "../demo.css";

export const metadata: Metadata = {
  title: "Demo booked · DesiAuction",
  robots: { index: false, follow: false },
};

/**
 * The landing after a booking, and after an attempt to book a second one.
 *
 * It deliberately shows no times and no details. The person's own booking page
 * is behind their token, and reaching it needs the link we mailed them — a
 * screen that displayed the booking to whoever holds a request id would make
 * that id into the credential it is not.
 */
export default function DemoBookedPage() {
  return (
    <main className="content-page content-narrow">
      <h1>You&apos;re booked in</h1>
      <p className="content-lead">
        We&apos;ve sent a confirmation with a calendar invite, and a link you can use to move or
        cancel the call.
      </p>
      <p className="prose-p">
        Nothing arrived? Check the spam folder first, then write to{" "}
        <a href="mailto:support@desiauction.in?subject=Demo%20booking" className="prose-link">
          support@desiauction.in
        </a>{" "}
        and we&apos;ll sort it out.
      </p>
      <p className="prose-p">
        You don&apos;t have to wait for the call to begin —{" "}
        <Link href="/login" className="prose-link">
          set your tournament up now
        </Link>{" "}
        and bring your questions to the demo.
      </p>
    </main>
  );
}
