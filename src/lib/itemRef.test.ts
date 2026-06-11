import { describe, expect, it } from "vitest";
import {
  dedupePrefix,
  derivePrefix,
  formatItemRef,
  parseItemRef,
  validatePrefix,
} from "./itemRef";

describe("derivePrefix", () => {
  it("takes the first three letters, uppercased", () => {
    expect(derivePrefix("Sidetrack")).toBe("SID");
    expect(derivePrefix("engineering")).toBe("ENG");
  });

  it("ignores non-letters when deriving", () => {
    expect(derivePrefix("My App 2")).toBe("MYA");
    expect(derivePrefix("a-b-c-d")).toBe("ABC");
  });

  it("pads short names to the minimum length", () => {
    expect(derivePrefix("Q")).toBe("QX");
  });

  it("falls back to PRJ when there are no letters", () => {
    expect(derivePrefix("123 !!!")).toBe("PRJ");
    expect(derivePrefix("")).toBe("PRJ");
  });
});

describe("dedupePrefix", () => {
  it("returns the base when free", () => {
    expect(dedupePrefix("ENG", new Set())).toBe("ENG");
  });

  it("suffixes on collision", () => {
    expect(dedupePrefix("ENG", new Set(["ENG"]))).toBe("ENG2");
    expect(dedupePrefix("ENG", new Set(["ENG", "ENG2"]))).toBe("ENG3");
  });

  it("trims the base so a suffixed prefix never exceeds the max", () => {
    // base is already at the 5-char cap; suffix must not push it to 6.
    expect(dedupePrefix("ABCDE", new Set(["ABCDE"]))).toBe("ABCD2");
  });
});

describe("validatePrefix", () => {
  it("accepts 2–5 uppercase letters", () => {
    expect(validatePrefix("EN")).toBeNull();
    expect(validatePrefix("ENGRX")).toBeNull();
  });

  it("rejects bad length and charset", () => {
    expect(validatePrefix("E")).toMatch(/At least/);
    expect(validatePrefix("ABCDEF")).toMatch(/At most/);
    expect(validatePrefix("eng")).toMatch(/Uppercase/);
    expect(validatePrefix("EN1")).toMatch(/Uppercase/);
  });
});

describe("formatItemRef", () => {
  it("joins prefix and number with a dash", () => {
    expect(formatItemRef("SID", 42)).toBe("SID-42");
  });
});

describe("parseItemRef", () => {
  it("parses a bare ref, uppercasing the prefix", () => {
    expect(parseItemRef("eng-42")).toEqual({
      username: null,
      prefix: "ENG",
      number: 42,
    });
  });

  it("tolerates a # and whitespace", () => {
    expect(parseItemRef("  ENG-#7 ")).toEqual({
      username: null,
      prefix: "ENG",
      number: 7,
    });
  });

  it("parses a qualified ref, lowercasing the username", () => {
    expect(parseItemRef("Fred/ENG-42")).toEqual({
      username: "fred",
      prefix: "ENG",
      number: 42,
    });
  });

  it("returns null for non-refs (e.g. a raw nanoid) and bad numbers", () => {
    expect(parseItemRef("V1StGXR8_Z5j")).toBeNull();
    expect(parseItemRef("ENG-0")).toBeNull();
    expect(parseItemRef("TOOLONG-1")).toBeNull();
    expect(parseItemRef("ENG-")).toBeNull();
    expect(parseItemRef("/ENG-1")).toBeNull();
  });
});
