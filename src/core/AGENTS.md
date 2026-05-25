# src/core — domain layer

Pure DB-facing logic. No React, no Next.js, no MCP types — anything in here
must be callable from both Server Actions (`src/app`) and MCP tools (`src/mcp`).

## Conventions

- **Function signature for mutations:** `(db: Db, input, source: AuditSource)`.
  The caller threads `source`; this file never knows whether it was called
  from the web or MCP. See root `AGENTS.md` for the audit-log invariant.
- **Transactions:** wrap the mutation + `recordAudit(...)` in
  `db.transaction((tx) => { ... })`. Pass `tx as unknown as Db` to helpers —
  drizzle's tx type isn't assignable to our `Db` alias but the runtime is the
  same. Existing files all do this; copy the pattern.
- **Positions are fractional-index strings.** Never compute one by hand. Use
  `resolveItemPosition` / `resolveProjectPosition` / `resolveComplete...` /
  `resolveUncomplete...` from `fracidx.ts`. The completed/active split lives
  there too — read the header comment in `fracidx.ts` before touching it.
- **Schema changes** go in `schema.ts`, then run `pnpm db:generate` to emit a
  new file under `src/core/migrations/`. Migrations are applied automatically
  by `src/instrumentation.ts` on app start.
