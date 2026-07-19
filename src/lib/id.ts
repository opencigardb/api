import { createHash } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Derive a stable ULID-format identifier from an external source key.
 * RFC-0004 requires immutable identifiers; hashing the source key means
 * re-running ingest never changes an id.
 */
export function deriveUlid(sourceKey: string): string {
  const digest = createHash("sha256").update(sourceKey).digest();
  let bits = 0n;
  for (let i = 0; i < 17; i++) bits = (bits << 8n) | BigInt(digest[i]!);
  let out = "";
  for (let i = 25; i >= 0; i--) {
    const idx = Number((bits >> BigInt(i * 5)) & 31n);
    out += CROCKFORD[idx];
  }
  // A valid ULID's first character is 0-7 (48-bit timestamp bound).
  return CROCKFORD[Number(bits >> 125n) & 7]! + out.slice(1);
}

export function isUlid(value: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value.toUpperCase());
}
