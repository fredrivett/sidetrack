/**
 * The "whose items" filter shared by the views across lists (Today, No date)
 * and their MCP tools: everything, the viewer's, someone else's, or nobody's.
 */
export const WHOSE_FILTERS = ["all", "mine", "theirs", "unassigned"] as const;
export type WhoseFilter = (typeof WHOSE_FILTERS)[number];

export function matchesWhose(
  item: { assigneeId: string | null },
  filter: WhoseFilter,
  viewerId: string,
): boolean {
  switch (filter) {
    case "mine":
      return item.assigneeId === viewerId;
    case "theirs":
      return item.assigneeId !== null && item.assigneeId !== viewerId;
    case "unassigned":
      return item.assigneeId === null;
    default:
      return true;
  }
}
