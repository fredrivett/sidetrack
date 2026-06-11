"use client";

import { useId, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";
import type { Category, ItemKind, Project } from "@/core/schema";
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
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/components/ui/use-media-query";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

export function NewItemSheet({
  open,
  onOpenChange,
  projects,
  categoriesByProject,
  initialProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  categoriesByProject: Record<string, Category[]>;
  initialProjectId: string | null;
}) {
  // Sidebar slide-out on desktop, bottom drawer on mobile — matches ItemDetailSheet.
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<ItemKind>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Reset and seed the form every time the sheet opens — the project comes
  // from the caller (the centred column for ⌘N, or the chosen column's menu).
  // Adjusting state during render off a previous-value tracker is React's
  // recommended alternative to a reset-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setProjectId(initialProjectId ?? projects[0]?.id ?? "");
      setKind("task");
      setTitle("");
      setDescription("");
      setCategory("");
    }
  }

  const categories = categoriesByProject[projectId] ?? [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !projectId) return;
    const d = description.trim() || null;
    const c = kind === "task" ? category.trim() || null : null;
    start(async () => {
      await addItemAction({ projectId, kind, title: t, description: d, category: c });
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        initialFocus={titleRef}
        className={
          isDesktop
            ? "w-full gap-0 p-0 data-[side=right]:sm:max-w-md"
            : "max-h-[85vh] gap-0 rounded-t-xl p-0"
        }
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b border-neutral-200 px-4 py-3 pr-14 dark:border-neutral-800">
            <SheetTitle className="text-base">New item</SheetTitle>
            <SheetDescription className="sr-only">
              Create a new task or milestone in a project.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <Field label="Project">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={pending}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <div className="flex items-center gap-1 rounded-lg bg-neutral-200 p-0.5 dark:bg-neutral-800">
                {(["task", "milestone"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${kind === k ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-neutral-500"}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Title">
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "task" ? "Add a task…" : "Add a milestone…"}
                disabled={pending}
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                disabled={pending}
                rows={3}
                className="resize-none text-sm"
              />
            </Field>

            {kind === "task" && (
              <Field label="Category">
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Category (optional)"
                  list={listId}
                  disabled={pending}
                  className="text-sm"
                />
                <datalist id={listId}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
            )}
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
            <Button type="submit" size="sm" disabled={!title.trim() || !projectId || pending}>
              Add item
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
