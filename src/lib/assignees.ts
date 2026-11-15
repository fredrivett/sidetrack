/** `ids` with `id` added, or taken out if it's already there (the I shortcut). */
export function toggleAssignee(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((a) => a !== id) : [...ids, id];
}
