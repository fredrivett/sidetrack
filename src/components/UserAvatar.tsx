"use client";

import { useState } from "react";
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
