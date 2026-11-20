import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A done item's name in running text, struck through with a gap between the
 * line and the letters (the `strike` utility). Set `--strike-gap` to the
 * colour behind it when that isn't the page's background.
 */
export function Struck({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("strike", className)}>
      <span className="strike-line">{children}</span>
    </span>
  );
}
