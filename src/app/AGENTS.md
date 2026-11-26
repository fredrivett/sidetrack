# src/app — Next.js App Router

Server Components by default. UI composition lives here; reusable widgets live
in `src/components/`.

## Server Actions (`actions.ts`)

- File starts with `"use server"`. Every action passes `SOURCE = "web"`
  (declared once at the top) to its core function.
- Actions are thin wrappers around the matching `src/core` fn. Don't put
  business logic here — if you'd want to test it, it belongs in `src/core`.
- Call `refresh()` (which wraps `revalidatePath("/")`) after every mutating
  action so the kanban re-fetches, except item saves made in quick runs
  (ticking, dragging, nesting, editing, folding, deleting, adding a
  checklist line). Re-rendering a big board after each of those is slow, so
  they return the rows they changed instead (`readItems` or `savedRows`,
  reading every row core changed, such as a parent a tick completes), and
  the board puts them in (`useSavedItems`). Saves that change more than
  rows, such as labels (which can make new ones) or a move, still refresh.
  Live updates follow the same split (`Change.rows` in `src/core/changes.ts`).
- Import core functions with the `as ...Core` alias pattern already in use,
  e.g. `import { addItem as addItemCore } from "@/core/items"`. Keeps the
  exported action name short and avoids shadowing.
- Never write an inline Server Action: a `"use server"` function declared
  inside a component that closes over its variables. Next encrypts those
  captured values with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, and the
  published Docker image's key is public (`.github/workflows/image.yml`),
  so anyone could read or forge them. Pass values as arguments to an
  action in `actions.ts` instead, and check them on the server.

## AI reads (`api/ai/`)

- Next runs a page's Server Actions one at a time, so an action that waits
  seconds on a model holds up every save and read behind it (an item's
  comments sat on "Loading…" behind the greeting). A read that asks Jev or
  Claude is an AI read instead: an entry in `api/ai/reads.ts`, called with
  `aiRead(name, input, signal)` (`src/components/ai-read.ts`), which takes
  its types from that entry. ESLint blocks the AI modules in `actions.ts`.
- `api/ai/[read]/route.ts` makes the checks a Server Action would get for
  free, and more: same origin, signed in (the user comes from the session,
  never the body), a capped body, the entry's zod input, a per-user rate
  limit, and a bare status on failure. An entry only says what it reads.
- Pass the entry's `fetch` to the model call, so the request stops when the
  browser gives up on it (newer typing aborts the old suggestion). Use
  `fetchToEnd` only for work worth finishing anyway, like the greeting's
  shared cache. Both count the call's tokens toward the user's AI spend on
  /admin (`aiFetch`, `src/core/aiUsage.ts`); the global `fetch` doesn't, so
  the AI modules take no default. Saves and MCP tools pass `aiFetch` too.
- Saves that ask an AI along the way (sort by priority, a new list's icon)
  stay Server Actions: they change data, and a route can't refresh the page.

## Pages

- `page.tsx` is a Server Component that reads from `getDb()` directly.
- `export const dynamic = "force-dynamic"` is set deliberately — sidetrack is
  single-user-per-instance and the DB is local. Don't add caching.
