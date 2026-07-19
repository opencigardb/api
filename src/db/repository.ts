import type { Database } from "bun:sqlite";
import { getDb, getWritableDb } from "./index";

// All SQL lives in this module so a future PostgreSQL migration only
// has to replace this file (and src/db/index.ts), not the route layer.

export interface CigarRow {
  id: string;
  name: string;
  brand: string | null;
  length_in: number | null;
  length_mm: number | null;
  ring_gauge: number | null;
  country: string | null;
  filler: string | null;
  wrapper: string | null;
  color: string | null;
  strength: string | null;
  review_count: number;
  source_name: string;
  source_ref: string | null;
  source_url: string | null;
}

export interface CigarListParams {
  limit: number;
  offset: number;
  q?: string;
  brand?: string;
  country?: string;
  strength?: string;
  color?: string;
  sort: "name" | "-name" | "reviews" | "-reviews" | "relevance";
}

export interface Page<T> {
  data: T[];
  total: number;
}

const SORTS: Record<string, string> = {
  name: "c.name ASC",
  "-name": "c.name DESC",
  reviews: "c.review_count ASC, c.name ASC",
  "-reviews": "c.review_count DESC, c.name ASC",
};

/** Turn free text into an FTS5 prefix query, stripping operator syntax. */
function ftsQuery(q: string): string | null {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}

