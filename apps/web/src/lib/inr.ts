/**
 * Rupees for a screen, from paise.
 *
 * `exactINR` is the full figure in Indian grouping ("₹1,20,00,000"); `compactINR`
 * is the auction-room shorthand ("₹1.2 Cr", "₹52 L"). Money is stored and
 * compared in integer paise everywhere; these only ever format.
 */
export function exactINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function compactINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) {
    return `₹${String(Math.round((rupees / 10_000_000) * 100) / 100)} Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${String(Math.round((rupees / 100_000) * 100) / 100)} L`;
  }
  return `₹${rupees.toLocaleString("en-IN")}`;
}
