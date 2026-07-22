// Twitter renders the same card as OpenGraph (one renderer, two meta channels).
// Re-exporting keeps a single source of truth for size/contentType/alt/runtime.
export { default, runtime, revalidate, alt, size, contentType } from "./opengraph-image";
