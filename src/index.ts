import { app } from "./app";
import { getWritableDb } from "./db";

// Applies any new schema (tables/indexes) to the existing database file
// before the read-only connection starts serving traffic, so a deploy never
// has to rely on an admin write happening first to pick up a migration.
getWritableDb();

const port = Number(process.env.PORT ?? 3001);

const server = Bun.serve({ port, fetch: app.fetch });

console.log(`OCDB API listening on http://localhost:${server.port}`);
