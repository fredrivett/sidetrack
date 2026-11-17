/** Ways to sort a list's items once, each in its one useful direction. */
export const ITEM_SORTS = {
  due: "due date",
  created: "date created",
  title: "name",
  priority: "priority",
} as const;
export type ItemSort = keyof typeof ITEM_SORTS;
