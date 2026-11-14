"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
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
  // The last title added in this session: the sheet stays open after each
  // add so you can enter a run of items, and this confirms each one landed.
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Bumped each time the sheet opens, so an add that finishes after the sheet
  // was closed (and maybe reopened) can't write into the new session's form.
  const session = useRef(0);
  useEffect(() => {
    if (open) session.current += 1;
  }, [open]);

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
      setLastAdded(null);
    }
  }

  const categories = categoriesByProject[projectId] ?? [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !projectId || pending) return;
    const d = description.trim() || null;
    const c = kind === "task" ? category.trim() || null : null;
    const startedIn = session.current;
    start(async () => {
      await addItemAction({ projectId, kind, title: t, description: d, category: c });
      if (session.current !== startedIn) return;
      // Stay open for the next item: clear what's per-item, keep the list,
      // type and category, and put the cursor back in the title. The fields
      // stay editable while the add is in flight, so only clear them if they
      // still hold what was submitted — never text typed for the next item.
      setTitle((cur) => (cur.trim() === t ? "" : cur));
      setDescription((cur) => ((cur.trim() || null) === d ? "" : cur));
      setLastAdded(t);
      titleRef.current?.focus();
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
              Create a new task or milestone in a list.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <Field label="List">
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

          <SheetFooter className="mt-0 flex-row items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            {/* Always mounted so screen readers announce the first add too. */}
            <p
              role="status"
              className="mr-auto min-w-0 truncate text-xs text-neutral-500"
            >
              {lastAdded && `Added “${lastAdded}”`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {lastAdded ? "Done" : "Cancel"}
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
