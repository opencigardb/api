import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DB_PATH, openWritable } from "../src/db/index";
import { buildBrandResolver } from "../src/lib/brands";
import { deriveUlid } from "../src/lib/id";

interface SourceRecord {
  id: number;
  name: string;
  source_url?: string;
  dimensions?: { length_inches?: number | null; length_mm?: number | null; ring_gauge?: number | null };
  country?: string | null;
  filler?: string | null;
  wrapper?: string | null;
  color?: string | null;
  strength?: string | null;
  reviews?: { count?: number };
}

const inputPath = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../cigargeeks_results.json"));
if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

console.log(`Reading ${inputPath}...`);
const records: SourceRecord[] = await Bun.file(inputPath).json();
console.log(`${records.length} records`);

console.log("Deriving brands...");
const resolveBrand = buildBrandResolver(records.map((r) => r.name));

mkdirSync(dirname(DB_PATH), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db = openWritable();

const insert = db.prepare(
  `INSERT INTO cigars (id, name, brand, length_in, length_mm, ring_gauge, country,
                       filler, wrapper, color, strength, review_count,
                       source_name, source_ref, source_url)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const ingestAll = db.transaction((rows: SourceRecord[]) => {
  for (const r of rows) {
    if (!r.name?.trim()) continue;
    insert.run(
      deriveUlid(`cigargeeks:${r.id}`),
      r.name.trim(),
      resolveBrand(r.name),
      r.dimensions?.length_inches ?? null,
      r.dimensions?.length_mm ?? null,
      r.dimensions?.ring_gauge ?? null,
      r.country ?? null,
      r.filler ?? null,
      r.wrapper ?? null,
      r.color ?? null,
      r.strength ?? null,
      r.reviews?.count ?? 0,
      "cigargeeks",
      String(r.id),
      r.source_url ?? null,
    );
  }
});
console.log("Inserting...");
ingestAll(records);

console.log("Building search index...");
db.exec("INSERT INTO cigars_fts(rowid, name, brand) SELECT rowid, name, brand FROM cigars;");
db.exec("INSERT INTO cigars_fts(cigars_fts) VALUES ('optimize');");
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
  "ingested_at",
  new Date().toISOString(),
);
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM cigars").get()!.n;
const brandCount = db
  .query<{ n: number }, []>("SELECT COUNT(DISTINCT brand) AS n FROM cigars WHERE brand IS NOT NULL")
  .get()!.n;
console.log(`Done: ${count} cigars, ${brandCount} brands → ${DB_PATH}`);
db.close();
