import { demoBookings } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { db } from "../../../../server/db";
import { bookingByToken } from "../../../../server/marketing/demo-booking";
import { buildInvite, inviteUid } from "../../../../server/marketing/demo-ics";
import { env } from "../../../../env";

/**
 * THE CALENDAR FILE, SERVED RATHER THAN ONLY ATTACHED.
 *
 * The confirmation mail attaches it, and attachments are the single place every
 * provider's API shape diverges — so this exists as the path that works
 * whatever the provider does with the file, and for the person whose mail
 * client quietly strips `text/calendar`. Same token, same authorisation as the
 * page it is linked from.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const booking = await bookingByToken(token);
  if (booking === null) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await db
    .select({ requestId: demoBookings.demoRequestId })
    .from(demoBookings)
    .where(eq(demoBookings.id, booking.id))
    .limit(1);
  if (row === undefined) {
    return new Response("Not found", { status: 404 });
  }

  const url = `${env.PUBLIC_BASE_URL}/demo/${token}`;
  const body = buildInvite({
    uid: inviteUid(row.requestId),
    start: booking.slotStart,
    end: booking.slotEnd,
    summary: `DesiAuction demo — ${booking.orgName}`,
    description: `A live walkthrough of a real auction. Manage this booking: ${url}`,
    url,
    organizerEmail: "support@desiauction.in",
    sequence: 0,
    ...(booking.cancelledAt === null ? {} : { cancelled: true }),
  });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="desiauction-demo.ics"',
      // Somebody's own booking, and it moves. Never cached by anything.
      "cache-control": "no-store",
    },
  });
}
