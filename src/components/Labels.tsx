"use client";

import { Plus, X } from "lucide-react";
import { createContext, useContext, useState, useTransition } from "react";
import { suggestLabelEmojiAction, updateLabelAction } from "@/app/actions";
import type { LabelEmoji } from "@/core/labels";
import type { Label } from "@/core/schema";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { EditableText } from "./EditableText";
import { IconPicker } from "./ProjectIconPicker";
import { runAction } from "./run-action";
import { type EmojiChoice, UNCHOSEN, useEmojiSuggestions, useTitleEmoji } from "./use-emoji-choice";

// Each list's labels, by list id, read by every row and dialog that shows an
// item's labels (useListLabels) instead of being passed down through every
// view. Items carry their labels by name; these hold each one's emoji.
export const LabelsContext = createContext<Record<string, Label[]>>({});
const NO_LABELS: Label[] = [];

export function useListLabels(projectId: string): Label[] {
  return useContext(LabelsContext)[projectId] ?? NO_LABELS;
}

/**
 * Small pill showing one of an item's labels, its emoji first. Shared so the
 * board row and the dialogs render labels identically.
 */
export function LabelBadge({
  name,
  emoji,
  className = "",
}: {
  name: string;
  emoji: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 ${className}`}
    >
      {emoji && <span className="text-[11px] leading-none">{emoji}</span>}
      {name}
    </span>
  );
}

const CHIP =
  "inline-flex h-7 max-w-full items-center rounded-md border border-input pr-0.5 pl-1.5 text-sm touch:h-9 touch:pl-2";

function RemoveButton({
  name,
  onRemove,
  disabled,
}: {
  name: string;
  onRemove: () => void;
  /** Ignores clicks, staying focusable (aria-disabled), while a save holds. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove label ${name}`}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onRemove()}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground touch:size-8 hover:bg-muted hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      <X className="size-3" />
    </button>
  );
}

/**
 * A saved label on an item being edited: its emoji can be chosen (or none),
 * and its name edited, which renames it on every item. An emoji nobody chose
 * shows faded and follows the name as it's typed. Both hold the chip, dimmed,
 * until they land.
 */
export function SavedLabelChip({
  label,
  onRemove,
  onRenamed,
  disabled,
}: {
  label: Label;
  onRemove: () => void;
  /** The rename saved, for a form holding the item's labels by name. */
  onRenamed?: (name: string) => void;
  disabled?: boolean;
}) {
  const [saving, start] = useTransition();
  const emoji = useTitleEmoji({
    saved: { emoji: label.emoji, chosen: label.emojiChosen },
    title: label.name,
    savedTitle: label.name,
    suggest: (name) => suggestLabelEmojiAction(label.projectId, name),
  });
  const save = (patch: Parameters<typeof updateLabelAction>[1], what: string) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        resolve(await runAction(updateLabelAction(label.id, patch), what));
      }),
    );
  return (
    <span
      aria-busy={saving || undefined}
      className={cn(CHIP, saving && "opacity-60")}
    >
      <IconPicker
        icon={emoji.shown.emoji}
        chosen={emoji.shown.chosen}
        faded={emoji.shown.faded}
        emojiOnly
        label={`emoji for label ${label.name}`}
        size={16}
        // Less than the picker's usual padding, so the emoji sits close to
        // the name.
        className="p-0.5 touch:p-2"
        disabled={saving || disabled}
        suggestions={emoji.suggestions}
        onOpen={emoji.onOpen}
        onSelect={(next) => void save({ emoji: next }, `change the emoji of “${label.name}”`)}
      />
      <EditableText
        value={label.name}
        onSave={async (next) => {
          const auto = emoji.toSave();
          const ok = await save(
            auto ? { name: next, emoji: auto.emoji, emojiChosen: false } : { name: next },
            `rename the label “${label.name}”`,
          );
          // `next` is trimmed, as the server saves it.
          if (ok) onRenamed?.(next);
        }}
        onDraftChange={emoji.onDraftChange}
        required
        hold
        className="min-w-0 truncate rounded pr-1 pl-0.5 hover:bg-muted touch:py-1.5"
        inputClassName="field-sizing-content h-6 min-w-12 pr-1 pl-0.5 py-0 text-sm"
      />
      <RemoveButton name={label.name} onRemove={onRemove} disabled={saving || disabled} />
    </span>
  );
}

/**
 * A label typed for this item that the list doesn't have yet. Its emoji is
 * held in `emoji` until the item is saved, which creates the label with it.
 */
