"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";
import type { Category, Project } from "@/core/schema";
import type { Repeat } from "@/lib/repeat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { RepeatPicker } from "./RepeatPicker";

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

export function NewItemDialog({
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
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  // Remounts the repeat picker after each add, so a Custom draft goes too.
  const [added, setAdded] = useState(0);
  // The last title added in this session: the dialog stays open after each
  // add so you can enter a run of items, and this confirms each one landed.
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Bumped each time the dialog opens, so an add that finishes after the dialog
  // was closed (and maybe reopened) can't write into the new session's form.
  const session = useRef(0);
  useEffect(() => {
    if (open) session.current += 1;
  }, [open]);

  // Reset and seed the form every time the dialog opens — the project comes
  // from the caller (the centred column for ⌘N, or the chosen column's menu).
  // Adjusting state during render off a previous-value tracker is React's
  // recommended alternative to a reset-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setProjectId(initialProjectId ?? projects[0]?.id ?? "");
      setTitle("");
      setDescription("");
      setCategory("");
      setRepeat(null);
      setLastAdded(null);
    }
  }

  const categories = categoriesByProject[projectId] ?? [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !projectId || pending) return;
    const d = description.trim() || null;
    const c = category.trim() || null;
    const r = repeat;
    const startedIn = session.current;
    start(async () => {
      await addItemAction({ projectId, title: t, description: d, category: c, repeat: r });
      if (session.current !== startedIn) return;
      // Stay open for the next item: clear what's per-item, keep the list
      // and category, and put the cursor back in the title. You can type
      // the next item while this one saves (submitting waits; the button
      // shows "Adding…"), so only clear fields that still hold what was
      // submitted — never text typed for the next item.
      setTitle((cur) => (cur.trim() === t ? "" : cur));
      setDescription((cur) => ((cur.trim() || null) === d ? "" : cur));
      // A repeat belongs to the item just added, like its title.
      setRepeat((cur) => (cur === r ? null : cur));
      setAdded((n) => n + 1);
      setLastAdded(t);
      titleRef.current?.focus();
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent initialFocus={titleRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <ResponsiveDialogTitle>New item</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Create a new task in a list.
            </ResponsiveDialogDescription>
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
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

            <Field label="Title">
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a task…"
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

            <Field label="Repeat">
              <RepeatPicker
                key={added}
                repeat={repeat}
                completedAt={null}
                disabled={pending}
                onChange={setRepeat}
              />
            </Field>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
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
              {pending ? "Adding…" : "Add item"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
