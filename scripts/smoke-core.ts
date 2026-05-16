import { rmSync } from "node:fs";
import { listAudit } from "../src/core/audit";
import { getDb } from "../src/core/db";
import { runMigrations } from "../src/core/migrate";
import {
  addItem,
  completeItem,
  deleteItem,
  reorderItem,
  uncompleteItem,
} from "../src/core/items";
import {
  createProject,
  deleteProject,
  listProjects,
  reorderProject,
} from "../src/core/projects";

rmSync("./data", { recursive: true, force: true });
runMigrations();
const { db } = getDb();

const p1 = createProject(db, { name: "Sidetrack" }, "web");
const p2 = createProject(db, { name: "Other Thing" }, "mcp");
const p3 = createProject(db, { name: "Third" }, "web");

console.log(
  "projects (Sidetrack, Other Thing, Third):",
  listProjects(db).map((p) => p.name),
);

reorderProject(db, p3.id, "after:" + p1.id, "web");
console.log(
  "after reorder (Sidetrack, Third, Other Thing):",
  listProjects(db).map((p) => p.name),
);

const i1 = addItem(
  db,
  { projectId: p1.id, kind: "task", title: "Wire DB", category: "infra" },
  "web",
);
addItem(db, { projectId: p1.id, kind: "task", title: "Build UI" }, "mcp");
addItem(db, { projectId: p1.id, kind: "milestone", title: "v1 ready" }, "web");
const i3 = addItem(
  db,
  { projectId: p1.id, kind: "task", title: "Test it", positionRef: "top" },
  "mcp",
);

completeItem(db, i1.id, "web");
uncompleteItem(db, i1.id, "mcp");
reorderItem(db, i3.id, "end", "web");
deleteProject(db, p2.id, "mcp");
deleteItem(db, i3.id, "web");

const log = listAudit(db, { limit: 100 });
console.log("\naudit entries (newest first):");
for (const e of log) {
  console.log(
    `  [${e.source}] ${e.action} ${e.entityType} — ${e.detail}`,
  );
}

const bySource = log.reduce<Record<string, number>>((acc, e) => {
  acc[e.source] = (acc[e.source] ?? 0) + 1;
  return acc;
}, {});
console.log("\ncounts by source:", bySource);

// Deleted-project audit rows must survive (no cascade).
const p2Log = listAudit(db, { projectId: p2.id });
console.log(
  `deleted project p2 still has ${p2Log.length} audit rows (expect >=2: create + delete)`,
);

const webOnly = listAudit(db, { source: "web" });
console.log(`source filter 'web' → ${webOnly.length} rows`);

console.log("\nOK");
