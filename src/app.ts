import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { adminUsernameFrom, requireAdminToken } from "./auth/admin-token";
import { findAdminByUsername } from "./auth/repository";
import { isRateLimited } from "./auth/rate-limit";
import { parseCigarUpdateInput } from "./db/cigar-validation";
import {
  facet,
  getCigar,
  listBrands,
  listCigars,
  mergeCigars,
  resolveRedirect,
  stats,
  updateCigar,
  type CigarListParams,
} from "./db/repository";
import { GitSyncError } from "./git/commit";
import {
  createLedgerEntry,
  deleteLedgerEntry,
  getLedger,
  getLedgerForAdmin,
  updateLedgerEntry,
} from "./ledger/repository";
import { parseLedgerEntryInput } from "./ledger/validation";
import { isUlid } from "./lib/id";

const MAX_LIMIT = 100;

// Precomputed so a login for a nonexistent username still pays the argon2
// verify cost, keeping response timing similar to a real wrong-password case.
const DUMMY_PASSWORD_HASH = await Bun.password.hash("no-such-admin-placeholder-password");

function intParam(value: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function paginated<T>(data: T[], total: number, limit: number, offset: number) {
  return { data, pagination: { total, limit, offset } };
}

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"],
  }),
);

app.get("/healthz", (c) => c.json({ status: "ok" }));

const v1 = new Hono();

v1.get("/cigars", (c) => {
  const limit = intParam(c.req.query("limit"), 25, MAX_LIMIT);
  const offset = intParam(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
  const sortParam = c.req.query("sort") ?? (c.req.query("q") ? "relevance" : "name");
  const allowedSorts = new Set(["name", "-name", "reviews", "-reviews", "relevance"]);
  if (!allowedSorts.has(sortParam)) {
    throw new HTTPException(400, { message: `Unsupported sort: ${sortParam}` });
  }
  const params: CigarListParams = {
    limit,
    offset,
    q: c.req.query("q") || undefined,
    brand: c.req.query("brand") || undefined,
    country: c.req.query("country") || undefined,
    strength: c.req.query("strength") || undefined,
    color: c.req.query("color") || undefined,
    sort: sortParam as CigarListParams["sort"],
  };
  const { data, total } = listCigars(params);
  return c.json(paginated(data, total, limit, offset));
});

v1.get("/cigars/:id", (c) => {
  const id = c.req.param("id");
  if (!isUlid(id)) {
    throw new HTTPException(400, { message: "Invalid cigar id: expected a ULID" });
  }
  const redirectTo = resolveRedirect(id);
  if (redirectTo) {
    return c.redirect(`/v1/cigars/${redirectTo}`, 301);
  }
  const cigar = getCigar(id);
  if (!cigar) throw new HTTPException(404, { message: "Cigar not found" });
  return c.json({ data: cigar });
});

v1.get("/brands", (c) => {
  const limit = intParam(c.req.query("limit"), 25, MAX_LIMIT);
  const offset = intParam(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
  const { data, total } = listBrands({ limit, offset, q: c.req.query("q") || undefined });
  return c.json(paginated(data, total, limit, offset));
});

v1.get("/countries", (c) => c.json({ data: facet("country") }));
v1.get("/strengths", (c) => c.json({ data: facet("strength") }));
v1.get("/colors", (c) => c.json({ data: facet("color") }));
v1.get("/stats", (c) => c.json({ data: stats() }));

v1.get("/ledger", async (c) => c.json({ data: await getLedger() }));

v1.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) {
    throw new HTTPException(400, { message: "username and password are required" });
  }

  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (isRateLimited(`${clientIp}:${username.toLowerCase()}`)) {
    throw new HTTPException(429, { message: "Too many login attempts. Try again later." });
  }

  const admin = findAdminByUsername(username);
  const valid = await Bun.password.verify(password, admin?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!admin || !valid) {
    throw new HTTPException(401, { message: "Invalid username or password" });
  }

  return c.json({ data: { id: admin.id, username: admin.username } });
});

const admin = new Hono();
admin.use("*", requireAdminToken);

admin.get("/ledger", async (c) => c.json({ data: await getLedgerForAdmin() }));

admin.post("/ledger", async (c) => {
  const username = adminUsernameFrom(c);
  const body = await c.req.json().catch(() => null);
  let input: ReturnType<typeof parseLedgerEntryInput>;
  try {
    input = parseLedgerEntryInput(body);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
  const entry = await createLedgerEntry(input, username);
  return c.json({ data: entry }, 201);
});

admin.patch("/ledger/:id", async (c) => {
  const username = adminUsernameFrom(c);
  const body = await c.req.json().catch(() => null);
  let input: ReturnType<typeof parseLedgerEntryInput>;
  try {
    input = parseLedgerEntryInput(body);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
  const entry = await updateLedgerEntry(c.req.param("id"), input, username);
  if (!entry) throw new HTTPException(404, { message: "Ledger entry not found" });
  return c.json({ data: entry });
});

admin.delete("/ledger/:id", async (c) => {
  const username = adminUsernameFrom(c);
  const deleted = await deleteLedgerEntry(c.req.param("id"), username);
  if (!deleted) throw new HTTPException(404, { message: "Ledger entry not found" });
  return c.body(null, 204);
});

admin.patch("/cigars/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUlid(id)) {
    throw new HTTPException(400, { message: "Invalid cigar id: expected a ULID" });
  }
  const body = await c.req.json().catch(() => null);
  let input: ReturnType<typeof parseCigarUpdateInput>;
  try {
    input = parseCigarUpdateInput(body);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
  const cigar = updateCigar(id, input);
  if (!cigar) throw new HTTPException(404, { message: "Cigar not found" });
  return c.json({ data: cigar });
});

admin.post("/cigars/merge", async (c) => {
  const body = await c.req.json().catch(() => null);
  const survivorId = typeof body?.survivor_id === "string" ? body.survivor_id : "";
  const duplicateId = typeof body?.duplicate_id === "string" ? body.duplicate_id : "";
  if (!isUlid(survivorId) || !isUlid(duplicateId)) {
    throw new HTTPException(400, { message: "survivor_id and duplicate_id must be valid ULIDs" });
  }
  const result = mergeCigars(survivorId, duplicateId);
  if (!result.ok) throw new HTTPException(result.status, { message: result.error });
  return c.json({ data: result.survivor });
});

v1.route("/admin", admin);

app.route("/v1", v1);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Resource not found" } }, 404));

app.onError((err, c) => {
  if (err instanceof GitSyncError) {
    console.error(err);
    return c.json({ error: { code: "git_sync_failed", message: err.message } }, 502);
  }
  if (err instanceof HTTPException) {
    const codes: Record<number, string> = {
      400: "bad_request",
      401: "unauthorized",
      404: "not_found",
      429: "too_many_requests",
    };
    const code = codes[err.status] ?? "error";
    return c.json({ error: { code, message: err.message } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});
