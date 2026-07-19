import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Shared-secret trust boundary between this API and the Next.js web app.
 * The web app verifies the admin's own session cookie itself, then relays
 * write requests here with this token — the API never sees or manages
 * browser sessions, only "was this request relayed by our trusted backend."
 */
function expectedToken(): string {
  const value = process.env.ADMIN_API_TOKEN;
  if (!value) {
    throw new Error("ADMIN_API_TOKEN is not set. Add it to api/.env.local.");
  }
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

export async function requireAdminToken(c: Context, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || !safeEqual(token, expectedToken())) {
    throw new HTTPException(401, { message: "Missing or invalid admin credentials" });
  }
  await next();
}

/** The Next.js BFF sends this alongside the bearer token for attribution in the ledger. */
export function adminUsernameFrom(c: Context): string {
  const username = c.req.header("x-admin-username")?.trim();
  if (!username) {
    throw new HTTPException(400, { message: "Missing x-admin-username header" });
  }
  return username;
}
