"use client";

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { setFollowingAction } from "@/app/actions";
import type { Item } from "@/core/schema";
import { runAction } from "./run-action";
import { useSameContent } from "./use-same-content";

interface Follows {
  isFollowing: (itemId: string) => boolean;
  setFollowing: (item: Item, following: boolean) => void;
}

// Null outside the board (the landing page's preview), where there's
// nothing to follow, so the rows leave Follow out.
const FollowsContext = createContext<Follows | null>(null);
export const useFollows = () => useContext(FollowsContext);

/**
 * The items the viewer follows, and Follow/Unfollow for them. Optimistic,
 * like ticking: the menu shows the new state at once, and goes back with a
 * toast if the save fails.
 */
export function FollowsProvider({
  followedItemIds: sent,
  children,
}: {
  followedItemIds: string[];
  children: ReactNode;
}) {
  const followedItemIds = useSameContent(sent);
  // Choices made since this page loaded, before the server says so.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The same value until either changes, as every row reads it.
  const value = useMemo<Follows>(() => {
    const followed = new Set(followedItemIds);
    return {
      isFollowing: (id) => chosen.get(id) ?? followed.has(id),
      setFollowing(item, following) {
        setChosen((m) => new Map(m).set(item.id, following));
        void runAction(
          setFollowingAction(item.id, following),
          `${following ? "follow" : "unfollow"} “${item.title}”`,
        ).then((ok) => {
          if (ok) return;
          setChosen((m) => {
            const next = new Map(m);
            next.delete(item.id);
            return next;
          });
        });
      },
    };
  }, [followedItemIds, chosen]);
  return <FollowsContext value={value}>{children}</FollowsContext>;
}
