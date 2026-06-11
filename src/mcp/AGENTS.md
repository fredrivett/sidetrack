# src/mcp — MCP tool surface

Thin wrapper exposing `src/core` functions as MCP tools. Every tool MUST pass
`SOURCE = "mcp"` to the core function (declared once at the top of `tools.ts`).

## Conventions

- **Register tools** with `server.registerTool(name, def, handler)` inside
  `registerTools()` in `tools.ts`. Don't create new files per tool — keep them
  co-located so the surface is reviewable in one read.
- **Naming:** tool names and input fields are `snake_case` (MCP convention),
  even though the core API uses `camelCase`. Translate at the boundary.
- **Validation:** input shapes are Zod schemas. Reuse the existing
  `Status` / `Kind` / `PosRef` / `ProjectPosRef` schemas instead of redefining
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
- **Descriptions are agent-facing.** Write the `description` field as
  instructions for how the calling agent should render or use the result —
  see `list_all_items` and `add_item` for the tree-rendering pattern.

When adding a tool, follow `.agents/skills/add-mcp-tool/SKILL.md` to make sure
the schema → core fn → audit → tool registration steps all line up.
