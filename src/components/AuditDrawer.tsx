"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { listAuditAction } from "@/app/actions";
import type { AuditEntry, AuditSource, Project } from "@/core/schema";
import { dayLabel, formatRelative } from "@/lib/time";

const PAGE = 100;

const SOURCE_BADGE: Record<AuditSource, string> = {
  web: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  mcp: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
};

const ACTION_LABEL: Record<string, string> = {
  create: "created",
  update: "updated",
  complete: "completed",
  uncomplete: "reopened",
  reorder: "reordered",
  delete: "deleted",
};

type Filter = "all" | AuditSource;

export function AuditDrawer({
  open,
  projectId,
  projects,
  onClose,
}: {
  open: boolean;
  projectId?: string;
  projects: Project[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pending, start] = useTransition();

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name,
    [projects, projectId],
  );
  const nameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // Reset paging/filter each time the drawer is (re)opened or rescoped.
  useEffect(() => {
    if (open) {
      setFilter("all");
      setLimit(PAGE);
    }
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    start(async () => {
      const rows = await listAuditAction({
        projectId,
        source: filter === "all" ? undefined : filter,
        limit,
      });
      setEntries(rows);
    });
  }, [open, projectId, filter, limit]);

  const groups = useMemo(() => {
    const out: { label: string; rows: AuditEntry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.ts);
      const last = out.at(-1);
      if (last && last.label === label) last.rows.push(e);
      else out.push({ label, rows: [e] });
    }
    return out;
  }, [entries]);

  if (!open) return null;

  const maybeMore = entries.length === limit;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close activity"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-900">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Activity</h2>
            <p className="truncate text-xs text-neutral-500">
              {projectName ?? "All projects"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">
          {(["all", "web", "mcp"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setLimit(PAGE);
                setFilter(f);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-400">
            {pending ? "…" : `${entries.length}`}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 && !pending && (
            <p className="p-6 text-center text-sm text-neutral-400">
              No activity yet.
            </p>
          )}
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="sticky top-0 bg-neutral-50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-950">
                {g.label}
              </h3>
              <ul>
                {g.rows.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-2 border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800/60"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SOURCE_BADGE[e.source]}`}
                    >
                      {e.source}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">
                        <span
                          className={
                            e.action === "delete"
                              ? "font-medium text-red-600 dark:text-red-400"
                              : "font-medium"
                          }
                        >
                          {ACTION_LABEL[e.action] ?? e.action}
                        </span>{" "}
                        <span className="text-neutral-600 dark:text-neutral-300">
                          {e.detail}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {formatRelative(e.ts)}
                        {!projectId && e.projectId && nameById.get(e.projectId)
                          ? ` · ${nameById.get(e.projectId)}`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {maybeMore && (
            <button
              type="button"
              onClick={() => setLimit((l) => Math.min(l + PAGE, 500))}
              disabled={pending}
              className="w-full p-3 text-center text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200"
            >
              {pending ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
