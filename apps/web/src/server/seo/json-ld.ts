/**
 * PX-11 SECURITY FIX (finding F2 — stored XSS via JSON-LD).
 *
 * `JSON.stringify` does NOT escape `<`, `>` or `&`, so serializing
 * organizer-controlled text (a competition name, an org name, a location) into a
 * `<script type="application/ld+json">` block lets a name like
 * `</script><script>alert(document.cookie)</script>` break out of the tag and
 * execute on the PUBLIC competition page for every visitor.
 *
 * This serializes for safe embedding in an HTML `<script>` element by escaping
 * the three HTML-significant characters — escaping `<` alone already makes a
 * `</script>` breakout impossible — plus the two Unicode line separators
 * (U+2028/U+2029) that terminate a JavaScript string literal. The output is
 * still valid JSON (search engines parse the escapes transparently), so SEO is
 * unaffected while the injection is structurally impossible.
 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
}
