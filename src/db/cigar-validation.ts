import type { CigarUpdateInput } from "./repository";

const MAX_NAME_LENGTH = 200;
const MAX_FIELD_LENGTH = 100;

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Expected a string of at most ${maxLength} characters`);
  }
  return value.trim() || null;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Expected a positive number");
  }
  return n;
}

export function parseCigarUpdateInput(body: unknown): CigarUpdateInput {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object");
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`name is required (max ${MAX_NAME_LENGTH} chars)`);
  }

  try {
    return {
      name,
      brand: optionalString(b.brand, MAX_NAME_LENGTH),
      length_in: optionalNumber(b.length_in),
      length_mm: optionalNumber(b.length_mm),
      ring_gauge: optionalNumber(b.ring_gauge),
      country: optionalString(b.country, MAX_FIELD_LENGTH),
      filler: optionalString(b.filler, MAX_FIELD_LENGTH),
      wrapper: optionalString(b.wrapper, MAX_FIELD_LENGTH),
      color: optionalString(b.color, MAX_FIELD_LENGTH),
      strength: optionalString(b.strength, MAX_FIELD_LENGTH),
    };
  } catch (err) {
    throw new Error(`Invalid field: ${(err as Error).message}`);
  }
}
