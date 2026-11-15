import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type { PrState } from "@/core/schema";
import { prLabel } from "@/lib/pr";
import { cn } from "@/lib/utils";
import { GitHubMark } from "./GitHubMark";

// GitHub's own icon and colour for each PR state, so an open PR (in review)
// reads at a glance. The text stays muted; only the icon carries the state.
const STATE: Record<PrState, { icon: LucideIcon; label: string; className: string }> = {
  open: { icon: GitPullRequest, label: "Open", className: "text-green-600 dark:text-green-500" },
  draft: { icon: GitPullRequestDraft, label: "Draft", className: "" },
  merged: { icon: GitMerge, label: "Merged", className: "text-purple-600 dark:text-purple-400" },
  closed: { icon: GitPullRequestClosed, label: "Closed", className: "text-red-600 dark:text-red-500" },
};

/**
 * A linked GitHub pull request, as quiet metadata: an icon and `owner/repo#123`
 * in muted text that darkens on hover. The icon shows the PR's state when the
 * webhook has reported it, else the GitHub mark. Opens in a new tab and keeps
 * its pointer events to itself, so clicking it inside a row neither starts a
 * drag nor opens the detail sheet.
 */
export function PrLink({
  url,
  state,
  className,
}: {
  url: string;
  state?: PrState | null;
  className?: string;
}) {
  const s = state ? STATE[state] : null;
  const Icon = s?.icon;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={s ? `${s.label} · ${url}` : url}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded text-neutral-500 transition hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100",
        className,
      )}
    >
      {Icon ? (
        <Icon className={cn("size-3 shrink-0", s.className)} aria-hidden />
      ) : (
        <GitHubMark className="size-3 shrink-0" />
      )}
      <span className="truncate">{prLabel(url)}</span>
      {s && <span className="sr-only">({s.label.toLowerCase()})</span>}
    </a>
  );
}
