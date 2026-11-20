"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ListRole, SpaceRole } from "@/core/schema";
import { roleHint, roleName } from "@/lib/roles";

/**
 * Picks a list or Space role: the role's name on the trigger, and in the
 * menu each choice with what it lets someone do.
 */
export function RoleSelect<R extends ListRole | SpaceRole>({
  label,
  value,
  roles,
  scope,
  disabled,
  onChange,
}: {
  label: string;
  value: R;
  roles: readonly R[];
  /** Whether the roles are for one list or a Space, for their hints. */
  scope: "list" | "space";
  disabled?: boolean;
  onChange: (role: R) => void;
}) {
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
