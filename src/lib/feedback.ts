// What the feedback form and core/feedback.ts share.

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The longest feedback, in characters (code points). */
export const FEEDBACK_MAX = 5000;

/**
 * A part of the app feedback can be about, as its label on the item. Fixed
 * here, so the browser can't put any label it likes on the list.
 */
export const FEEDBACK_AREAS = { greeting: "Agenda greeting" } as const;
export type FeedbackArea = keyof typeof FEEDBACK_AREAS;

/** A thumbs up or down on an area. */
export type FeedbackRating = "up" | "down";

/** The longest quote of what the feedback is about, such as the greeting's text. */
export const FEEDBACK_CONTEXT_MAX = 1000;
