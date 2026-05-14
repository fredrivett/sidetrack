"use client";

import { useState, useTransition } from "react";
import { createProjectAction } from "@/app/actions";

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
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        disabled={pending}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          disabled={pending}
          className="flex-1 rounded-lg border border-neutral-300 py-2 text-xs font-medium dark:border-neutral-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim() || pending}
          className="flex-1 rounded-lg bg-neutral-900 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          Create
        </button>
      </div>
    </form>
  );
}
