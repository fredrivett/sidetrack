import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { SpaceColor } from "@/core/schema";
import { ProjectIcon } from "./ProjectIcon";
import { spaceTint } from "./SpaceColor";

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

/** A malformed cookie (edited by hand, cut short) reads as nothing collapsed. */
export function parseCollapsedTrays(value: string | undefined): string[] {
  try {
    return value ? decodeURIComponent(value).split(",").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * One group on the board: a Space's lists, or the viewer's lists in no Space,
 * on a soft tray. Collapsing slides the tray narrow while its lists fade, and
 * leaves their names to jump back to.
 */
export function SpaceTray({
  name,
  icon,
  color,
  lists,
  collapsed,
  saving = false,
  menu,
  onToggle,
  onAddList,
  onOpenList,
  children,
}: {
  name: string;
  icon: string | null;
  /** The Space's colour; null (and Personal) is grey. */
  color: SpaceColor | null;
  lists: { id: string; name: string }[];
  collapsed: boolean;
  /** A held save to the tray, such as a move: dims it until it lands. */
  saving?: boolean;
  /** The tray's ⋯ menu, after the +. */
  menu?: ReactNode;
  onToggle: () => void;
  onAddList: () => void;
  /** From the collapsed tray's names: expand it and centre that list. */
  onOpenList: (projectId: string) => void;
  children: ReactNode;
}) {
  const ease = "duration-300 ease-out motion-reduce:transition-none";
  return (
    <section
      aria-label={name}
      aria-busy={saving || undefined}
      style={{ opacity: saving ? 0.7 : 1 }}
      // Columns fill a phone's width less the tray's padding, so the tray
      // fits on screen with its list centred. Collapsed, its hidden columns
      // stop being snap points and the tray itself takes their place. On a
      // phone it snaps where it sat with its first column centred, so
      // collapsing doesn't shift it: 4vw in, or for an empty Space, its 18rem
      // Add list column plus 1rem of padding centred.
      className={`relative flex h-full shrink-0 flex-col rounded-3xl p-2 [--column-width:calc(92vw-1rem)] ${spaceTint(color)} ${
        !collapsed
          ? ""
          : lists.length > 0
            ? "snap-start max-sm:scroll-ml-[4vw]"
            : "snap-start max-sm:scroll-ml-[calc((100vw-19rem)/2)]"
      }`}
    >
      {/* As the board scrolls, the name sticks to the screen's left edge and
          the buttons to its right, so the header spans whatever part of the
          tray is on screen. Each is kept clear of the other: the name stops
          at the header's padding, which the buttons' --tray-actions width
          fills, and the buttons stop at the name, where their wrapper
          starts. Insets count from inside the board's p-3; on phones they
          line up with a centred column, (100vw - column width) / 2. */}
      <header className="flex h-8 shrink-0 items-center gap-1 pl-1 pr-[calc(var(--tray-actions)+0.125rem)] [--tray-actions:3.75rem]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${name}` : `Collapse ${name}`}
          className="sticky left-[4vw] flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-sm font-semibold hover:bg-neutral-300/50 sm:left-3 dark:hover:bg-neutral-700/50"
        >
          <ChevronRight
            aria-hidden
            className={`size-4 shrink-0 text-neutral-500 transition-transform ${ease} ${
              collapsed ? "" : "rotate-90"
            }`}
          />
          {icon && <ProjectIcon icon={icon} homepageUrl={null} name={name} size={16} />}
          <span className="max-w-48 truncate">{name}</span>
          <span className="text-xs font-normal text-neutral-500">{lists.length}</span>
        </button>
        <div className="-mr-[var(--tray-actions)] flex min-w-0 flex-1 justify-end">
          <div className="sticky right-[calc(4vw-0.125rem)] flex shrink-0 items-center gap-1 sm:right-2.5">
            <button
              type="button"
              onClick={onAddList}
              aria-label={`Add list to ${name}`}
              title="Add list"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-300/50 hover:text-neutral-700 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-300"
            >
              <Plus className="size-4" />
            </button>
            {menu}
          </div>
        </div>
      </header>
      {/* The lists' track animates between its full width (1fr) and none
          (0fr), clipping the columns from the right as they fade, so they
          slide away whole rather than squashing. overflow-clip, not hidden:
          hidden makes this a scroll container, which the columns would snap
          to instead of the board, so swiping wouldn't step between lists. */}
      <div
        className={`grid min-h-0 flex-1 transition-[grid-template-columns] ${ease} ${
          collapsed ? "grid-cols-[0fr]" : "grid-cols-[1fr]"
        }`}
      >
        <div
          inert={collapsed}
          className={`flex min-w-0 gap-3 overflow-clip pt-1.5 transition-opacity ${ease} ${
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
