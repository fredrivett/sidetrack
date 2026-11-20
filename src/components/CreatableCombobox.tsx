"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
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

interface Option {
  value: string;
  label: string;
  /** The "Create …" row: picking it creates `label`, the text typed. */
  create?: boolean;
}

/**
 * A chip that opens a list to pick one option from, typing to filter, or to
 * create one: when the typed text matches no option exactly, a "Create “…”"
 * row ends the list. `value` is an option's value, or "" for none; the chip
 * shows `children`.
 */
export function CreatableCombobox({
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  title,
  className,
  disabled,
  children,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  onCreate: (label: string) => void;
  /** The search input's placeholder. */
  placeholder: string;
  /** The chip's tooltip. */
  title: string;
  /** The chip's look. */
  className: string;
  disabled?: boolean;
  children: React.ReactNode;
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
      <ComboboxPrimitive.Trigger title={title} className={className}>
        {children}
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className="w-64">
        <ComboboxInput placeholder={placeholder} aria-label={placeholder} showTrigger={false} />
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
