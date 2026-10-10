import { it, expect, vi } from "vitest";
import { PositionWriter } from "./positionWriter";
it("flush 等待写入期间到达的最新进度", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const rows: number[] = [];
  const writer = new PositionWriter(
    async (_id, offset) => {
      if (!rows.length) await gate;
      rows.push(offset);
    },
    () => {},
  );
  writer.schedule("a", 10);
  const flushing = writer.flush();
  writer.schedule("a", 20);
  release();
  await flushing;
  expect(rows).toEqual([10, 20]);
});
it("合并进度，flush 等待落盘，失败保留以供重试", async () => {
  vi.useFakeTimers();
  const rows = new Map<string, number>();
  let fail = true;
  const writer = new PositionWriter(
    async (id, offset) => {
      if (fail) throw new Error("磁盘满");
      rows.set(id, offset);
    },
    () => {},
  );
  writer.schedule("a", 10);
  writer.schedule("a", 30);
  await expect(writer.flush()).rejects.toThrow("磁盘满");
  expect(rows.size).toBe(0);
  fail = false;
  await writer.flush();
  expect(rows.get("a")).toBe(30);
  writer.schedule("b", 12);
  await vi.advanceTimersByTimeAsync(1000);
  expect(rows.get("b")).toBe(12);
  vi.useRealTimers();
});
