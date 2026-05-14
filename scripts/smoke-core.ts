import { rmSync } from "node:fs";
import { getDb } from "../src/core/db";
import { runMigrations } from "../src/core/migrate";
import {
  addItem,
  completeItem,
  listItems,
  reorderItem,
  uncompleteItem,
} from "../src/core/items";
import { createProject, listProjects, reorderProject } from "../src/core/projects";

rmSync("./data", { recursive: true, force: true });
runMigrations();
const { db } = getDb();

const p1 = createProject(db, { name: "Sidetrack" });
const p2 = createProject(db, { name: "Other Thing" });
const p3 = createProject(db, { name: "Third" });

console.log(
  "projects (should be Sidetrack, Other Thing, Third):",
  listProjects(db).map((p) => p.name),
);

reorderProject(db, p3.id, "after:" + p1.id);
console.log(
  "after reorder p3 after p1 (Sidetrack, Third, Other Thing):",
  listProjects(db).map((p) => p.name),
);

const i1 = addItem(db, {
  projectId: p1.id,
  kind: "task",
  title: "Wire DB",
  category: "infra",
});
const i2 = addItem(db, {
  projectId: p1.id,
  kind: "task",
  title: "Build UI",
});
const m1 = addItem(db, {
  projectId: p1.id,
  kind: "milestone",
  title: "v1 ready",
});
const i3 = addItem(db, {
  projectId: p1.id,
  kind: "task",
  title: "Test it",
  positionRef: "top",
});

console.log(
  "items active (Test it, Wire DB, Build UI, v1 ready):",
  listItems(db, p1.id).map((i) => i.title),
);

completeItem(db, i1.id);
console.log(
  "after completing Wire DB — active (Test it, Build UI, v1 ready):",
  listItems(db, p1.id).map((i) => i.title),
);
console.log(
  "with completed (Wire DB, Test it, Build UI, v1 ready):",
  listItems(db, p1.id, { includeCompleted: true }).map(
    (i) => `${i.title}${i.completedAt ? " ✓" : ""}`,
  ),
);

completeItem(db, i2.id);
console.log(
  "after completing Build UI — newest-completed (Build UI) closest to active:",
  listItems(db, p1.id, { includeCompleted: true }).map(
    (i) => `${i.title}${i.completedAt ? " ✓" : ""}`,
  ),
);

uncompleteItem(db, i1.id);
console.log(
  "after uncompleting Wire DB — should appear at top of active:",
  listItems(db, p1.id, { includeCompleted: true }).map(
    (i) => `${i.title}${i.completedAt ? " ✓" : ""}`,
  ),
);

reorderItem(db, m1.id, "after:" + i3.id);
console.log(
  "after moving v1 ready after Test it:",
  listItems(db, p1.id).map((i) => i.title),
);

console.log("\nOK");
