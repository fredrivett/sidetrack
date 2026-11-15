import { prLabel } from "@/lib/pr";
import { cn } from "@/lib/utils";
import { GitHubMark } from "./GitHubMark";

/**
 * A linked GitHub pull request, as quiet metadata: the GitHub mark and
 * `owner/repo#123` in muted text that darkens on hover. Opens in a new tab and
 * keeps its pointer events to itself, so clicking it inside a row neither
 * starts a drag nor opens the detail sheet.
 */
export function PrLink({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded text-neutral-500 transition hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100",
        className,
      )}
    >
      <GitHubMark className="size-3 shrink-0" />
      <span className="truncate">{prLabel(url)}</span>
    </a>
  );
}
