import { describe, expect, it } from "vitest";
import { placeParts, ruleParts, struckRanges, type TitlePart, trimTitle } from "./titleParts";

const due = (text: string, remove = true): TitlePart => ({
  field: "due",
  due: { dueFrom: null, dueDate: "2026-11-22" },
  text,
  remove,
});
const repeat = (text: string): TitlePart => ({ field: "repeat", repeat: { every: 1, unit: "week", on: "mon" }, text, remove: true });
const saved = (title: string, parts: TitlePart[]) =>
  trimTitle(title, placeParts(title, parts).filter((p) => p.remove));
const struck = (title: string, s: string) => struckRanges(title, s).map(([a, b]) => title.slice(a, b));

describe("trimTitle", () => {
  it("takes out each part with the words that bring it in or join it", () => {
    expect(saved("put the bins out tomorrow and every monday", [due("tomorrow"), repeat("every monday")])).toBe(
      "put the bins out",
    );
    expect(saved("Renew car insurance by Friday", [due("Friday")])).toBe("Renew car insurance");
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
});

describe("struckRanges", () => {
  it("strikes what the saved title lost, joining words and separators included", () => {
    expect(struck("put the bins out tomorrow and every monday", "put the bins out")).toEqual([
      "tomorrow",
      "and",
      "every",
      "monday",
    ]);
    expect(struck("Tomorrow: call the bank", "Call the bank")).toEqual(["Tomorrow:"]);
    expect(struck("Mow the lawn every other weekend, starting today", "Mow the lawn")).toEqual([
      "every",
      "other",
      "weekend,",
      "starting",
      "today",
    ]);
  });
});
