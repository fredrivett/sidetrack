// The Agenda's Get started steps, shared by the server that works out where
// the user is with them (core/getStarted.ts) and the stack that shows them.

/** The steps in the order they're offered. */
// The board's own habits first (dates, then repeats, then labels), then
// getting it onto devices; `notifications` after the phone, which an iPhone
// needs before it can turn them on. Each step is only offered once it's
// useful, such as repeats once something has a date (`waitsFor` in
// core/getStarted.ts), so most join the stack later, in their place here.
export const GET_STARTED_STEPS = [
  "lists",
  "date",
  "repeat",
  "label",
  "phone",
  "notifications",
  "computer",
  "share",
  "secure",
  "agent",
] as const;
export type GetStartedStep = (typeof GET_STARTED_STEPS)[number];

/**
 * Where the app can be installed as its own app: a phone or tablet's Home
 * Screen, or a computer (Add to Dock, or Install in Chrome or Edge). Each is
 * also the step installing there ticks.
 */
export const INSTALL_PLATFORMS = ["phone", "computer"] as const;
export type InstallPlatform = (typeof INSTALL_PLATFORMS)[number];

export interface GetStarted {
  /** The steps offered to this user now, in order: the ones the list shows and counts. */
  steps: GetStartedStep[];
  /** Which steps are done. */
  done: Record<GetStartedStep, boolean>;
  /** The steps still to do, front card first: default order, then Later's. */
  queue: GetStartedStep[];
  collapsed: boolean;
  /** Handles of people who haven't accepted the user's invites yet, while share isn't done. */
  pendingInvites: string[];
}
