"use client";

import { useState } from "react";
import { resolveProjectIcon } from "@/lib/projectIcon";
import { cn } from "@/lib/utils";

const BOX = "inline-flex shrink-0 items-center justify-center overflow-hidden";

function LetterIcon({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}) {
  const letter = name.trim().charAt(0).toUpperCase() || "•";
  return (
    <span
      aria-hidden
      className={cn(
        BOX,
        "rounded-[4px] bg-neutral-100 font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {letter}
    </span>
  );
}

/**
 * Image icon that degrades to the letter glyph on load failure. Its error state
 * is local and keyed by `src` (the parent remounts it via `key={src}`), so a
 * broken URL doesn't poison a later retry of the same or a different source.
 */
function ImageIcon({
  src,
  size,
  className,
  fallback,
}: {
  src: string;
  size: number;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external/user URLs and favicons; domains aren't known ahead of time so next/image config can't cover them
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={cn(BOX, "rounded-[4px] object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

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
  const resolved = resolveProjectIcon(icon, homepageUrl);

  if (resolved.kind === "emoji") {
    return (
      <span
        aria-hidden
        className={cn(BOX, "leading-none", className)}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }}
      >
        {resolved.emoji}
      </span>
    );
  }

  if (resolved.kind === "image") {
    return (
      <ImageIcon
        key={resolved.src}
        src={resolved.src}
        size={size}
        className={className}
        fallback={<LetterIcon name={name} size={size} className={className} />}
      />
    );
  }

  return <LetterIcon name={name} size={size} className={className} />;
}
