"use client";

import { useState, useTransition } from "react";
import { createProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      await createProjectAction(trimmed);
      setName("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full min-h-32 w-72 shrink-0 snap-center items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 text-sm font-medium text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-300"
      >
        + Add project
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex h-full w-72 shrink-0 snap-center flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h3 className="text-sm font-semibold">New project</h3>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        disabled={pending}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          disabled={pending}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!name.trim() || pending}
          className="flex-1"
        >
          Create
        </Button>
      </div>
    </form>
  );
}
