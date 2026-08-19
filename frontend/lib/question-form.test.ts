import { describe, expect, it } from "vitest";
import { parseNonNegativeInteger } from "@/lib/question-form";

describe("parseNonNegativeInteger", () => {
  it("accepts zero and whole positive values", () => {
    expect(parseNonNegativeInteger("0", "Order", true)).toBe(0);
    expect(parseNonNegativeInteger(" 120 ", "Recording time")).toBe(120);
  });

  it("allows an omitted optional value", () => {
    expect(parseNonNegativeInteger("", "Preparation time")).toBeUndefined();
  });

  it("rejects missing, negative, fractional, and non-numeric values", () => {
    expect(() => parseNonNegativeInteger("", "Order", true)).toThrow("Order is required.");
    expect(() => parseNonNegativeInteger("-1", "Order", true)).toThrow(
      "Order must be a non-negative integer.",
    );
    expect(() => parseNonNegativeInteger("1.5", "Order", true)).toThrow(
      "Order must be a non-negative integer.",
    );
    expect(() => parseNonNegativeInteger("abc", "Order", true)).toThrow(
      "Order must be a non-negative integer.",
    );
  });
});
