import { newId, otpInbox, type Db } from "@desiauction/db";

// The ED-1 port: RC-1's real SMS provider becomes a second implementation
// of this interface — auth logic never changes (IP-2_DESIGN D3).
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Development delivery: codes land in the DB, rendered at /dev/inbox. */
export class DevInboxSender implements OtpSender {
  constructor(private readonly db: Db) {}

  async send(phone: string, code: string): Promise<void> {
    await this.db.insert(otpInbox).values({ id: newId(), phone, code });
  }
}
