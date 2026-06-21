# Sidetrack — v0.1 launch spec

Tracking the work to get Sidetrack to a public launch. Shape: **hosted (sidetrack.it,
open signup, free) + OSS / self-host together**. Milestone: **v0.1** (early/beta — ships
to invite feedback, room to iterate publicly).

This mirrors the intended `SDT` board structure: tasks grouped by category, ending in a
`v0.1 launch` milestone. Once the Sidetrack MCP write tools are approved, these become
items in the `Sidetrack` project.

> Note: SDT-12 ("Echo touched item's description inline…") is a pre-existing item, not part
> of this launch block.

## UI & UX polish

- [ ] **Re-skin the UI / visual identity pass** — _task one._ Palette, typography, spacing,
  logo/wordmark, favicon, PWA app icons. Restyle the board (columns, item rows,
  ItemDetailSheet, menus, buttons) via Tailwind v4 theme tokens on the existing shadcn/ui
  primitives in `src/components/ui/` — don't hand-roll new components. Light/dark parity.
  Make the agent-first angle visible (render audit source web vs mcp nicely). Login/signup
  get the same treatment. Sets the design language the landing page inherits, so it's first.
- [ ] **"Connect an agent" first-run nudge** — the blank board already shows an "add project"
  column, so this is scoped narrowly to surfacing the non-obvious, high-value MCP step: a
  pointer to the API-key setup so new users discover the agent integration. Cut if it feels
  like overkill.
- [ ] **Audit & improve error states** — `error.tsx` / `global-error.tsx` are generic. Friendly
  copy, retry, and a not-found page.

## Agent / MCP integration

- [ ] **Improve agent tool discoverability** — so a prompt like "add a task to <project>"
  reliably routes to Sidetrack without the user naming the tool. Tune tool names/descriptions/
  annotations; test across Claude / Cursor / other MCP clients.
- [ ] **Scheduled-task recipes + showcase** — test Sidetrack driven by scheduled agent runs;
  ship copy-paste recipes (daily board triage, standup summary, auto-file tasks from
  elsewhere) so users adopt the pattern with zero friction. Doubles as marketing content.

## Marketing site

- [ ] **Public landing page at sidetrack.it** — simple one-pager. Today `/` redirects to
  `/login`, so unauthenticated visitors see nothing. Value prop (agent-first kanban, MCP,
  audit log, self-host), screenshots, CTA (sign up / self-host).
- [ ] **Demo GIF / video** — agent updating the board live (the "wow"). Reused across
  HN/Reddit/X/PH.
- [ ] **SEO + OG/meta tags, sitemap, robots.txt** — only basic metadata today.
- [ ] **"How it works" / MCP setup + usage docs** — copy-paste guide to connect an agent to a
  Sidetrack key; home for the scheduled-task recipes.

## Legal & trust

- [ ] **Privacy policy** — blocker for public hosted signup (GDPR). Boilerplate generator OK
  for v0.1.
- [ ] **Terms of service** — boilerplate generator OK for v0.1.
- [ ] **Analytics / cookie consent** — confirm what's needed client-side for PostHog on hosted.

## Hosted readiness (sidetrack.it, open signup)

- [ ] **Open-signup hardening** — `ALLOW_SIGNUP=true` path: email verification, rate limiting,
  basic abuse prevention.
- [ ] **Confirm transactional email works in prod** — verify Resend actually sends
  password-reset and invite emails (today they can fall back to server logs).
- [ ] **Account deletion + data export** — GDPR self-serve; keep it simple. **Not exposed via
  MCP** — web only.
- [ ] **Backups + restore runbook** — prod SQLite backup schedule exists; document and test a
  real restore.
- [ ] **Monitoring / error tracking + uptime** — PostHog exceptions wired; add an uptime check.

## OSS / self-host (reeve-style)

- [ ] **README + self-host quickstart** — one-liner Docker run, env var table, screenshots.
- [ ] **Publish public Docker image (GHCR)** — so self-hosters don't build from source. Don't
  bake `NEXT_PUBLIC_POSTHOG_KEY` into the published image.
- [ ] **Self-host docs** — env vars, backup/restore, upgrade path, SQLite single-writer caveat.
- [ ] **CONTRIBUTING + license clarity + issue templates** — surface FSL-1.1 (LICENSE) and set
  contribution expectations.

## Pre-launch QA

- [ ] **E2E smoke tests (Playwright)** — none today. Cover signup → project → item → MCP
  round-trip.
- [ ] **Fresh-deploy test on a clean Railway env** — from scratch: migrations + first signup.
- [ ] **MCP client test across Claude / Cursor / others** — confirm key + tool surface work in
  each.
- [ ] **Cross-browser + accessibility pass.**

## Launch mechanics

- [ ] **Launch copy: Show HN.**
- [ ] **Launch copy: Reddit** — r/SideProject warm-up, r/selfhosted, an agent/Claude sub.
- [ ] **Launch copy: X/Twitter thread.**
- [ ] **Product Hunt assets** — gallery, tagline, first comment.
- [ ] **Cut the v0.1.0 release + tag** — final step once everything above is green.

---

`─ ─ ─  v0.1 launch  ─ ─ ─`
