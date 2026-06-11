// Platform-aware keyboard-shortcut matching. Kept framework-agnostic (no
// react/next imports) so it can be shared by any client component.

export type Shortcut = {
  /** Matched case-insensitively, so "n" also matches Shift+n ("N"). */
  key: string;
  /** Require the platform command key — ⌘ on Apple, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/** The platform command modifier symbol, for rendering hints (⌘ vs Ctrl). */
export function modifierSymbol(): string {
  return isApplePlatform() ? "⌘" : "Ctrl";
}

function modifierActive(event: KeyboardEvent): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

/**
 * True when the event originated from a field that consumes typed characters,
 * so bare-key shortcuts (e.g. "c") don't fire while the user is typing.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (shortcut.mod !== undefined && shortcut.mod !== modifierActive(event)) {
    return false;
  }
  if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey) {
    return false;
  }
  if (shortcut.alt !== undefined && shortcut.alt !== event.altKey) return false;
  return true;
}
