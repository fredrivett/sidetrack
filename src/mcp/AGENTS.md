# src/mcp — MCP tool surface

Thin wrapper exposing `src/core` functions as MCP tools. Every tool MUST pass
`SOURCE` to the core function. It's declared once at the top of
`registerTools()` as `{ source: "mcp", agent }`, from the API key that
authenticated the request, so the audit log records which agent acted.

## Conventions

- **Register tools** with `server.registerTool(name, def, handler)` inside
  `registerTools()` in `tools.ts`. Don't create new files per tool — keep them
  co-located so the surface is reviewable in one read.
- **Naming:** tool names and input fields are `snake_case` (MCP convention),
  even though the core API uses `camelCase`. Translate at the boundary.
- **Validation:** input shapes are Zod schemas. Reuse the existing
  `Status` / `PosRef` / `ListPosRef` schemas instead of redefining
  enums or regexes.
- **Responses:** use the `json(value)` helper for success and `notFound(kind, id)`
  for missing entities. Check a project exists with `getProject` before mutating
  it, so the tool returns a clean error instead of throwing.
- **Item targeting:** resolve the incoming `id`/`item_id` with `resolveItemArg`,
  not `getItem`. It accepts a pasted short ref (`ENG-42`) or the internal nanoid
  and is fail-closed: on an ambiguous or unknown ref it returns an error and the
  tool performs no mutation — never guess an item. Pass the resolved `item.id` to
  the core function, and shape item-returning output with `withItemRef` /
  `withRefs` so the agent gets each item's display `ref` to echo back.
- **Tests:** behaviour the tool layer owns (ref resolution, positions,
  output shaping, error results) is tested in `tools.test.ts` through a real
  MCP client and an in-memory DB; core behaviour is tested in `src/core`.
- **Descriptions are agent-facing.** Write the `description` field as
  instructions for how the calling agent should render or use the result —
  see `list_all_items` and `add_item` for the tree-rendering pattern.

## Capabilities: what agents can do

Anything a person can do in the app, an agent can do through MCP, through
the same core function, so the same rules and audit apply. The only
exceptions are an action that:

- **credential**: creates, shows or redirects a secret (API keys, agent and
  GitHub webhooks, calendar connections, inbound email addresses, push
  subscriptions). A leaked key must never be able to widen its own reach.
- **identity**: changes how the person appears to others (username,
  avatar). That comes from them.
- **view**: is the app's own UI or devices, meaning nothing outside it
  (folded sections, filters, the greeting's read state, a test push).
- **background**: is something the app does on its own (time zone sync,
  install tracking, calendar sync).

"It's a setting", "it's rarely needed" or "it's destructive" aren't
exceptions: notification levels and deleting comments have tools. A
destructive tool goes through its audited core function, and its
description tells the agent to act only on what the user asked for.

`capabilities.test.ts` enforces this for Server Actions: every action in
`src/app/actions.ts` maps to the tool that does it or to one of the reasons
above, with a note. So a new action fails CI until you add its tool (or
extend an existing one, as `list_labels` covers label usage) or, only if one
of the reasons fits, exempt it. Never add a reason to get a test passing;
ask the user instead. API routes and Better Auth endpoints aren't checked,
so apply the same rule to a new one by hand.

When adding a tool, follow `.agents/skills/add-mcp-tool/SKILL.md` to make sure
the schema → core fn → audit → tool registration steps all line up.
