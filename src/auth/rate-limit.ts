const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Fixed-window limiter to blunt brute-force login attempts against a single key (IP + username). */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}
