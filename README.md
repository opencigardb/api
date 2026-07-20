# Open Cigar DB — REST API

Read-only REST API for the Open Cigar DB catalog, per
[RFC-0004](../docs/rfcs/RFC-0004-rest-api-specification.md).

Stack: [Hono](https://hono.dev) + TypeScript on Bun. Storage is SQLite
(`bun:sqlite`) behind a repository layer (`src/db/repository.ts`) so the
route layer stays untouched when we migrate to PostgreSQL.

## Setup

```sh
bun install
bun run ingest     # builds data/ocdb.sqlite from ../cigargeeks_results.json
bun run dev        # serves http://localhost:3001
```

`bun run ingest [path]` accepts an alternate input file. The database path
can be overridden with `OCDB_DATABASE_PATH`.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /healthz` | Liveness check |
| `GET /v1/cigars` | List/search cigars. Params: `q`, `brand`, `country`, `strength`, `color`, `sort` (`name`, `-name`, `reviews`, `-reviews`, `relevance`), `limit` (≤100), `offset` |
| `GET /v1/cigars/{id}` | Fetch one cigar by ULID. 301-redirects if the id was merged away |
| `GET /v1/brands` | Brands derived from cigar names. Params: `q` (prefix), `limit`, `offset` |
| `GET /v1/countries` | Country facet with counts |
| `GET /v1/strengths` | Strength facet with counts |
| `GET /v1/colors` | Wrapper color facet with counts |
| `GET /v1/stats` | Catalog totals |
| `GET /v1/ledger` | Public funding ledger: transactions with running balance, plus summary totals |
| `POST /v1/auth/login` | Verify admin credentials. Body: `{ username, password }`. Returns `{ data: { id, username } }` or 401 |
| `GET /v1/admin/ledger` | Same as `/v1/ledger` but includes `created_by`/`updated_by`. Requires admin token |
| `POST /v1/admin/ledger` | Create a ledger entry. Requires admin token |
| `PATCH /v1/admin/ledger/{id}` | Replace a ledger entry's fields. Requires admin token |
| `DELETE /v1/admin/ledger/{id}` | Remove a ledger entry. Requires admin token |
| `PATCH /v1/admin/cigars/{id}` | Edit a cigar's fields. Requires admin token |
| `POST /v1/admin/cigars/merge` | Merge a duplicate into a survivor. Body: `{ survivor_id, duplicate_id }`. Requires admin token |

Collection responses are `{ data, pagination: { total, limit, offset } }`;
errors are `{ error: { code, message } }`.

## Identifiers

Cigar ids are ULID-format strings derived deterministically from the source
record (`sha256("cigargeeks:<id>")` in Crockford base32), so ids survive
re-ingestion, per RFC-0004's immutability requirement.

## Notes

- The source dataset has no brand field; brands are derived statistically
  from name prefixes (`src/lib/brands.ts`).
- Search uses SQLite FTS5 with prefix matching.
- The ledger (`/v1/ledger`) is backed by a hand-maintained file, not the
  catalog database — see `src/ledger/README.md` for its schema and how to
  add real transactions.

## Admin accounts

There is no public registration endpoint. Create an admin locally with:

```sh
bun run create-admin <username> <password>
```

This inserts into the `admins` table with an argon2id password hash
(`Bun.password`, no extra dependency). `/v1/auth/login` only verifies
credentials and returns the admin's identity — it does not issue a session
itself. Session/cookie handling lives in the web app
(`web/lib/session.ts`), which calls this endpoint server-to-server from a
Next.js Route Handler, so the API never needs to manage cookies or CORS
credentials.

The username/password are passed as CLI args, so they're briefly visible in
shell history and `ps` on your own machine — fine for a personal bootstrap
step, not something to script against a shared or production shell.

## Admin write endpoints

`/v1/admin/*` routes require `Authorization: Bearer <ADMIN_API_TOKEN>` (set
in `.env.local`, see `.env.local.example`) plus an `x-admin-username` header
identifying which admin is acting. This is a shared-secret trust boundary
between this API and the Next.js web app, not a per-admin credential — the
web app verifies the admin's own session cookie itself, then relays the
write here. The browser never sees this token; it only ever travels
server-to-server. `ADMIN_API_TOKEN` must match exactly between
`api/.env.local` and `web/.env.local`.

## Catalog moderation

The catalog is served from a read-only connection (`getDb()`) for safety;
admin edits use a second, long-lived writable connection (`getWritableDb()`)
against the same SQLite file, coordinated through WAL mode. Editing a cigar
(`PATCH /v1/admin/cigars/{id}`) updates the row and its FTS5 search index
entry in one transaction — the index doesn't sync automatically since
`cigars_fts` is an external-content table with no triggers, so this has to
be done by hand on every write that touches `name`/`brand`.

Merging (`POST /v1/admin/cigars/merge`) implements OCP-0005's duplicate
resolution: the survivor keeps its id and absorbs the duplicate's
`review_count`; the duplicate row is deleted; its id becomes a permanent
redirect row in the `redirects` table. `GET /v1/cigars/{id}` checks this
table first and 301s to the survivor if the id was merged away, so old
links and bookmarks never break. There's no admin UI to un-merge — get the
survivor right before confirming.

## Git as canonical source

Per RFC-0001/0002/0003, git — not this API's SQLite cache — is meant to be
the canonical source of catalog and ledger data. `src/git/commit.ts` is the
shared mechanism: given a repo path and file(s), it stages, commits (as the
acting admin), and pushes, synchronously, using a one-off token-embedded
push URL (never written to `.git/config`) built from `GIT_PUSH_TOKEN`. The
ledger (`src/ledger/repository.ts`) already uses this for every write — see
`src/ledger/README.md`. Catalog data migration into git-backed JSON
(`catalog/manufacturers/**`, scoped to Manufacturer + Brand for now — see
`api/scripts/migrate-catalog.ts`) is in progress; the live
`updateCigar`/`mergeCigars` SQLite writes have **not** yet been rerouted to
write through git, since that depends on the full Cigar entity migration
being unblocked first (see `schemas/README.md` and
`docs/data-model/catalog/product-line.md`'s placeholder-naming rule).
