/** Runtime server-action boundary without widening typed readonly arrays to any[]. */
export function boundedStringList(
  value: unknown,
  min: number,
  max: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item: unknown) => typeof item === "string" && item.length > 0)
  );
}
