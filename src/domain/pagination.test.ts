import { it, expect } from "vitest";
import { safePrefixLength } from "./pagination";
it("跨页切分不能拆 emoji 和组合字符", () => {
  const text = "甲👨‍👩‍👧‍👦乙é丙";
  expect(safePrefixLength(text, 5)).toBe(1);
  expect(safePrefixLength(text, 12)).toBe(12);
  expect(safePrefixLength("é甲", 1)).toBe(0);
});
