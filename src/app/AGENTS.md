# src/app — Next.js App Router

Server Components by default. UI composition lives here; reusable widgets live
in `src/components/`.

## Server Actions (`actions.ts`)

- File starts with `"use server"`. Every action passes `SOURCE = "web"`
  (declared once at the top) to its core function.
- Actions are thin wrappers around the matching `src/core` fn. Don't put
  business logic here — if you'd want to test it, it belongs in `src/core`.
- Call `refresh()` (which wraps `revalidatePath("/")`) after every mutating
  action so the kanban re-fetches.
- Import core functions with the `as ...Core` alias pattern already in use,
  e.g. `import { addItem as addItemCore } from "@/core/items"`. Keeps the
  exported action name short and avoids shadowing.

## Pages

- `page.tsx` is a Server Component that reads from `getDb()` directly.
- `export const dynamic = "force-dynamic"` is set deliberately — sidetrack is
  single-user-per-instance and the DB is local. Don't add caching.
