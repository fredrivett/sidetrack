import { describe, expect, it } from "vitest";
import { foundingBatch, padUserNumber } from "./founding";

describe("founding batches", () => {
  it("put each user number in its batch, and none past the last", () => {
    const at = (n: number) => {
      const found = foundingBatch(n);
      return found && [found.batch.name, found.first];
    };
    expect(at(1)).toEqual(["Earliest adopters", 1]);
    expect(at(20)).toEqual(["Earliest adopters", 1]);
    expect(at(21)).toEqual(["Earlier adopters", 21]);
    expect(at(50)).toEqual(["Earlier adopters", 21]);
    expect(at(51)).toEqual(["Early adopters", 51]);
    expect(at(100)).toEqual(["Early adopters", 51]);
    expect(at(101)).toBeNull();
  });

  it("pad numbers to three digits without cutting longer ones", () => {
    expect(padUserNumber(4)).toBe("004");
    expect(padUserNumber(100)).toBe("100");
    expect(padUserNumber(1234)).toBe("1234");
  });
});
