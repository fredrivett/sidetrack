---
name: learn
description: Capture a bug or defect as a candidate harness improvement appended to LEARNINGS.md for human triage.
---

# Capture a learning

Use after fixing a bug or noticing a recurring pattern that the harness
didn't catch. The point is to close the loop: every recurring defect should
become a permanent rule / test / hook, not a one-off prompt patch.

Don't invoke this for every fix — only when you can articulate a pattern.
If the bug is genuinely one-off, skip.

## Steps

1. **Identify the pattern.** What class of bug is this? Could the same
   mistake happen again in a different file? If the answer is "no, this is
   one-off," stop here — don't append.

2. **Pick the cheapest enforcement layer that would catch it next time.**
   In order of preference:
   - **ESLint rule** (`eslint.config.mjs`) — runs on every edit, zero cost.
   - **Vitest test** (`src/**/*.test.ts`) — catches behavioural regressions.
   - **PostToolUse hook** (`.claude/settings.json`) — for mechanical checks
     that don't fit a linter (e.g. grep for a forbidden pattern).
   - **AGENTS.md entry** — advisory; only when the above don't fit.

3. **Append to `LEARNINGS.md`** under the `## Drafts` section, in this
   format:

   ```markdown
   ### YYYY-MM-DD — <short symptom>

   **Symptom:** What went wrong, with file:line.
   **Root cause:** Why it happened. Be specific — "agent forgot X" is not
   a root cause.
   **Candidate:** Layer + concrete rule. e.g. "ESLint: ban
   `Date.now()` outside `src/lib/time.ts`."
   **Status:** draft
   ```

4. **Do not promote it yourself.** Leave it as `draft` for human review.
   The maintainer triages in batches — see the top of `LEARNINGS.md`.

## Anti-patterns

- Appending an entry that just restates the bug ("don't break X") without
  identifying which layer would mechanically prevent it. Without a layer
  proposal, the entry can't be triaged.
- One entry per bug fix. Most fixes are one-off; only patterns earn an entry.
- Promoting straight to `eslint.config.mjs` / hooks without review. The
  triage step is the load-bearing one — it forces a sanity check before
  permanent harness changes.
