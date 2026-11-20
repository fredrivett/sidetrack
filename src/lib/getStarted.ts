// The Agenda's Get started steps, shared by the server that works out where
// the user is with them (core/getStarted.ts) and the stack that shows them.

/** The steps in the order they're offered. `agent` is optional. */
// `secure` comes straight after lists, once there's something to protect.
export const GET_STARTED_STEPS = ["lists", "secure", "phone", "computer", "share", "agent"] as const;
export type GetStartedStep = (typeof GET_STARTED_STEPS)[number];

/**
 * Where the app can be installed as its own app: a phone or tablet's Home
 * Screen, or a computer (Add to Dock, or Install in Chrome or Edge). Each is
 * also the step installing there ticks.
 */
export const INSTALL_PLATFORMS = ["phone", "computer"] as const;
export type InstallPlatform = (typeof INSTALL_PLATFORMS)[number];

export interface GetStarted {
  /** Which steps are done. */
  done: Record<GetStartedStep, boolean>;
  /** The steps still to do, front card first: default order, then Later's. */
  queue: GetStartedStep[];
  collapsed: boolean;
  /** Handles of people who haven't accepted the user's invites yet, while share isn't done. */
  pendingInvites: string[];
}
