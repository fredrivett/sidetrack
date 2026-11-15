"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
  /** The "Create …" row: picking it creates `label`, the text typed. */
  create?: boolean;
}

/**
 * Pick one option by typing to filter, or create one: when the typed text
 * matches no option exactly, a "Create “…”" row ends the list. `value` is an
 * option's value, or "" for none.
 */
export function CreatableCombobox({
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  ariaLabel,
  muted,
  clearable,
  disabled,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  onCreate: (label: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Show the chosen value muted, e.g. a suggestion not yet confirmed. */
  muted?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exists = options.some(
    (o) => o.label.toLowerCase() === typed.toLowerCase(),
  );
  const items: Option[] =
    typed && !exists
      ? [...options, { value: "", label: typed, create: true }]
      : options;
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Combobox<Option>
      items={items}
      value={selected}
      isItemEqualToValue={(a, b) => a.value === b.value && !a.create}
      onValueChange={(next) => {
        if (!next) onChange("");
        else if (next.create) onCreate(next.label);
        else onChange(next.value);
      }}
      onInputValueChange={setQuery}
      // Highlight the first match, so Enter picks it (or "Create …").
      autoHighlight
      disabled={disabled}
    >
      <ComboboxInput
        placeholder={placeholder}
        aria-label={ariaLabel}
        showClear={clearable && Boolean(selected)}
        disabled={disabled}
        className={cn("w-full", muted && "[&_input:not(:focus)]:text-muted-foreground")}
      />
      <ComboboxContent>
        <ComboboxEmpty>Nothing found.</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) => (
            <ComboboxItem key={item.create ? "\0create" : item.value} value={item}>
              {item.create ? (
                <>
                  <Plus className="text-muted-foreground" />
                  <span className="truncate">Create “{item.label}”</span>
                </>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
