# src/core — domain layer

Pure DB-facing logic. No React, no Next.js, no MCP types — anything in here
must be callable from both Server Actions (`src/app`) and MCP tools (`src/mcp`).

## Conventions

- **Function signature for mutations:** `(db: Db, input, source: AuditOrigin)`.
  The caller threads `source`; this file never knows whether it was called
  from the web or MCP, or by which agent. See root `AGENTS.md` for the audit-log invariant.
- **Transactions:** wrap the mutation + `recordAudit(...)` in
  `db.transaction((tx) => { ... })`. Pass `tx as unknown as Db` to helpers —
  drizzle's tx type isn't assignable to our `Db` alias but the runtime is the
  same. Existing files all do this; copy the pattern.
- **Positions are fractional-index strings.** Never compute one by hand. Use
  `resolvePosition` from `fracidx.ts` (items and lists alike), and order by
  `(position, id)` so ties stay stable. An item's position orders it among its
  siblings: top-level items, or one parent's sub-items (`parentId`, one level
  deep). `position` is only "where it sits in the list": completing or
  reopening an item never moves it — the UI decides where finished items show (in place today, Done for the rest of the
  week, then off the board; see `startOfDay` and `startOfWeek` in
  `src/lib/time.ts`).
- **Schema changes** go in `schema.ts`, then run `pnpm db:generate` to emit a
  new file under `src/core/migrations/`. Migrations are applied automatically
  by `src/instrumentation.ts` on app start.
