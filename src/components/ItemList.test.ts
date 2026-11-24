import { describe, expect, it } from "vitest";
import type { Item } from "@/core/schema";
import { withHiddenParents } from "./ItemList";

const item = (id: string, more: Partial<Item> = {}): Item => ({
  id,
  projectId: "p1",
  title: id,
  description: null,
  labels: [],
  assigneeIds: [],
  createdBy: null,
  parentId: "hidden",
  collapsed: false,
  dueDate: null,
  dueFrom: null,
  repeatEvery: null,
  repeatUnit: null,
  repeatOn: null,
  repeatDay: null,
  smartRule: null,
  smartLead: null,
  somedayAt: null,
  cancelled: false,
  cancelReason: null,
  replacedById: null,
  position: id,
  number: 1,
  completedAt: 1,
  createdAt: 0,
  ...more,
});

describe("withHiddenParents", () => {
  // A stand-in is cancelled the way its sub-items are, whatever order they're in.
  it.each([
    ["cancelled first", [item("a", { cancelled: true }), item("b")], false],
    ["done first", [item("a"), item("b", { cancelled: true })], false],
    ["all cancelled", [item("a", { cancelled: true }), item("b", { cancelled: true })], true],
  ])("%s", (_, items, cancelled) => {
    const [stub] = withHiddenParents(items, { hidden: "Their item" });
    expect(stub).toMatchObject({ id: "hidden", cancelled, completedAt: 1 });
  });
});
