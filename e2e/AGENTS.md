# e2e — end-to-end tests (Playwright)

The browser tests that prove the user-facing flows work against the real
production build: real server, real SQLite, real Chromium. Goal: every
standard user flow covered, and the whole suite fast and never flaky.

Run: `pnpm build && pnpm test:e2e`. Config: `playwright.config.ts`. A failure
leaves its page snapshot in `test-results/<test>/error-context.md`; on CI the
retry's trace is in the uploaded report (`pnpm exec playwright show-trace`).

## What belongs here

- One test per user flow someone would notice breaking: sign in, add, edit,
  complete, delete, lists, views, live updates, reloads. A new user-facing
  flow, or a fix to one, comes with a test here.
- Not edge cases or logic: those are Vitest tests in `src/`, which are 100x
  faster. Here, assert the flow works end to end, once.
- Assert what the user sees, and that it was saved: after a change, reload and
  check it's still there.

## How to write them

- **Start every test from `test` in `./fixtures`.** Its `user` fixture signs
  in a brand-new user with an empty board, so tests never share data and run
  in parallel. Set up what the test isn't about through the fixture
  (`user.addList("Home", ["Water plants"])`), which writes through `src/core`;
  use the UI only for the flow under test. Add fixture helpers the same way.
- **Find elements as a user would:** `getByRole` with the accessible name,
  then `getByLabel`, `getByPlaceholder`, `getByText`. No CSS classes, XPath or
  DOM structure. If an element has no accessible name, give it one in the
  component (`aria-label`): that fixes it for screen readers too.
- **Wait for outcomes, never for time.** Use web-first assertions
  (`await expect(locator).toBeVisible()`, `toHaveValue`, `toHaveURL`), which
  retry. `waitForTimeout` and `expect(await x.isVisible())` are banned (lint
  fails on the first; the second doesn't wait).
- **`await` every Playwright call.** Lint (`no-floating-promises`) enforces it.
- **Fake only what isn't ours or can't be made real cheaply,** with
  `page.route`: e.g. `/api/version` answering as a newer deploy. Never fake
  Sidetrack's own pages or Server Actions.
- **Pin time when it matters** with `page.clock`; the suite runs in
  Europe/London (`playwright.config.ts`), and the day turns over at 4am.
- **Keep each test short and about one flow.** Some duplication between tests
  is fine; a test that depends on another is not.

## Keeping it fast and reliable

- A test should finish in about 2s; the timeout is 15s. Slower means it's
  waiting on something it shouldn't.
- A flaky test is a bug in the test or the app: find out which, don't retry it
  away. CI retries once only to capture a trace. Before committing a new test,
  run `pnpm test:e2e --repeat-each 10` and get no failures.
- Chromium only, for now. Add WebKit (iOS) once a bug calls for it.
- No screenshot comparisons: fonts and emoji differ between machines.
