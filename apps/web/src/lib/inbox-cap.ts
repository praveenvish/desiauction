/**
 * The bell's badge stops counting here: "9+" says enough (email programme
 * PR16). Its own module because the server's count and the client's badge
 * both read it, and lib/inbox-events already imports the server's types.
 */
export const UNREAD_CAP = 9;
