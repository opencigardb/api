import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const DB_PATH = process.env.OCDB_DATABASE_PATH ?? resolve(import.meta.dir, "../../data/ocdb.sqlite");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cigars (
  rowid        INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  brand        TEXT,
  length_in    REAL,
  length_mm    REAL,
  ring_gauge   INTEGER,
  country      TEXT,
  filler       TEXT,
  wrapper      TEXT,
  color        TEXT,
  strength     TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  source_name  TEXT NOT NULL,
  source_ref   TEXT,
  source_url   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cigars_brand ON cigars(brand);
CREATE INDEX IF NOT EXISTS idx_cigars_country ON cigars(country);
CREATE INDEX IF NOT EXISTS idx_cigars_strength ON cigars(strength);
CREATE INDEX IF NOT EXISTS idx_cigars_name ON cigars(name);

CREATE VIRTUAL TABLE IF NOT EXISTS cigars_fts USING fts5(
  name, brand, content='cigars', content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Merged-away cigar ids permanently redirect to the surviving id (OCP-0005).
CREATE TABLE IF NOT EXISTS redirects (
  from_id    TEXT PRIMARY KEY,
  to_id      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    if (!existsSync(DB_PATH)) {
      throw new Error(`Database not found at ${DB_PATH}. Run \`bun run ingest\` first.`);
    }
    db = new Database(DB_PATH, { readonly: true });
  }
  return db;
}

export function openWritable(path: string = DB_PATH): Database {
  const writable = new Database(path, { create: true });
  writable.exec("PRAGMA journal_mode = WAL;");
  writable.exec(SCHEMA);
  return writable;
}

let writableDb: Database | null = null;

/**
 * A second, long-lived connection used only by authenticated admin writes.
 * WAL mode (set once, persisted in the file) lets this and the read-only
 * `getDb()` connection coexist safely against the same file.
 */
export function getWritableDb(): Database {
  if (!writableDb) {
    writableDb = openWritable(DB_PATH);
  }
  return writableDb;
}