export function DraftLabelChip({
  name,
  emoji,
  onEmoji,
  onRemove,
  disabled,
}: {
  name: string;
  emoji: EmojiChoice;
  /** Someone chose an emoji (or none, null). Omit while it can't change. */
  onEmoji?: (emoji: string | null) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className={CHIP}>
      <IconPicker
        icon={emoji.emoji}
        chosen={emoji.chosen}
        faded={!emoji.chosen && emoji.emoji !== null}
        emojiOnly
        label={`emoji for label ${name}`}
        size={16}
        // Less than the picker's usual padding, so the emoji sits close to
        // the name.
        className="p-0.5 touch:p-2"
        disabled={disabled || !onEmoji}
        suggestions={[]}
        onSelect={(next) => onEmoji?.(next)}
      />
      <span className="min-w-0 truncate pr-1 pl-0.5">{name}</span>
      <RemoveButton name={name} onRemove={onRemove} disabled={disabled} />
    </span>
  );
}

interface Option {
  name: string;
  emoji: string | null;
  /** The "Create …" row: picking it creates `name`, the text typed. */
  create?: boolean;
}

/**
 * Add a label by typing to filter the list's labels, or create one: when the
 * text matches none, a "Create" row ends the list with the emoji Jev suggests
 * for it, faded. `onAdd` gets the name, and for a new label the emoji shown
 * (undefined when Jev hadn't answered, so the server asks).
 */
export function LabelPicker({
  projectId,
  labels,
  selected,
  onAdd,
  disabled,
}: {
  projectId: string;
  labels: Label[];
  /** Names already on the item, left out of the options. */
  selected: string[];
  onAdd: (name: string, emoji?: LabelEmoji) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exists =
    labels.some((l) => l.name.toLowerCase() === typed.toLowerCase()) ||
    selected.some((n) => n.toLowerCase() === typed.toLowerCase());
  const suggestions = useEmojiSuggestions(
    JSON.stringify([projectId, typed]),
    () => suggestLabelEmojiAction(projectId, typed),
    Boolean(typed) && !exists && !disabled,
  );
  const options: Option[] = labels
    .filter((l) => !selected.includes(l.name))
    .map((l) => ({ name: l.name, emoji: l.emoji }));
  const items: Option[] =
    typed && !exists
      ? [...options, { name: typed, emoji: suggestions[0] ?? null, create: true }]
      : options;

  return (
    <Combobox<Option>
      items={items}
      value={null}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(o) => o.name}
      isItemEqualToValue={(a, b) => a.name === b.name && !a.create}
      onValueChange={(next) => {
        if (!next) return;
        setQuery("");
        if (!next.create) onAdd(next.name);
        else onAdd(next.name, suggestions.length ? { emoji: next.emoji, chosen: false } : undefined);
      }}
      // Highlight the first match, so Enter picks it (or "Create …").
      autoHighlight
      disabled={disabled}
    >
      <ComboboxInput
        placeholder="Add a label…"
        aria-label="Add a label"
        disabled={disabled}
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>No labels yet. Type one to create it.</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) => (
            <ComboboxItem key={item.create ? "\0create" : item.name} value={item}>
              {item.create ? (
                <>
                  <Plus className="text-muted-foreground" />
                  <span className="truncate">
                    Create{" "}
                    {item.emoji && <span className="opacity-50">{item.emoji} </span>}“{item.name}”
                  </span>
                </>
              ) : (
                <span className="truncate">
                  {item.emoji && <span className="mr-1">{item.emoji}</span>}
                  {item.name}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * An item's labels as chips, then the picker to add more: saved labels can
 * be renamed and given an emoji in place, and new ones hold theirs in
 * `draftEmoji` until the item is saved.
 */
export function LabelsField({
  projectId,
  value,
  onChange,
  draftEmoji,
  onDraftEmoji,
  onRenamed,
  disabled,
}: {
  projectId: string;
  value: string[];
  /** The item's labels changed: the names, and the emoji for new ones. */
  onChange: (names: string[], added?: { name: string; emoji?: LabelEmoji }) => void;
  draftEmoji: Record<string, LabelEmoji>;
  /** Someone chose an emoji for a label not saved yet; omit when they can't. */
  onDraftEmoji?: (name: string, emoji: string | null) => void;
  /** A label on it was renamed. Only a form holding the labels needs this:
   * a saved item's labels are renamed with the label. */
  onRenamed?: (from: string, to: string) => void;
  disabled?: boolean;
}) {
  const labels = useListLabels(projectId);
  const remove = (name: string) => onChange(value.filter((n) => n !== name));
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => {
            const label = labels.find((l) => l.name === name);
            return label ? (
              <SavedLabelChip
                key={name}
                label={label}
                disabled={disabled}
                onRemove={() => remove(name)}
                onRenamed={onRenamed && ((to) => onRenamed(name, to))}
              />
            ) : (
              <DraftLabelChip
                key={name}
                name={name}
                emoji={draftEmoji[name] ?? UNCHOSEN}
                disabled={disabled}
                onEmoji={onDraftEmoji && ((emoji) => onDraftEmoji(name, emoji))}
                onRemove={() => remove(name)}
              />
            );
          })}
        </div>
      )}
      <LabelPicker
        projectId={projectId}
        labels={labels}
        selected={value}
        disabled={disabled}
        onAdd={(name, emoji) => onChange([...value, name], { name, emoji })}
      />
    </div>
  );
}
