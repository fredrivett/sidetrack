import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/auth/session";
import { listAccess } from "@/core/access";
import { LogoMark } from "@/components/LogoMark";
import { SourceReview } from "@/components/SourceReview";
import { getDb } from "@/core/db";
import { projectRefPrefixes } from "@/core/itemRef";
import { getItem } from "@/core/items";
import { listLabels } from "@/core/labels";
import { listAssignees } from "@/core/members";
import { listProjects } from "@/core/projects";
import { getSource } from "@/core/sources";
import { formatItemRef } from "@/lib/itemRef";
import { repeatOf } from "@/lib/repeat";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add these to Sidetrack" };

// Where an agent's reading of a photo waits for its owner: the photo beside
// the lines it read, to check, change and add (add_from_photo's review_url).
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const { db } = getDb();
  const source = getSource(db, userId, id);
  if (!source) notFound();
  const lists = listProjects(db, userId)
    .filter((p) => p.status !== "archived" && listAccess(db, userId, p.id) === "edit")
    .map((p) => ({ id: p.id, name: p.name, icon: p.icon, homepageUrl: p.homepageUrl }));
  const refs = projectRefPrefixes(db, userId);
  // The existing items lines stand for, as they are now, so the review shows
  // what a line would change.
  const matches = Object.fromEntries(
    source.lines.flatMap((l) => {
      const it = l.matchItemId ? getItem(db, userId, l.matchItemId) : undefined;
      return it
        ? [
            [
              it.id,
              {
                ref: formatItemRef(refs[it.projectId] ?? "", it.number),
                title: it.title,
                projectId: it.projectId,
                completedAt: it.completedAt,
                due: it.dueDate ? { dueDate: it.dueDate, dueFrom: it.dueFrom } : null,
                repeat: repeatOf(it),
                labels: it.labels,
                assigneeIds: it.assigneeIds,
              },
            ],
          ]
        : [];
    }),
  );
  // Every list a line could go to or is on, for its labels and people.
  const listIds = [...new Set([...lists.map((p) => p.id), ...Object.values(matches).map((m) => m.projectId)])];
  const labelsByProject = Object.fromEntries(listIds.map((id) => [id, listLabels(db, userId, id)]));
  const assigneesByProject = Object.fromEntries(listIds.map((id) => [id, listAssignees(db, userId, id)]));
  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <header className={`mx-auto flex w-full items-center px-4 py-3 sm:px-6 max-w-6xl`}>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogoMark />
          Sidetrack
        </Link>
      </header>
      <main className={`mx-auto px-4 pb-16 sm:px-6 max-w-6xl`}>
        <SourceReview
          source={source}
          lists={lists}
          matches={matches}
          labelsByProject={labelsByProject}
          assigneesByProject={assigneesByProject}
          viewerId={userId}
        />
      </main>
    </div>
  );
}
