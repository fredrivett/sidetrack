"use client";

import type { SourceRegion } from "@/core/schema";

/**
 * A photo an agent read, shown whole. `highlight` is the part of it one line
 * came from: the rest of the page dims around it, so the handwriting reads in
 * place rather than cropped. `regions` tints every line faintly, like a
 * highlighter pen, and tapping one picks it. The photo fits its box's `--photo-max-h` when set,
 * keeping its shape, so a tall portrait photo shrinks rather than crops.
 */
export function SourcePhoto({
  sourceId,
  highlight,
  regions = [],
  onPick,
  className = "",
}: {
  sourceId: string;
  highlight: SourceRegion | null;
  regions?: Array<{ id: string; region: SourceRegion }>;
  onPick?: (id: string) => void;
  className?: string;
}) {
  const box = (r: SourceRegion) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
    // Turned about its centre, for a line written on a slant.
    ...(r.angle && { transform: `rotate(${r.angle}deg)` }),
  });
  return (
    <div className={className}>
    <div className="relative mx-auto w-fit overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
      {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-user image */}
      <img
        src={`/api/sources/${sourceId}/photo`}
        alt="The photo these items were read from"
        className="block h-auto max-h-(--photo-max-h,none) w-auto max-w-full select-none"
        draggable={false}
      />
      {regions.map(({ id, region }) => (
        <button
          key={id}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onPick?.(id)}
          style={box(region)}
          className="absolute rounded-sm bg-amber-300/25 mix-blend-multiply transition-colors hover:bg-amber-300/50"
        />
      ))}
      {highlight && (
        <span
          aria-hidden="true"
          style={box(highlight)}
          className="pointer-events-none absolute rounded-sm shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] ring-2 ring-amber-400 transition-all duration-200"
        />
      )}
    </div>
    </div>
  );
}
