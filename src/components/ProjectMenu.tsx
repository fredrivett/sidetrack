"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteProjectAction,
  reorderProjectAction,
} from "@/app/actions";

export function ProjectMenu({
  projectId,
  prevId,
  nextId,
  name,
}: {
  projectId: string;
  prevId: string | null;
  nextId: string | null;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  function action(fn: () => Promise<unknown>) {
    setOpen(false);
    start(() => {
      void fn();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Project options"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <MenuItem
            disabled={!prevId}
            onClick={() =>
              action(() => reorderProjectAction(projectId, `before:${prevId}`))
            }
          >
            Move left
          </MenuItem>
          <MenuItem
            disabled={!nextId}
            onClick={() =>
              action(() => reorderProjectAction(projectId, `after:${nextId}`))
            }
          >
            Move right
          </MenuItem>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <MenuItem
            onClick={() => {
              if (!confirm(`Delete project "${name}" and all its items?`)) {
                setOpen(false);
                return;
              }
              action(() => deleteProjectAction(projectId));
            }}
            destructive
          >
            Delete project
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
        destructive
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
