"use client";

import { CheckCheck, Megaphone, X } from "lucide-react";
import Link from "next/link";
import { createContext, use, useOptimistic, useTransition } from "react";
import { markPostsSeenAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { ChangelogPost } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { runAction } from "./run-action";
import { useStoredState } from "./use-stored-state";

type Posts = {
  unseen: ChangelogPost[];
  read: (slug: string) => void;
  /** Marks these posts seen without opening them: ✕ on one, Mark all as read. */
  dismiss: (...slugs: string[]) => void;
};
const PostsContext = createContext<Posts>({ unseen: [], read: () => {}, dismiss: () => {} });

/**
 * The changelog posts the viewer hasn't seen, for the Brief's sidebar card
 * (PostStack) and the menus that list them (PostsMenuItems), with the dialog
 * any of them opens to read one. Closing it, ✕ or Mark all as read marks posts
 * seen at once so the next comes forward, and puts them back with a toast if
 * the save fails.
 */
export function PostsProvider({ posts, children }: { posts: ChangelogPost[]; children: React.ReactNode }) {
  const [seen, showSeen] = useOptimistic<string[], string[]>([], (had, slugs) => [...had, ...slugs]);
  const [, start] = useTransition();
  // Which post is open, kept for the tab like other dialogs, so a reload
  // brings it back.
  const [reading, setReading] = useStoredState<string | null>("dialog:post", null, "session");

  const unseen = posts.filter((p) => !seen.includes(p.slug));
  const open = posts.find((p) => p.slug === reading);
  const dismiss = (...slugs: string[]) =>
    start(async () => {
      showSeen(slugs);
      await runAction(
        markPostsSeenAction(slugs),
        slugs.length === 1 ? "mark that post read" : "mark those posts read",
      );
    });

  return (
    <PostsContext value={{ unseen, read: setReading, dismiss }}>
      {children}
      <ResponsiveDialog
        open={!!open}
        onOpenChange={(next) => {
          if (next || !open) return;
          setReading(null);
          dismiss(open.slug);
        }}
      >
        {open && (
          <ResponsiveDialogContent
            // A post to read: nothing to type.
            initialFocus={null}
          >
            <div className="overflow-y-auto px-4 pb-5 pt-3">
              <div className="flex items-start gap-2">
                <ResponsiveDialogTitle className="min-w-0 pt-1 text-base font-semibold tracking-tight">
                  {open.title}
                </ResponsiveDialogTitle>
                <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
              </div>
              {open.image && <PostDrawing image={open.image} className="mx-auto mt-2 w-full max-w-72" />}
              <PostBody post={open} className="mt-3 text-sm" />
              <Link
                href="/changelog"
                className="mt-4 inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                See everything that&apos;s changed →
              </Link>
            </div>
          </ResponsiveDialogContent>
        )}
      </ResponsiveDialog>
    </PostsContext>
  );
}

/**
 * The unseen posts as a small stack of cards at the foot of the Brief's
 * sidebar, on screens wide enough for one: the newest in front (drawing,
 * title, Read), the next two peeking out behind, like the Get started stack.
 * Phones have PostsMenu instead.
 */
export function PostStack({ className }: { className?: string }) {
  const { unseen, read, dismiss } = use(PostsContext);
  const front = unseen[0];
  if (!front) return null;
  const behind = Math.min(unseen.length - 1, 2);
  return (
    <section
      aria-label="New in Sidetrack"
      className={cn("relative w-64", className)}
      style={{ paddingBottom: behind * 8 }}
    >
      {Array.from({ length: behind }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute inset-x-0 top-0 origin-bottom rounded-xl border border-border bg-muted/40"
          style={{
            bottom: behind * 8,
            transform: `translateY(${(i + 1) * 8}px) scale(${1 - (i + 1) * 0.05})`,
            zIndex: 5 - i,
          }}
        />
      ))}
      <article
        key={front.slug}
        className="relative z-10 flex flex-col gap-2 rounded-xl border border-border bg-background p-4 shadow-sm"
      >
        {front.image && <PostDrawing image={front.image} className="mx-auto w-40" />}
        <div>
          <p className="text-xs text-muted-foreground">
            New in Sidetrack{unseen.length > 1 ? ` · ${unseen.length - 1} more` : ""}
          </p>
          <h3 className="text-base font-medium">{front.title}</h3>
        </div>
        <Button size="sm" variant="outline" className="mt-1 self-start" onClick={() => read(front.slug)}>
          Read
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss"
          className="absolute top-2 right-2"
          onClick={() => dismiss(front.slug)}
        >
          <X />
        </Button>
      </article>
    </section>
  );
}

/** How many posts the viewer hasn't seen, for a dot on what opens them. */
export function useUnseenPosts() {
  return use(PostsContext).unseen.length;
}

/**
 * The unseen posts as menu rows, each opening to read, then Mark all as read
 * and a link to the whole changelog. Nothing while none is unseen.
 */
export function PostsMenuItems() {
  const { unseen, read, dismiss } = use(PostsContext);
  if (unseen.length === 0) return null;
  return (
    <>
      {unseen.map((post) => (
        <DropdownMenuItem key={post.slug} className="gap-3 py-1.5" onClick={() => read(post.slug)}>
          {post.image && <PostDrawing image={post.image} className="w-14" />}
          <span className="min-w-0 text-sm font-medium">{post.title}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator className="-mx-1.5" />
      <DropdownMenuItem onClick={() => dismiss(...unseen.map((p) => p.slug))}>
        <CheckCheck />
        Mark all as read
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link href="/changelog" />} className="text-xs text-muted-foreground">
        See everything that&apos;s changed →
      </DropdownMenuItem>
    </>
  );
}

/**
 * The unseen posts in the header on narrow screens, where the Brief has no
 * sidebar: a button with a dot, there only while one is unseen, opening a
 * menu of them. (Phones show them in the account menu, for room.)
 */
export function PostsMenu({ className }: { className?: string }) {
  const unseen = useUnseenPosts();
  if (unseen === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`New in Sidetrack, ${unseen} unread`}
            className={cn("relative bg-muted text-foreground dark:bg-muted/50", className)}
          >
            <Megaphone />
            <span
              aria-hidden
              className="absolute top-1 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-background touch:top-1.5 touch:right-2"
            />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)] p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">New in Sidetrack</p>
        <PostsMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A post's paragraphs. */
export function PostBody({ post, className }: { post: ChangelogPost; className?: string }) {
  return (
    <div className={className}>
      {post.paragraphs.map((p, i) => (
        <p key={i} className="mt-2 text-pretty first:mt-0">
          {p}
        </p>
      ))}
    </div>
  );
}

/**
 * A post's drawing: charcoal on white for light mode, chalk on black for dark,
 * each blended into what's behind it, as the Get started cards do. Lazy, so
 * the hidden one isn't fetched until it's shown.
 */
export function PostDrawing({ image, className }: { image: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`aspect-[4/3] shrink-0 ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP, no resizing needed */}
      <img
        src={`/posts/${image}-light.webp`}
        alt=""
        loading="lazy"
        className="size-full rounded-lg mix-blend-multiply dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img
        src={`/posts/${image}-dark.webp`}
        alt=""
        loading="lazy"
        className="hidden size-full rounded-lg mix-blend-screen dark:block"
      />
    </div>
  );
}
