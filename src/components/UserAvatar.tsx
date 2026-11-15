"use client";

import { Sparkles } from "lucide-react";
import { type CSSProperties, useState } from "react";
import type { AssigneeView } from "@/core/members";
import { cn } from "@/lib/utils";

/** The display fields an avatar/name needs — a structural subset of AssigneeView. */
export type AvatarUser = Pick<
  AssigneeView,
  "userId" | "displayUsername" | "name" | "email" | "image"
>;

/** Best display name for a user: `@handle`, then name, email, finally the id. */
export function assigneeName(u: AvatarUser): string {
  return u.displayUsername
    ? `@${u.displayUsername}`
    : (u.name ?? u.email ?? u.userId);
}

/** Everyone on an item, for labels: "@fred", "@fred and @lorna". */
export function assigneeNames(users: AvatarUser[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    users.map(assigneeName),
  );
}

/** An agent working on an item, drawn in the avatar stack ahead of people. */
export interface AgentAvatarView {
  /** Its work session's id. */
  id: string;
  /** The agent's API key name, e.g. "Amp". */
  name: string;
  /** Working (reported lately) or idle; no status dot when omitted. */
  status?: "working" | "idle";
}

/** "Amp (agent, working)", for labels. */
export function agentLabel(a: AgentAvatarView): string {
  return `${a.name} (agent${a.status ? `, ${a.status}` : ""})`;
}

/**
 * An agent's avatar: a violet rounded square, unlike a person's circle, with
 * its status as a dot on the bottom-left corner, which stays clear of the
 * avatars it overlaps at the front of a stack. `ringClassName` rings the dot
 * in the surface colour behind it.
 */
export function AgentAvatar({
  agent,
  size = 20,
  className,
  ringClassName = "ring-white dark:ring-neutral-900",
}: {
  agent: AgentAvatarView;
  size?: number;
  className?: string;
  ringClassName?: string;
}) {
  const dot = Math.max(6, Math.round(size * 0.35));
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Sparkles style={{ width: size * 0.6, height: size * 0.6 }} />
      {agent.status && (
        <span
          className={cn(
            "absolute -bottom-0.5 -left-0.5 rounded-full ring-2",
            agent.status === "working" ? "bg-green-500" : "bg-neutral-400",
            ringClassName,
          )}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  );
}

/**
 * An item's assignees as overlapping avatars, each ringed in the surface
 * colour behind it (`ringClassName`) so the overlaps read as separate people.
 * Agents working on it come first and sit on top; then people, the leftmost
 * on top, in reading order. Past `max` the last slot becomes a "+N" chip
 * tucked beneath the rest, counting people only: agents never fold into it.
 *
 * With `unfurl`, hovering the stack (or focusing the control it's in) spreads
 * everyone out, "+N" included, floating leftwards over what's beside it so
 * the layout never moves. The spread copy is painted on the board row's
 * surface (white / neutral-900), the only place that unfurls.
 */
export function AvatarStack({
  users,
  agents = [],
  size = 20,
  max = 3,
  ringClassName = "ring-white dark:ring-neutral-900",
  unfurl = false,
}: {
  users: AvatarUser[];
  agents?: AgentAvatarView[];
  size?: number;
  max?: number;
  ringClassName?: string;
  unfurl?: boolean;
}) {
  // `overlapped`: drawn in the collapsed stack, where an agent behind the first
  // has its bottom-left dot covered, so it shows no dot there (the spread
  // stack and the detail sheet still say how it's doing).
  const avatars = [
    ...agents.map((a, i) => ({
      key: `agent:${a.id}`,
      node: (overlapped: boolean) => (
        <AgentAvatar
          agent={overlapped && i > 0 ? { ...a, status: undefined } : a}
          size={size}
          className={cn("ring-2", ringClassName)}
          ringClassName={ringClassName}
        />
      ),
    })),
    ...users.map((u) => ({
      key: u.userId,
      node: () => (
        <UserAvatar user={u} size={size} className={cn("ring-2", ringClassName)} />
      ),
    })),
  ];
  const people =
    avatars.length > max ? Math.max(0, max - 1 - agents.length) : users.length;
  const shown = avatars.slice(0, agents.length + people);
  const extra = avatars.length - shown.length;
  const overlap = Math.round(size * 0.2);
  const gap = 3;
  return (
    <span className="group/stack relative isolate flex items-center">
      {shown.map((a, i) => (
        <span
          key={a.key}
          className="relative flex"
          style={{ ...(i > 0 ? { marginLeft: -overlap } : {}), zIndex: shown.length - i }}
        >
          {a.node(true)}
        </span>
      ))}
      {extra > 0 && (
        <span
          aria-hidden
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-100 font-medium text-neutral-500 ring-2 dark:bg-neutral-800 dark:text-neutral-300",
            ringClassName,
          )}
          style={{ marginLeft: -overlap, width: size, height: size, fontSize: Math.round(size * 0.45) }}
        >
          +{extra}
        </span>
      )}
      {unfurl && avatars.length > 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-y-1 -right-1 z-50 flex items-center rounded-full bg-white pr-1 pl-1.5 opacity-0 transition-opacity duration-150 ease-out group-hover/stack:pointer-events-auto group-hover/stack:opacity-100 in-focus-visible:opacity-100 motion-reduce:transition-none dark:bg-neutral-900"
          // Bleeds past the stack on every side, so the collapsed avatars' rings
          // and dots, which overhang their box, stay covered.
          style={{ gap }}
        >
          {avatars.map((a, i) => (
            // Each slides out from about where it sat in the stack.
            <span
              key={a.key}
              className="relative flex translate-x-(--slide) transition-transform duration-150 ease-out group-hover/stack:translate-x-0 in-focus-visible:translate-x-0 motion-reduce:transition-none"
              style={
                {
                  "--slide": `${(avatars.length - 1 - i) * (gap + overlap)}px`,
                  zIndex: avatars.length - i,
                } as CSSProperties
              }
            >
              {a.node(false)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function initial(u: AvatarUser): string {
  const source = u.name ?? u.displayUsername ?? u.email ?? "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

/**
 * A user's avatar: their image when set (degrading to initials if it fails to
 * load), else an initials chip. Square footprint at `size` so a row of avatars
 * lines up. Mirrors ProjectIcon's load-then-fallback approach.
 */
export function UserAvatar({
  user,
  size = 20,
  className,
}: {
  user: AvatarUser;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full";

  if (user.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external user avatar URLs; domains aren't known ahead of time so next/image config can't cover them
      <img
        key={user.image}
        src={user.image}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cn(box, "object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        box,
        "bg-neutral-200 font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {initial(user)}
    </span>
  );
}
