import { describe, expect, it } from "vitest";
import { layoutText, lineHeightFor } from "./text-layout";

// Every character is 10 units wide.
const measure = (value: string) => value.length * 10;

describe("text box layout", () => {
  it("wraps at spaces and keeps explicit and blank lines", () => {
    expect(layoutText("Newton yasaları ve kuvvet", 120, measure)).toEqual([
      "Newton",
      "yasaları ve",
      "kuvvet",
    ]);
    expect(layoutText("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
    expect(layoutText("", 100, measure)).toEqual([""]);
  });

  it("breaks a word that is wider than the box", () => {
    expect(layoutText("elektromanyetizma", 60, measure)).toEqual(["elektr", "omanye", "tizma"]);
    expect(layoutText("F = elektromanyetik", 80, measure)).toEqual(["F =", "elektrom", "anyetik"]);
  });

  it("uses one line height for renderer and editor", () => {
    expect(lineHeightFor(20)).toBe(27);
  });
});
