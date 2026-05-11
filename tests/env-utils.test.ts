import { describe, expect, it } from "vitest";
import { parseIntegerSetting } from "../src/lib/env-utils.js";

describe("parseIntegerSetting", () => {
  it("uses the fallback for missing, blank, or non-finite values", () => {
    expect(parseIntegerSetting(undefined, 500)).toBe(500);
    expect(parseIntegerSetting("", 500)).toBe(500);
    expect(parseIntegerSetting("   ", 500)).toBe(500);
    expect(parseIntegerSetting("NaN", 500)).toBe(500);
    expect(parseIntegerSetting("Infinity", 500)).toBe(500);
  });

  it("normalizes finite numbers to integers", () => {
    expect(parseIntegerSetting("42", 500)).toBe(42);
    expect(parseIntegerSetting("42.9", 500)).toBe(42);
  });

  it("clamps parsed values and fallback values into the allowed range", () => {
    expect(parseIntegerSetting("-10", 500, { min: 0 })).toBe(0);
    expect(parseIntegerSetting("9000", 500, { max: 1000 })).toBe(1000);
    expect(parseIntegerSetting(undefined, -5, { min: 1 })).toBe(1);
  });
});
