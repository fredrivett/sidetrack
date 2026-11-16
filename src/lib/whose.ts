/**
 * The "whose items" filter of the MCP tools for Today and No date:
 * everything, the viewer's, someone else's, or nobody's. (The web board
 * filters by person in its header instead, see filters.ts.)
 */
export const WHOSE_FILTERS = ["all", "mine", "theirs", "unassigned"] as const;
export type WhoseFilter = (typeof WHOSE_FILTERS)[number];

/**
 * Mine, Theirs and Unassigned split every item exactly one way, so their
 * counts add up to All:
 * - mine: the viewer is among its assignees, alone or on a joint item;
 * - theirs: assigned, but not to the viewer;
 * - unassigned: nobody's.
 */
export function matchesWhose(
  item: { assigneeIds: string[] },
  filter: WhoseFilter,
  viewerId: string,
): boolean {
  const ids = item.assigneeIds;
  switch (filter) {
    case "mine":
      return ids.includes(viewerId);
    case "theirs":
      return ids.length > 0 && !ids.includes(viewerId);
    case "unassigned":
      return ids.length === 0;
    default:
      return true;
  }
}
