import { it, expect } from "vitest";
import { WheelGesture } from "./wheelGesture";
it("一次惯性手势只翻一页，静默后才接受新手势", () => {
  const g = new WheelGesture();
  expect(g.push(45, 0, 0)).toBe(1);
  expect(g.push(50, 50, 0)).toBe(0);
  expect(g.push(80, 250, 0)).toBe(0);
  expect(g.push(-60, 600, 0)).toBe(-1);
});
it("行单位滚轮归一化", () => {
  const g = new WheelGesture();
  expect(g.push(3, 0, 1)).toBe(1);
});
