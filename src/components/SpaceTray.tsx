import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";

// No "use client": the board page reads the cookie name on the server. The
// tray holds no state of its own; Kanban owns which trays are collapsed.

/**
 * Cookie listing the trays this browser has collapsed ("personal" and Space
 * ids, comma-separated), so the board renders them collapsed from the first
 * paint instead of opening and then animating shut.
 */
export const COLLAPSED_TRAYS_COOKIE = "sidetrack-collapsed-trays";

export function saveCollapsedTrays(ids: string[]) {
  document.cookie = `${COLLAPSED_TRAYS_COOKIE}=${encodeURIComponent(
    ids.join(","),
  )}; path=/; max-age=31536000; samesite=lax`;
}

export function parseCollapsedTrays(value: string | undefined): string[] {
  return value ? decodeURIComponent(value).split(",").filter(Boolean) : [];
}

/**
 * One group on the board: a Space's lists, or the viewer's lists in no Space,
 * on a soft tray. Collapsing slides the tray narrow while its lists fade, and
 * leaves their names to jump back to.
 */
export function SpaceTray({
  name,
  icon,
  lists,
  collapsed,
  onToggle,
  onAddList,
  onOpenList,
  children,
}: {
  name: string;
  icon: string | null;
  lists: { id: string; name: string }[];
  collapsed: boolean;
  onToggle: () => void;
  onAddList: () => void;
  /** From the collapsed tray's names: expand it and centre that list. */
  onOpenList: (projectId: string) => void;
  children: ReactNode;
}) {
  const emoji = icon && !icon.startsWith("http") ? icon : null;
  const ease = "duration-300 ease-out motion-reduce:transition-none";
  return (
    <section
      aria-label={name}
      // Columns fill a phone's width less the tray's padding, so the tray
      // fits on screen with its list centred. Collapsed, its hidden columns
      // stop being snap points and the tray itself takes their place.
      className={`relative flex h-full shrink-0 flex-col rounded-3xl bg-neutral-200/60 p-2 [--column-width:calc(92vw-1rem)] dark:bg-neutral-800/50 ${
        collapsed ? "snap-start" : ""
      }`}
    >
      <header className="flex h-8 shrink-0 items-center gap-1 pl-1 pr-0.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${name}` : `Collapse ${name}`}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-sm font-semibold hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50"
        >
          <ChevronRight
            aria-hidden
            className={`size-4 shrink-0 text-neutral-500 transition-transform ${ease} ${
              collapsed ? "" : "rotate-90"
            }`}
          />
          {emoji && <span aria-hidden>{emoji}</span>}
          <span className="max-w-48 truncate">{name}</span>
          <span className="text-xs font-normal text-neutral-500">{lists.length}</span>
        </button>
        <button
          type="button"
          onClick={onAddList}
          aria-label={`Add list to ${name}`}
          title="Add list"
          className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-300/50 hover:text-neutral-700 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-300"
        >
          <Plus className="size-4" />
        </button>
      </header>
      {/* The lists' track animates between its full width (1fr) and none
          (0fr), clipping the columns from the right as they fade, so they
          slide away whole rather than squashing. */}
      <div
        className={`grid min-h-0 flex-1 transition-[grid-template-columns] ${ease} ${
          collapsed ? "grid-cols-[0fr]" : "grid-cols-[1fr]"
        }`}
      >
        <div
          inert={collapsed}
          className={`flex min-w-0 gap-3 overflow-hidden pt-1.5 transition-opacity ${ease} ${
            collapsed ? "opacity-0 [&>*]:snap-align-none" : "opacity-100"
          }`}
        >
          {children}
        </div>
      </div>
      {/* Takes the header's width without widening the tray, and fades in
          once the lists have mostly gone. */}
      <ul
        aria-hidden={!collapsed}
        inert={!collapsed}
        className={`absolute inset-x-2 top-12 space-y-0.5 transition-opacity motion-reduce:transition-none ${
          collapsed ? "opacity-100 delay-150 duration-200" : "pointer-events-none opacity-0 duration-100"
        }`}
      >
        {lists.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onOpenList(l.id)}
              className="w-full truncate rounded-lg px-2.5 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-300/50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
            >
              {l.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
