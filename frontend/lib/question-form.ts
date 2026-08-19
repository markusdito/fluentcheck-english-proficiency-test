export function parseNonNegativeInteger(
  value: string,
  label: string,
  required = false,
): number | undefined {
  const normalized = value.trim();

  if (!normalized) {
    if (required) throw new Error(`${label} is required.`);
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return parsed;
}
