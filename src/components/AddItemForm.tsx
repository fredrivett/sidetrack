"use client";

import { useId, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";
import type { Category, ItemKind } from "@/core/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AddItemForm({
  projectId,
  categories,
}: {
  projectId: string;
  categories: Category[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<ItemKind>("task");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const c = category.trim() || null;
    const d = description.trim() || null;
    start(async () => {
      await addItemAction({ projectId, kind, title: t, description: d, category: c });
      setTitle("");
      setDescription("");
      inputRef.current?.focus();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 pt-2">
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
      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={kind === "task" ? "Add a task…" : "Add a milestone…"}
        disabled={pending}
      />
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        disabled={pending}
        rows={2}
        className="min-h-0 resize-none text-xs"
      />
      {kind === "task" && (
        <>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (optional)"
            list={listId}
            disabled={pending}
            className="text-xs"
          />
          <datalist id={listId}>
            {categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </>
      )}
      <Button
        type="submit"
        disabled={!title.trim() || pending}
        size="sm"
        className="w-full"
      >
        Add
      </Button>
    </form>
  );
}
