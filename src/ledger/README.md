# Ledger data

`entries.json` is the source of truth for the public funding ledger served at
`GET /v1/ledger`. Real transactions (a sponsorship payout, a hosting bill, a
domain renewal) belong here as they happen — no fabricated or placeholder
entries; an empty `entries` array is the honest state until real money moves.

Entries can be added, edited, and removed either by hand-editing this file
or through the admin UI at `/admin/ledger` in the web app (see
`POST/PATCH/DELETE /v1/admin/ledger` below) — both write the same file, so
they stay interchangeable.

## Schema

```jsonc
{
  "updated_at": "2026-07-19T00:00:00.000Z", // bumped on every entries[] change
  "entries": [
    {
      "id": "b3f1...",                   // crypto.randomUUID(), assigned once, never reused
      "date": "2026-08-01",              // YYYY-MM-DD
      "type": "income",                  // "income" | "expense"
      "source": "Open Collective",       // funding channel or expense payee
      "category": "Sponsorship",         // e.g. Sponsorship, Hosting, Domain, Tooling
      "description": "Monthly recurring backers, July 2026",
      "amount_usd": 42.5,                // always positive; sign comes from `type`
      "reference_url": "https://opencollective.com/opencigardb/transactions/...", // optional
      "created_by": "garrett",           // admin username, or hand-edited if blank
      "created_at": "2026-08-01T12:00:00.000Z",
      "updated_by": null,
      "updated_at": null
    }
  ]
}
```

`created_by`/`updated_by` are for internal accountability only — the public
`GET /v1/ledger` strips them before responding, since the transparency
commitment is about the money, not admin identities. The authenticated
`GET /v1/admin/ledger` returns them for the admin UI.

`src/ledger/repository.ts` sorts entries chronologically, computes a running
balance, and returns totals. Writes go through a temp-file-then-rename so a
crash mid-write can't corrupt the file.

Every admin write (`createLedgerEntry`/`updateLedgerEntry`/
`deleteLedgerEntry`) automatically commits and pushes `entries.json` to this
repo's GitHub remote via `src/git/commit.ts`, synchronously — the request
doesn't return success until the push actually lands. This is what makes
git the real canonical source rather than a manually-maintained mirror: the
file on GitHub is never stale relative to what the API is serving. Requires
`GIT_PUSH_TOKEN` in `.env.local` (see `.env.local.example`). If the push
fails (network issue, revoked token), the write returns `502
git_sync_failed` — the local file and local commit are left intact
(unpushed, not rolled back) rather than silently reporting success on data
that isn't durable yet.

## Planned automation

This is intentionally a flat file so a future sync job (e.g. polling the
Open Collective API, or GitHub Sponsors webhooks) can write to it directly
without changing `repository.ts` or the API contract.
