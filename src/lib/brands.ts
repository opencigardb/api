/**
 * Derive brand names from cigar names.
 *
 * The source data has no brand field — names look like "Arturo Fuente Hemingway
 * Short Story". The brand is recovered statistically: a prefix of up to four
 * words counts as a brand if enough distinct cigar names start with it. The
 * longest qualifying prefix wins, but extension stops at tokens containing
 * digits ("Padron 1964 …" → "Padron") so product lines aren't swallowed.
 * Connector words (y, de, la, …) never end a brand.
 */

const MIN_PREFIX_COUNT = 5;
const MAX_BRAND_WORDS = 4;
const CONNECTORS = new Set(["y", "de", "del", "la", "las", "los", "el", "&", "and", "the", "of", "by"]);

function words(name: string): string[] {
  return name.trim().split(/\s+/);
}

export function buildBrandResolver(names: string[]): (name: string) => string | null {
  const prefixCounts = new Map<string, number>();
  for (const name of names) {
    const parts = words(name);
    for (let n = 1; n <= Math.min(MAX_BRAND_WORDS, parts.length); n++) {
      const prefix = parts.slice(0, n).join(" ").toLowerCase();
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  return (name: string): string | null => {
    const parts = words(name);
    if (parts.length === 0 || !parts[0]) return null;
    let take = 1;
    for (let n = 2; n <= Math.min(MAX_BRAND_WORDS, parts.length); n++) {
      const token = parts[n - 1]!;
      if (n > 1 && (/\d/.test(token) || token.startsWith("("))) break;
      const prefix = parts.slice(0, n).join(" ").toLowerCase();
      if ((prefixCounts.get(prefix) ?? 0) >= MIN_PREFIX_COUNT) take = n;
      else break;
    }
    // A brand shouldn't end on a connector word ("Romeo y" → back up to "Romeo").
    while (take > 1 && CONNECTORS.has(parts[take - 1]!.toLowerCase())) take--;
    return parts.slice(0, take).join(" ");
  };
}
