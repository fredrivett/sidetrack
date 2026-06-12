"use client";

import { useState } from "react";
import { resolveProjectIcon } from "@/lib/projectIcon";
import { cn } from "@/lib/utils";

/**
 * Renders a project's icon from its stored value, applying the resolve chain
 * (explicit emoji/image → homepage favicon → the project's initial letter).
 * A broken image URL falls through to the letter so a dead favicon never shows
 * a broken-image glyph. `size` drives a square box so emoji, image, and letter
 * all line up at the same footprint.
 */
export function ProjectIcon({
  icon,
  homepageUrl,
  name,
  size = 20,
  className,
}: {
  icon: string | null;
  homepageUrl: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  // Track which src failed (not a bare boolean) so swapping to a new image
  // isn't treated as already-errored.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const resolved = resolveProjectIcon(icon, homepageUrl);
  const box = "inline-flex shrink-0 items-center justify-center overflow-hidden";

  if (resolved.kind === "emoji") {
    return (
      <span
        aria-hidden
        className={cn(box, "leading-none", className)}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }}
      >
        {resolved.emoji}
      </span>
    );
  }

  if (resolved.kind === "image" && erroredSrc !== resolved.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external/user URLs and favicons; domains aren't known ahead of time so next/image config can't cover them
      <img
        src={resolved.src}
        alt=""
        width={size}
        height={size}
        onError={() => setErroredSrc(resolved.src)}
        className={cn(box, "rounded-[4px] object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const letter = name.trim().charAt(0).toUpperCase() || "•";
  return (
    <span
      aria-hidden
      className={cn(
        box,
        "rounded-[4px] bg-neutral-100 font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {letter}
    </span>
  );
}
