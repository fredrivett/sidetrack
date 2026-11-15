"use client";

import { useId } from "react";
import { SPACE_COLORS, type SpaceColor } from "@/core/schema";

// The --color-space-* tokens (globals.css) change with the colour scheme,
// so one class covers light and dark. Written out in full so Tailwind sees
// each class.
const TINT: Record<SpaceColor, string> = {
  rose: "bg-space-rose",
  clay: "bg-space-clay",
  sand: "bg-space-sand",
  olive: "bg-space-olive",
  sage: "bg-space-sage",
  lagoon: "bg-space-lagoon",
  slate: "bg-space-slate",
  dusk: "bg-space-dusk",
  plum: "bg-space-plum",
  stone: "bg-space-stone",
};
const NO_TINT = "bg-neutral-200/60 dark:bg-neutral-900/50";

// The picker's swatches: the same hues a step stronger, so they tell apart
// at 24px on a card.
const SWATCH: Record<SpaceColor, string> = {
  rose: "bg-space-rose-swatch",
  clay: "bg-space-clay-swatch",
  sand: "bg-space-sand-swatch",
  olive: "bg-space-olive-swatch",
  sage: "bg-space-sage-swatch",
  lagoon: "bg-space-lagoon-swatch",
  slate: "bg-space-slate-swatch",
  dusk: "bg-space-dusk-swatch",
  plum: "bg-space-plum-swatch",
  stone: "bg-space-stone-swatch",
};

/** A Space's background tint: its tray on the board, its card in settings. */
export function spaceTint(color: SpaceColor | null): string {
  return color ? TINT[color] : NO_TINT;
}

/** Grey (no colour) and each Space colour, as a row of radio swatches. */
export function SpaceColorPicker({
  value,
  onChange,
  label = "Colour",
}: {
  value: SpaceColor | null;
  onChange: (color: SpaceColor | null) => void;
  label?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {[null, ...SPACE_COLORS].map((color) => (
        <label key={color ?? "none"} title={color ? capitalise(color) : "No colour"}>
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value === color}
            onChange={() => onChange(color)}
            aria-label={color ? capitalise(color) : "No colour"}
          />
          <span
            className={`block size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-neutral-900 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring dark:peer-checked:ring-neutral-100 ${
              color ? SWATCH[color] : "border border-dashed border-neutral-400 dark:border-neutral-600"
            }`}
          />
        </label>
      ))}
    </div>
  );
}

function capitalise(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
