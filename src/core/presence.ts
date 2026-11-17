// Who has the board in front of them right now. The board keeps its live
// updates stream (/api/events) open only while it's visible (LiveUpdates),
// so an open stream is someone looking. In memory, like the change bus
// (changes.ts): it covers the boards connected to this server process.

declare global {
  var __sidetrackPresence: Map<string, number> | undefined;
}

const open = (globalThis.__sidetrackPresence ??= new Map());

/** `userId` has a visible board open; call the returned function when it closes. */
export function markLooking(userId: string): () => void {
  open.set(userId, (open.get(userId) ?? 0) + 1);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const left = (open.get(userId) ?? 1) - 1;
    if (left > 0) open.set(userId, left);
    else open.delete(userId);
  };
}

/** Whether `userId` has a visible board open. */
export function isLooking(userId: string): boolean {
  return open.has(userId);
}
