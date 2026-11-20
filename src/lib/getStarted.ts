// The Agenda's Get started steps, shared by the server that works out where
// the user is with them (core/getStarted.ts) and the stack that shows them.

/** The steps in the order they're offered. `agent` is optional. */
export const GET_STARTED_STEPS = ["lists", "iphone", "mac", "share", "agent"] as const;
export type GetStartedStep = (typeof GET_STARTED_STEPS)[number];

export interface GetStarted {
  /** Which steps are done. */
  done: Record<GetStartedStep, boolean>;
  /** The steps still to do, front card first: default order, then Later's. */
  queue: GetStartedStep[];
  collapsed: boolean;
}
