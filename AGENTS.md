<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Commands

- `pnpm dev` — Next.js dev server (port from `$CONDUCTOR_PORT` in Conductor)
- `pnpm build` / `pnpm start` — production build + serve
- `pnpm lint` — ESLint (run after edits; PostToolUse hook does this automatically)
- `pnpm test` — Vitest, real `better-sqlite3` in-memory, no mocks of `src/core`
- `pnpm db:generate` — drizzle-kit, after editing `src/core/schema.ts`
- `pnpm db:migrate` — apply pending migrations to the local DB

# Project structure

- `src/core/` — domain layer (DB, items, projects, audit, fractional indexing). Pure, no React/Next/MCP imports. See `src/core/AGENTS.md`.
- `src/mcp/` — MCP tool surface. See `src/mcp/AGENTS.md`.
- `src/app/` — Next.js App Router (pages + Server Actions). See `src/app/AGENTS.md`.
- `src/components/` — React UI (shadcn-style primitives in `src/components/ui/`).
- `src/lib/` — small framework-agnostic helpers (auth stub, time formatting).
- `scripts/` — operational scripts (smoke, backup). Not part of the app bundle.

# Boundaries

## Audit log invariant

Every state-changing DB operation MUST write an `audit_log` row **in the same
transaction** as the mutation (`recordAudit()` in `src/core/audit.ts`). The log
must never be able to drift from the data, so a mutation and its audit row
commit or fail together — never write one without the other.

- Thread `source: AuditSource` ('web' | 'mcp') from the caller. Server Actions
  pass `'web'`, MCP tools pass `'mcp'`. Never silently default it — the whole
  point is knowing who changed what.
- Audit the meaningful user action, not low-level helpers. e.g. `ensureCategory`
  (auto-creating an inline category as a side effect) is intentionally NOT
  audited — it would be noise; the parent item create/update is the logged
  event. Explicit `addCategory` IS audited.
- If nothing actually changed (no-op edit), do not write an audit row.
- `audit_log` deliberately has NO foreign key / cascade to `projects`: deleting
  a project must keep its audit history so the deletion itself stays auditable.
  Do not "fix" this by adding a cascade.
- New mutating core functions and new MCP tools are not complete until they
  record audit. Treat a missing audit row as a bug.
