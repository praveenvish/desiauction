-- BOX CRICKET, on the demand form (0053 shipped the pack).
--
-- `demo_requests.sport` is CHECK-constrained to the list the form offers, so a
-- new option is a migration. The registry and that list stay separate — the
-- form must offer sports we cannot run, which is the whole point of the SP-1
-- gate — but the converse has to hold: a sport we CAN run must be sayable, or
-- the organizer who runs box cricket picks "cricket" and the signal for the
-- format they actually run is lost in the parent's numbers.
ALTER TABLE "demo_requests" DROP CONSTRAINT "demo_requests_sport_check";
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_sport_check"
  CHECK ("sport" IS NULL OR "sport" IN (
    'cricket', 'box_cricket', 'football', 'kabaddi', 'volleyball', 'badminton',
    'basketball', 'hockey', 'table-tennis', 'pickleball', 'esports', 'other'
  ));
