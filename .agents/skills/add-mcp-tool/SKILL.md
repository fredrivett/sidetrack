---
name: add-mcp-tool
description: Add a new MCP tool that exposes a core mutation, with audit logging wired in correctly.
---

# Add an MCP tool

Use when adding a tool to `src/mcp/tools.ts` that mutates state. The point of
this skill is to make sure the audit-log invariant (see root `AGENTS.md`) is
satisfied — every state-changing tool MUST write an `audit_log` row in the
same transaction as the mutation, with `source: "mcp"`.

Follow each step in order. Don't skip the test — a tool without a test that
asserts the audit row was written is incomplete.

## Steps

1. **Schema (only if you need new columns).** Edit `src/core/schema.ts`. Add
   to `AUDIT_ACTIONS` / `AUDIT_ENTITIES` if the mutation introduces a new
   action or entity type. Then run `pnpm db:generate` to emit a new file
   under `src/core/migrations/`. Migrations apply automatically on app start
   via `src/instrumentation.ts`.

2. **Core function.** Add to the relevant file under `src/core/` (or create
   a new one if the entity is new). Signature MUST be
   `(db: Db, input, source: AuditSource): Result`. The body MUST wrap the
   mutation and `recordAudit(...)` in `db.transaction((tx) => { ... })`. Copy
   the pattern from `addItem` in `src/core/items.ts`. If the mutation is a
   no-op (nothing actually changed), return early WITHOUT writing audit.

3. **Tool registration.** Add to `registerTools()` in `src/mcp/tools.ts`:
   - `snake_case` tool name and input field names (MCP convention).
   - Reuse existing Zod schemas (`Status`, `Kind`, `PosRef`, `ProjectPosRef`)
     where applicable.
   - Use `json(value)` for success, `notFound(kind, id)` for missing entities.
   - Pass `SOURCE` (declared at top of file as `"mcp"`) to the core fn.
   - Write the `description` field as instructions for the calling agent —
     how to render or use the result. See `list_all_items` / `add_item` for
     the rendering convention.

4. **Test.** Add a test in `src/core/<entity>.test.ts` (or create one) that
   exercises the core fn through a real in-memory DB (`createTestDb()`) and
   asserts BOTH:
   - the data mutation took effect
   - `listAudit(db)` contains a matching row with the correct
     `source`, `action`, `entityType`, and `entityId`.

   Do not test the MCP tool wrapper directly — it's a thin Zod + JSON
   adapter. Testing the core fn is what matters.

5. **Verify.** Run `pnpm test` and `pnpm lint`. Both must pass before the
   tool is considered shipped.

## Anti-patterns

- Audit row outside the transaction (`recordAudit` after `db.transaction(...)`
  returns) — the log can drift from the data.
- Defaulting `source` inside the core fn — always thread from the caller.
- Calling `recordAudit` from `ensureCategory`-style helpers — audit the
  meaningful user action, not the side effect.
- Adding a foreign key from `audit_log` to `projects` — deletion must keep
  audit history.
