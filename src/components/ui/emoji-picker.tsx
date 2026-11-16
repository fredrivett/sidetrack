"use client";

import {
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  EmojiPicker as EmojiPickerPrimitive,
  type SkinTone,
  useSkinTone,
} from "frimousse";
import { LoaderIcon, SearchIcon } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// frimousse keeps the skin tone only while the picker is open; remember it
// on this device so it's still set the next time any picker opens.
const SKIN_TONE_KEY = "sidetrack:emoji-skin-tone";

function savedSkinTone(): SkinTone {
  try {
    return (localStorage.getItem(SKIN_TONE_KEY) as SkinTone | null) ?? "none";
  } catch {
    return "none";
  }
}

function EmojiPicker({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Root>) {
  return (
    <EmojiPickerPrimitive.Root
      className={cn(
        "isolate flex h-full w-fit flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      data-slot="emoji-picker"
      skinTone={savedSkinTone()}
      {...props}
    />
  );
}

// The swatch for each tone: the default yellow, then the five emoji
// modifiers' colours, light to dark.
const SKIN_TONES: { tone: SkinTone; label: string; color: string }[] = [
  { tone: "none", label: "Default", color: "#ffc83d" },
  { tone: "light", label: "Light", color: "#f7dece" },
  { tone: "medium-light", label: "Medium-light", color: "#e0bb95" },
  { tone: "medium", label: "Medium", color: "#bf8f68" },
  { tone: "medium-dark", label: "Medium-dark", color: "#9b643d" },
  { tone: "dark", label: "Dark", color: "#594539" },
];

/**
 * A footer of skin tone swatches. The tone applies to every emoji that has
 * them, in every picker on this device. Picking one also reports `emoji`,
 * the icon currently set, in that tone, so it can follow; an icon without
 * skin tones (or an image URL) is left alone.
 */
function EmojiPickerSkinTones({
  emoji,
  onEmojiChange,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  emoji?: string | null;
  onEmojiChange?: (emoji: string) => void;
}) {
  const [skinTone, setSkinTone, variations] = useSkinTone(emoji ?? undefined);
  function pick(tone: SkinTone) {
    setSkinTone(tone);
    const toned = variations.find((v) => v.skinTone === tone)?.emoji;
    if (emoji && toned && toned !== emoji) onEmojiChange?.(toned);
  }
  useEffect(() => {
    try {
      localStorage.setItem(SKIN_TONE_KEY, skinTone);
    } catch {
      // Storage unavailable (e.g. private mode): the tone just isn't kept.
    }
  }, [skinTone]);
  return (
    <div
      role="group"
      aria-label="Skin tone"
      className={cn("flex h-10 shrink-0 items-center gap-1.5 border-t px-3", className)}
      data-slot="emoji-picker-skin-tones"
      {...props}
    >
      <span className="mr-auto text-xs text-muted-foreground">Skin tone</span>
      {SKIN_TONES.map(({ tone, label, color }) => (
        <button
          key={tone}
          type="button"
          aria-pressed={skinTone === tone}
          aria-label={label}
          title={label}
          onClick={() => pick(tone)}
          className="size-4 rounded-full outline-offset-2 ring-offset-2 ring-offset-popover aria-pressed:ring-[1.5px] aria-pressed:ring-foreground"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/**
 * `emoji` in the picker's current skin tone, unchanged when it has none, for
 * emoji shown outside the grid, such as suggestions.
 */
function EmojiPickerToned({
  emoji,
  children,
}: {
  emoji: string;
  children: (toned: string) => React.ReactNode;
}) {
  const [skinTone, , variations] = useSkinTone(emoji);
  return children(
    variations.find((v) => v.skinTone === skinTone)?.emoji ?? emoji,
  );
}

function EmojiPickerSearch({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
  return (
    <div
      className={cn("flex h-9 items-center gap-2 border-b px-3", className)}
      data-slot="emoji-picker-search-wrapper"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <EmojiPickerPrimitive.Search
        className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        data-slot="emoji-picker-search"
        {...props}
      />
    </div>
  );
}

function EmojiPickerRow({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1 px-1" data-slot="emoji-picker-row">
      {children}
    </div>
  );
}

function EmojiPickerEmoji({
  emoji,
  className,
  ...props
}: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        "flex size-7 items-center justify-center rounded-sm text-base data-[active]:bg-accent",
        className,
      )}
      data-slot="emoji-picker-emoji"
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({
  category,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className="bg-popover px-3 pt-3.5 pb-2 text-muted-foreground text-xs leading-none"
      data-slot="emoji-picker-category-header"
    >
      {category.label}
    </div>
  );
}

function EmojiPickerContent({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport>) {
  return (
    <EmojiPickerPrimitive.Viewport
      className={cn("relative flex-1 outline-hidden", className)}
      data-slot="emoji-picker-viewport"
      {...props}
    >
      <EmojiPickerPrimitive.Loading
        className="absolute inset-0 flex items-center justify-center text-muted-foreground"
        data-slot="emoji-picker-loading"
      >
        <LoaderIcon className="size-4 animate-spin" />
      </EmojiPickerPrimitive.Loading>
      <EmojiPickerPrimitive.Empty
        className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm"
        data-slot="emoji-picker-empty"
      >
        No emoji found.
      </EmojiPickerPrimitive.Empty>
      <EmojiPickerPrimitive.List
        className="select-none pb-1"
        components={{
          Row: EmojiPickerRow,
          Emoji: EmojiPickerEmoji,
          CategoryHeader: EmojiPickerCategoryHeader,
        }}
        data-slot="emoji-picker-list"
      />
    </EmojiPickerPrimitive.Viewport>
  );
}

export {
  EmojiPicker,
  EmojiPickerSearch,
  EmojiPickerContent,
  EmojiPickerSkinTones,
  EmojiPickerToned,
};