export function listCigars(params: CigarListParams): Page<CigarRow> {
  const db = getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  const match = params.q ? ftsQuery(params.q) : null;
  let from = "cigars c";
  if (match) {
    from = "cigars_fts f JOIN cigars c ON c.rowid = f.rowid";
    where.push("cigars_fts MATCH ?");
    args.push(match);
  }
  for (const field of ["brand", "country", "strength", "color"] as const) {
    const value = params[field];
    if (value) {
      where.push(`c.${field} = ? COLLATE NOCASE`);
      args.push(value);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db
    .query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) AS n FROM ${from} ${whereSql}`)
    .get(...args)!.n;

  const orderSql =
    params.sort === "relevance"
      ? match
        ? "ORDER BY f.rank, c.review_count DESC"
        : "ORDER BY c.review_count DESC, c.name ASC"
      : `ORDER BY ${SORTS[params.sort] ?? SORTS.name}`;

  const rows = db
    .query<CigarRow, (string | number)[]>(
      `SELECT c.id, c.name, c.brand, c.length_in, c.length_mm, c.ring_gauge, c.country,
              c.filler, c.wrapper, c.color, c.strength, c.review_count,
              c.source_name, c.source_ref, c.source_url
       FROM ${from} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(...args, params.limit, params.offset);

  return { data: rows, total };
}

export function getCigar(id: string): CigarRow | null {
  return (
    getDb()
      .query<CigarRow, [string]>(
        `SELECT id, name, brand, length_in, length_mm, ring_gauge, country, filler,
                wrapper, color, strength, review_count, source_name, source_ref, source_url
         FROM cigars WHERE id = ?`,
      )
      .get(id.toUpperCase()) ?? null
  );
}

export interface BrandRow {
  name: string;
  cigar_count: number;
  countries: string | null;
}

export function listBrands(params: { limit: number; offset: number; q?: string }): Page<BrandRow> {
  const db = getDb();
  const where = ["brand IS NOT NULL"];
  const args: (string | number)[] = [];
  if (params.q) {
    where.push("brand LIKE ? COLLATE NOCASE");
    args.push(`${params.q}%`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = db
    .query<{ n: number }, (string | number)[]>(
      `SELECT COUNT(DISTINCT brand) AS n FROM cigars ${whereSql}`,
    )
    .get(...args)!.n;

  const rows = db
    .query<BrandRow, (string | number)[]>(
      `SELECT brand AS name, COUNT(*) AS cigar_count,
              (SELECT country FROM cigars c2 WHERE c2.brand = cigars.brand AND country IS NOT NULL
               GROUP BY country ORDER BY COUNT(*) DESC LIMIT 1) AS countries
       FROM cigars ${whereSql}
       GROUP BY brand ORDER BY cigar_count DESC, brand ASC LIMIT ? OFFSET ?`,
    )
    .all(...args, params.limit, params.offset);

  return { data: rows, total };
}

export interface FacetRow {
  value: string;
  count: number;
}

export function facet(column: "country" | "strength" | "color"): FacetRow[] {
  return getDb()
    .query<FacetRow, []>(
      `SELECT ${column} AS value, COUNT(*) AS count FROM cigars
       WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC`,
    )
    .all();
}

/**
 * Follows the redirect chain for a merged-away id. Returns null if `id`
 * isn't a redirect at all (the caller should then look it up directly).
 */
export function resolveRedirect(id: string): string | null {
  let next = id.toUpperCase();
  let resolved: string | null = null;
  const seen = new Set<string>();
  for (let hop = 0; hop < 10; hop++) {
    const row = getDb()
      .query<{ to_id: string }, [string]>("SELECT to_id FROM redirects WHERE from_id = ?")
      .get(next);
    if (!row || seen.has(row.to_id)) break;
    seen.add(row.to_id);
    resolved = row.to_id;
    next = row.to_id;
  }
  return resolved;
}

function ftsDelete(db: Database, rowid: number, name: string, brand: string | null) {
  db.prepare("INSERT INTO cigars_fts(cigars_fts, rowid, name, brand) VALUES ('delete', ?, ?, ?)").run(
    rowid,
    name,
    brand ?? "",
  );
}

function ftsInsert(db: Database, rowid: number, name: string, brand: string | null) {
  db.prepare("INSERT INTO cigars_fts(rowid, name, brand) VALUES (?, ?, ?)").run(rowid, name, brand ?? "");
}

export interface CigarUpdateInput {
  name: string;
  brand: string | null;
  length_in: number | null;
  length_mm: number | null;
  ring_gauge: number | null;
  country: string | null;
  filler: string | null;
  wrapper: string | null;
  color: string | null;
  strength: string | null;
}

/** Updates an editable cigar's fields, keeping the FTS5 index in sync. */
export function updateCigar(id: string, patch: CigarUpdateInput): CigarRow | null {
  const db = getWritableDb();
  const upper = id.toUpperCase();

  const existing = db
    .query<{ rowid: number; name: string; brand: string | null }, [string]>(
      "SELECT rowid, name, brand FROM cigars WHERE id = ?",
    )
    .get(upper);
  if (!existing) return null;

  const tx = db.transaction(() => {
    ftsDelete(db, existing.rowid, existing.name, existing.brand);
    db.prepare(
      `UPDATE cigars SET name = ?, brand = ?, length_in = ?, length_mm = ?, ring_gauge = ?,
              country = ?, filler = ?, wrapper = ?, color = ?, strength = ?
       WHERE id = ?`,
    ).run(
      patch.name,
      patch.brand,
      patch.length_in,
      patch.length_mm,
      patch.ring_gauge,
      patch.country,
      patch.filler,
      patch.wrapper,
      patch.color,
      patch.strength,
      upper,
    );
    ftsInsert(db, existing.rowid, patch.name, patch.brand);
  });
  tx();

  return getCigar(upper);
}

export type MergeResult =
  | { ok: true; survivor: CigarRow }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Merges `duplicateId` into `survivorId` (OCP-0005 duplicate resolution):
 * the survivor keeps its id and absorbs the duplicate's review count, the
 * duplicate row is removed, and its id becomes a permanent redirect. Any
 * existing redirects pointing at the duplicate are re-pointed at the
 * survivor so no reference is ever left dangling.
 */
export function mergeCigars(survivorId: string, duplicateId: string): MergeResult {
  const db = getWritableDb();
  const survivorUpper = survivorId.toUpperCase();
  const duplicateUpper = duplicateId.toUpperCase();

  if (survivorUpper === duplicateUpper) {
    return { ok: false, status: 400, error: "Cannot merge a cigar into itself" };
  }

  const survivor = db
    .query<{ rowid: number; review_count: number }, [string]>(
      "SELECT rowid, review_count FROM cigars WHERE id = ?",
    )
    .get(survivorUpper);
  const duplicate = db
    .query<{ rowid: number; name: string; brand: string | null; review_count: number }, [string]>(
      "SELECT rowid, name, brand, review_count FROM cigars WHERE id = ?",
    )
    .get(duplicateUpper);

  if (!survivor) return { ok: false, status: 404, error: "Survivor cigar not found" };
  if (!duplicate) return { ok: false, status: 404, error: "Duplicate cigar not found" };

  const tx = db.transaction(() => {
    ftsDelete(db, duplicate.rowid, duplicate.name, duplicate.brand);
    db.prepare("DELETE FROM cigars WHERE id = ?").run(duplicateUpper);
    db.prepare("UPDATE cigars SET review_count = review_count + ? WHERE id = ?").run(
      duplicate.review_count,
      survivorUpper,
    );
    db.prepare("UPDATE redirects SET to_id = ? WHERE to_id = ?").run(survivorUpper, duplicateUpper);
    db.prepare(
      "INSERT OR REPLACE INTO redirects (from_id, to_id, created_at) VALUES (?, ?, ?)",
    ).run(duplicateUpper, survivorUpper, new Date().toISOString());
  });
  tx();

  return { ok: true, survivor: getCigar(survivorUpper)! };
}

export function stats() {
  const db = getDb();
  const cigars = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM cigars").get()!.n;
  const brands = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT brand) AS n FROM cigars WHERE brand IS NOT NULL")
    .get()!.n;
  const countries = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT country) AS n FROM cigars WHERE country IS NOT NULL")
    .get()!.n;
  const ingested = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get("ingested_at");
  return { cigars, brands, countries, ingested_at: ingested?.value ?? null };
}
