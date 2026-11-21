---
name: add-mcp-tool
description: Add a new MCP tool that exposes a core mutation, with audit logging wired in correctly.
---

# Add an MCP tool

Use when adding a tool to `src/mcp/tools.ts` that mutates state. The point of
this skill is to make sure the audit-log invariant (see root `AGENTS.md`) is
satisfied — every state-changing tool MUST write an `audit_log` row in the
same transaction as the mutation, with the tool's `SOURCE` (`"mcp"` plus the
calling agent's API key).

Follow each step in order. Don't skip the test — a tool without a test that
asserts the audit row was written is incomplete.

## Steps

1. **Schema (only if you need new columns).** Edit `src/core/schema.ts`. Add
   to `AUDIT_ACTIONS` / `AUDIT_ENTITIES` if the mutation introduces a new
   action or entity type. Then run `pnpm db:generate` to emit a new file
   under `src/core/migrations/`. Migrations apply automatically on app start
   via `src/instrumentation.ts`.

2. **Core function.** Add to the relevant file under `src/core/` (or create
   a new one if the entity is new). The signature follows
   `(db: Db, input, source: AuditOrigin)` and returns the concrete entity type
   for the mutation — e.g. `Item` (`addItem`), `Project` (`createProject`), or
   `void` (`deleteItem`). The body MUST wrap the mutation and `recordAudit(...)`
   in `db.transaction((tx) => { ... })`. Copy the pattern from `addItem` in
   `src/core/items.ts`. If the mutation is a no-op (nothing actually changed),
   return early WITHOUT writing audit.

3. **Tool registration.** Add to `registerTools()` in `src/mcp/tools.ts`:
   - `snake_case` tool name and input field names (MCP convention).
   - Reuse existing Zod schemas (`Status`, `PosRef`, `ListPosRef`)
     where applicable.
   - Use `json(value)` for success, `notFound(kind, id)` for missing entities.
   - Pass `SOURCE` to the core fn. It's an `AuditOrigin` built at the top of
     `registerTools()` as `{ source: "mcp", agent: ctx.agent }`.
   - Write the `description` field as instructions for the calling agent —
     how to render or use the result. See `list_all_items` / `add_item` for
     the rendering convention.

4. **Test.** Add a test in `src/core/<entity>.test.ts` (or create one) that
   exercises the core fn through a real in-memory DB (`createTestDb()`) and
   asserts BOTH:
   - the data mutation took effect
   - `listAudit(db)` contains a matching row with the correct
     `source`, `action`, `entityType`, and `entityId`.

   The tool layer has logic of its own too: ref resolution that refuses to
   guess (`resolveItemArg`), position anchors by ref (`resolvePositionArg`),
   output shaping (`forAgent`: `project*` keys renamed to `list*`, `repeat`,
   `comesBack` in the user's time zone), input checks the core doesn't make
   (e.g. `parent` with `sub_items`), and error results that say no change was
   made. When the tool adds or changes any of that, test it in
   `src/mcp/tools.test.ts` through the tool interface: `connectAs(userId)`
   calls tools through a real MCP client against `createTestDb()`, with only
   the DB singleton and env stubbed. Assert what the agent gets back and,
   for an error, that nothing changed in the DB. Don't repeat core
   behaviour there that the core tests already cover.

5. **Capability map.** If the tool does what a Server Action does, point
   that action at it in `src/mcp/capabilities.test.ts` (replacing any
   exemption). Adding a Server Action means doing this too: give it a tool,
   or exempt it only for one of the reasons in `src/mcp/AGENTS.md`
   ("Capabilities").

6. **Verify.** Run `pnpm test` and `pnpm lint`. Both must pass before the
   tool is considered shipped.

## Anti-patterns

- Audit row outside the transaction (`recordAudit` after `db.transaction(...)`
  returns) — the log can drift from the data.
- Defaulting `source` inside the core fn — always thread from the caller.
- Calling `recordAudit` from `ensureCategory`-style helpers — audit the
  meaningful user action, not the side effect.
- Adding a foreign key from `audit_log` to `projects` — deletion must keep
  audit history.
