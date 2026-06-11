"use client";

import { useRef, useState, useTransition } from "react";
import { createProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";

export function NewProjectSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  // Clear the field each time the sheet opens (React's render-time reset
  // pattern, avoiding a reset-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      await createProjectAction(trimmed);
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        initialFocus={nameRef}
        className={
          isDesktop
            ? "w-full gap-0 p-0 data-[side=right]:sm:max-w-md"
            : "gap-0 rounded-t-xl p-0"
        }
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b border-neutral-200 px-4 py-3 pr-14 dark:border-neutral-800">
            <SheetTitle className="text-base">New project</SheetTitle>
            <SheetDescription className="sr-only">
              Create a new project.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-1 px-4 py-4">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Name
            </span>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              disabled={pending}
            />
          </div>

          <SheetFooter className="mt-0 flex-row justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || pending}>
              Create
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
