import { describe, expect, it } from "vitest";
import { cutTitle, placeParts, ruleParts, type TitlePart } from "./titleParts";

const due = (text: string, remove = true): TitlePart => ({
  field: "due",
  due: { dueFrom: null, dueDate: "2026-11-22" },
  text,
  remove,
});
const repeat = (text: string): TitlePart => ({ field: "repeat", repeat: { every: 1, unit: "week", on: "mon" }, text, remove: true });
const cut = (title: string, parts: TitlePart[]) =>
  cutTitle(title, placeParts(title, parts).filter((p) => p.remove));
const saved = (title: string, parts: TitlePart[]) => cut(title, parts).saved;
const struck = (title: string, parts: TitlePart[]) =>
  cut(title, parts).struck.map(([a, b]) => title.slice(a, b));
const who = (text: string): TitlePart => ({ field: "who", userId: "sam", text, remove: true });

describe("cutTitle", () => {
  it("takes out each part with the words that bring it in or join it", () => {
    expect(saved("put the bins out tomorrow and every monday", [due("tomorrow"), repeat("every monday")])).toBe(
      "put the bins out",
    );
    expect(saved("Renew car insurance by Friday", [due("Friday")])).toBe("Renew car insurance");
    expect(saved("add wash clothes to tuesday", [due("tuesday")])).toBe("add wash clothes");
    expect(saved("Tomorrow: call the bank", [due("Tomorrow:")])).toBe("Call the bank");
    // Claude sometimes leaves the separator out of the part.
    expect(saved("Mon - bins out", [due("Mon")])).toBe("Bins out");
  });

  it("leaves a part that stays, and a title that would be left empty", () => {
    expect(saved("Buy milk for tomorrow's breakfast", [due("tomorrow's", false)])).toBe(
      "Buy milk for tomorrow's breakfast",
    );
    expect(saved("tomorrow", [due("tomorrow")])).toBe("tomorrow");
  });
});

describe("placeParts", () => {
  it("drops parts no longer in the title, and lets the rules' parts win an overlap", () => {
    const placed = placeParts("@sam book the vet", [
      { field: "who", userId: "sam", text: "@sam", remove: true },
      { field: "who", userId: "bob", text: "@sam book", remove: true },
      due("tomorrow"),
    ]);
    expect(placed.map((p) => [p.text, p.start])).toEqual([["@sam", 0]]);
  });
});

describe("ruleParts", () => {
  it("finds filler, someone's @handle and a #label, ignoring an unknown handle", () => {
    const parts = ruleParts("Remind me to ask @sam and @nobody about #ERRANDS", {
      people: [{ userId: "u-sam", handle: "Sam" }],
      labels: ["Errands"],
    });
    expect(parts).toEqual([
      { field: "filler", text: "Remind me to", remove: true },
      { field: "who", userId: "u-sam", text: "@sam", remove: true },
      { field: "label", label: "Errands", text: "#ERRANDS", remove: true },
    ]);
  });

  it("finds a leading add as filler only when it puts the task on a day", () => {
    const filler = (title: string) =>
      ruleParts(title, { people: [], labels: [] }).find((p) => p.field === "filler")?.text ?? null;
    expect(filler("add wash clothes to tuesday")).toBe("add");
    expect(filler("Add bins out to next week.")).toBe("Add");
    expect(filler("Add Sam to the group chat")).toBeNull();
    expect(filler("Add milk to tomorrow's list")).toBeNull();
    expect(filler("Add notes to tuesday meeting")).toBeNull();
    expect(filler("Address letters to Sunday school")).toBeNull();
    expect(saved("add wash clothes to tuesday", [{ field: "filler", text: "add", remove: true }, due("tuesday")])).toBe(
      "Wash clothes",
    );
  });
});

describe("cutTitle's strikes", () => {
  it("strike exactly what the saved title lost, joining words and separators included", () => {
    expect(struck("put the bins out tomorrow and every monday", [due("tomorrow"), repeat("every monday")])).toEqual([
      "tomorrow and every monday",
    ]);
    expect(struck("Tomorrow: call the bank", [due("Tomorrow")])).toEqual(["Tomorrow:"]);
    // A word that comes twice: the cut one is struck, not the first one.
    const portal = "Book the room on Friday on the portal";
    expect(saved(portal, [due("Friday")])).toBe("Book the room on the portal");
    expect(struck(portal, [due("Friday")])).toEqual(["on Friday"]);
  });
});

describe("placing a part", () => {
  it("only finds whole words, never inside another word or a possessive", () => {
    expect(saved("Buy lemons Mon", [due("Mon")])).toBe("Buy lemons");
    expect(saved("Fix Samsung tv, Sam", [who("Sam")])).toBe("Fix Samsung tv");
    expect(saved("Plan Friday's talk by Friday", [due("Friday")])).toBe("Plan Friday's talk");
    expect(saved("Today's todo: email Sue today", [due("today")])).toBe("Today's todo: email Sue");
  });
});
