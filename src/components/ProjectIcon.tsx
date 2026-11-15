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
 * Image icon that tries an ordered list of candidate sources (e.g. our
 * /api/favicon, then a favicon service) and degrades to the letter glyph once
 * all fail. Each candidate stays invisible until it has actually loaded, so a
 * failed attempt never flashes a broken-image glyph. State is local and the
 * parent remounts it via `key` when the candidate list changes, so a broken
 * URL doesn't poison a later retry.
 */
function ImageIcon({
  srcs,
  size,
  className,
  fallback,
}: {
  srcs: string[];
  size: number;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const src = srcs[index];
  if (src === undefined) return <>{fallback}</>;
  // Idempotent per candidate, so onError and the mount check below can't both
  // advance past the same failure and skip the next candidate.
  const next = () => setIndex((i) => (i === index ? i + 1 : i));
  const loaded = loadedSrc === src;
  return (
    // The muted box is the placeholder while the image loads; it clears once
    // the image shows so a transparent favicon isn't drawn on a grey tile.
    <span
      className={cn(
        BOX,
        "rounded-[4px] transition-colors duration-150",
        !loaded && "bg-neutral-100 dark:bg-neutral-800",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external/user URLs and favicons; domains aren't known ahead of time so next/image config can't cover them */}
      <img
        key={src}
        src={src}
        alt=""
        width={size}
        height={size}
        onLoad={() => setLoadedSrc(src)}
        onError={next}
        // A server-rendered <img> can load or fail before hydration attaches
        // onLoad/onError, so that event is never seen. Catch it on mount:
        // complete with no pixels = failed, complete with pixels = loaded.
        ref={(img) => {
          if (!img?.complete || loaded) return;
          if (img.naturalWidth === 0) next();
          else setLoadedSrc(src);
        }}
        className={cn(
          "size-full object-contain transition-opacity duration-150",
          !loaded && "opacity-0",
        )}
      />
    </span>
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
        key={resolved.srcs.join("|")}
        srcs={resolved.srcs}
        size={size}
        className={className}
        fallback={<LetterIcon name={name} size={size} className={className} />}
      />
    );
  }

  return <LetterIcon name={name} size={size} className={className} />;
}
