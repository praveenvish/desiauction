/**
 * MAY `next/image` OPTIMISE THIS SOURCE?
 *
 * An organizer's upload is served from wherever storage says (`readUrl`): a
 * same-origin `/_media/…` path on a dev machine, the bucket's own host
 * (`https://s3.desiauction.in/…`) in production. The optimiser only fetches
 * hosts listed in `images.remotePatterns`, and none is — so in production every
 * season banner and logo drawn through `next/image` was a 400 ("url parameter
 * is not allowed") while working perfectly locally. The hero showed an empty
 * band and the directory cards a blank cover.
 *
 * Uploads are already normalised on the way in (`sanitize.ts`: ≤2048px JPEG or
 * PNG), so an absolute URL is served as it is. Our own `/public` art keeps the
 * optimiser.
 */
export function servedAsStored(src: string): boolean {
  return /^https?:\/\//i.test(src);
}
