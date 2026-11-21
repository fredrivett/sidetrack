"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ListRole, OnlyWithin, SpaceRole } from "@/core/schema";
import { roleHint, roleName, whoseWords } from "@/lib/roles";

/** Roles that can be limited to someone's items: they see, but don't change, the list. */
const LIMITABLE = new Set<string>(["viewer", "commenter"]);

/**
 * Picks a list or Space role: the role's name on the trigger, and in the
 * menu each choice with what it lets someone do. With `onlyMine`, a viewer
 * or commenter can also be shown only the items assigned to you.
 */
export function RoleSelect<R extends ListRole | SpaceRole>({
  label,
  value,
  roles,
  scope,
  disabled,
  onChange,
  onlyMine,
  within,
}: {
  label: string;
  value: R;
  roles: readonly R[];
  /** Whether the roles are for one list or a Space, for their hints. */
  scope: "list" | "space";
  disabled?: boolean;
  onChange: (role: R) => void;
  /** Whether they see only your items, and how to change it; leave out where
   * it can't apply. `someoneElse` names the person whose items they see
   * instead, when another admin limited them: ticking yours switches it to
   * you, unticking theirs shows them everything. */
  onlyMine?: { value: boolean; someoneElse?: string; onChange: (onlyMine: boolean) => void };
  /** With a limit, how much of their days it shows: set from Share my day. */
  within?: OnlyWithin | null;
}) {
  const limitable = onlyMine && LIMITABLE.has(value);
  const whose = limitable && (onlyMine.value ? "my" : onlyMine.someoneElse ? `${onlyMine.someoneElse}’s` : null);
  return (
    // aria-disabled rather than disabled while saving, so the trigger keeps
    // keyboard focus; it just won't open.
    <DropdownMenu onOpenChange={(open, details) => open && disabled && details.cancel()}>
      <DropdownMenuTrigger
        aria-label={label}
        aria-disabled={disabled || undefined}
        className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-neutral-200 px-2 text-xs whitespace-nowrap transition hover:bg-accent aria-disabled:opacity-50 dark:border-neutral-800"
      >
        {roleName(value)}
        {whose && `, ${whoseWords(whose, within)}`}
        <ChevronDown className="size-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: R) => next !== value && onChange(next)}
        >
          {roles.map((r) => (
            <DropdownMenuRadioItem key={r} value={r} closeOnClick className="items-start">
              <span className="flex flex-col">
                <span>{roleName(r)}</span>
                <span className="text-xs text-neutral-500">{roleHint(r, scope)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {limitable && (
          <>
            <DropdownMenuSeparator />
            {onlyMine.someoneElse && !onlyMine.value && (
              <DropdownMenuCheckboxItem checked onCheckedChange={(on) => !on && onlyMine.onChange(false)} className="items-start">
                <span className="flex flex-col">
                  <span>Only {onlyMine.someoneElse}’s items</span>
                  <span className="text-xs text-neutral-500">Untick to show them everything {scope === "list" ? "on it" : "in it"}</span>
                </span>
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuCheckboxItem
              checked={onlyMine.value}
              onCheckedChange={(on) => on !== onlyMine.value && onlyMine.onChange(on)}
              className="items-start"
            >
              <span className="flex flex-col">
                <span>Only my items</span>
                <span className="text-xs text-neutral-500">
                  Sees just what’s assigned to you, nothing else {scope === "list" ? "on it" : "in it"}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
