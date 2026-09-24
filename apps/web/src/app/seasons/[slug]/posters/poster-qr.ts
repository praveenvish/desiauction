import qrcode from "qrcode-generator";

/**
 * A QR code as an SVG data URI. A Status has no clickable link — the image IS
 * the message — so the poster carries its own way back to the public page.
 * Level M: a phone camera reads it off a screen at Status size.
 */
export function qrDataUri(url: string): string {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const count = code.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (code.isDark(row, col)) {
        path += `M${String(col)} ${String(row)}h1v1h-1z`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(count)} ${String(count)}" shape-rendering="crispEdges"><path d="${path}" fill="#0A0A0C"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** "https://desiauction.in/c/x/p/1" → "desiauction.in" — what a reader can type. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "desiauction.in";
  }
}
