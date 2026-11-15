import { describe, expect, it } from "vitest";
import {
  dedupePrefix,
  derivePrefix,
  formatItemRef,
  parseItemRef,
  PREFIX_MAX,
  refsInPrTitle,
  validatePrefix,
  workBranchName,
  workPrTitle,
} from "./itemRef";

describe("workBranchName", () => {
  it("leads with the lowercased, unpadded ref, then a slug of the title", () => {
    expect(workBranchName("SDT-1", "Show agent: work sessions!")).toBe(
      "sdt-1-show-agent-work-sessions",
    );
  });

  it("folds accents and trims the slug without a trailing dash", () => {
    expect(workBranchName("SDT-7", "Café résumé")).toBe("sdt-7-cafe-resume");
    const long = workBranchName("SDT-2", "a".repeat(39) + " tail end of a long title");
    expect(long).toBe(`sdt-2-${"a".repeat(39)}`);
  });

  it("falls back to the ref when the title has nothing to slug", () => {
    expect(workBranchName("SDT-3", "🚀!!")).toBe("sdt-3");
  });
});

describe("refsInPrTitle", () => {
  it("finds bracketed refs anywhere, in order, once each, and skips non-refs", () => {
    expect(
      refsInPrTitle("[WIP] Fix login [SDT-1] [sdt-2, alice/ENG-3] [SDT-1] [v2] [SDT-]"),
    ).toEqual(["SDT-1", "sdt-2", "alice/ENG-3"]);
  });

  it("reads the title workPrTitle builds", () => {
    expect(refsInPrTitle(workPrTitle("SDT-42", "Fix [the] thing"))).toEqual(["SDT-42"]);
  });
});

describe("workPrTitle", () => {
  it("puts the ref in brackets at the end", () => {
    expect(workPrTitle("SDT-42", "Show agent work sessions")).toBe(
      "Show agent work sessions [SDT-42]",
    );
  });
});

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

  it("stays within PREFIX_MAX and parseable even with many-digit suffixes", () => {
    // Feed every result back in so suffixes escalate into 3–4 digits. Each must
    // stay within the max length AND keep a leading letter — a digit-only or
    // over-length prefix would be unresolvable by parseItemRef.
    const taken = new Set(["ABCDE"]);
    for (let i = 0; i < 1200; i++) {
      const p = dedupePrefix("ABCDE", taken);
      expect(p.length).toBeLessThanOrEqual(PREFIX_MAX);
      expect(p).toMatch(/^[A-Z]/);
      expect(parseItemRef(`${p}-1`)).not.toBeNull();
      expect(taken.has(p)).toBe(false);
      taken.add(p);
    }
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

  it("parses a digit-suffixed prefix (auto-suffix collision case)", () => {
    expect(parseItemRef("ENG2-1")).toEqual({
      username: null,
      prefix: "ENG2",
      number: 1,
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
