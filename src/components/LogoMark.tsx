import { cn } from "@/lib/utils";

/**
 * The logo mark, five offset cards, in the text colour. The same shapes as
 * public/icons/mark.svg (generated from scripts/icons/icon.svg). At 18×19px,
 * 1/16 of the icon, every edge lands on a whole pixel. Each card is its own
 * `rect`, so the landing page can animate them one by one.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="112 96 288 304"
      fill="currentColor"
      aria-hidden="true"
      className={cn("h-[19px] w-[18px] shrink-0", className)}
    >
      <rect x="144" y="96" width="256" height="48" rx="12" />
      <rect x="112" y="160" width="128" height="48" rx="12" />
      <rect x="128" y="224" width="256" height="48" rx="12" />
      <rect x="272" y="288" width="128" height="48" rx="12" />
      <rect x="112" y="352" width="256" height="48" rx="12" />
    </svg>
  );
}
