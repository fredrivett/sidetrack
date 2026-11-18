// What the feedback form and core/feedback.ts share.

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The longest feedback, in characters (code points). */
export const FEEDBACK_MAX = 5000;
