import { test, expect } from "@playwright/test";
test("异常长的单个字素读取有界并释放测量节点", async ({ page }) => {
  await page.goto("/test.html");
  const result = await page.evaluate(async () => {
    // @ts-expect-error browser module URL
    const { paginateChapter } = await import("/src/domain/pagination.ts");
    const text = "a" + "\u0301".repeat(100000);
    let read = 0,
      error = "";
    try {
      for await (const _p of paginateChapter(
        {
          async read(start: number, max: number) {
            const end = Math.min(text.length, start + max);
            read = end;
            return {
              start,
              text: text.slice(start, end),
              next: end,
              done: end === text.length,
            };
          },
        },
        { start: 0, end: text.length },
        {
          width: 700,
          height: 600,
          fontSize: 20,
          fontFamily: "SimSun",
          lineHeight: 1.95,
          margin: 60,
        },
        new AbortController().signal,
      )) {
      }
    } catch (e) {
      error = String(e);
    }
    return {
      read,
      error,
      remaining: document.querySelectorAll(".measure").length,
    };
  });
  expect(result.read).toBeLessThanOrEqual(65536);
  expect(result.error).toContain("字素");
  expect(result.remaining).toBe(0);
});
test("50 MiB Worker 解析时主界面仍响应，预览有界", async ({ page }) => {
  await page.goto("/test.html");
  const result = await page.evaluate(async () => {
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 20),
      started = performance.now();
    const worker = new Worker("/src/workers/import.worker.ts", {
      type: "module",
    });
    const bytes = new Uint8Array(50 * 1024 * 1024);
    bytes.fill(97);
    const preview = await new Promise<{
      kind: string;
      excerpt: string;
      chapters: number;
    }>((resolve, reject) => {
      worker.onmessage = (e) =>
        e.data.kind === "error"
          ? reject(new Error(e.data.message))
          : resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ kind: "decode", jobId: 1, bytes: bytes.buffer }, [
        bytes.buffer,
      ]);
    });
    worker.terminate();
    clearInterval(heartbeat);
    return {
      ticks,
      ms: performance.now() - started,
      length: preview.excerpt.length,
      chapters: preview.chapters,
    };
  });
  expect(result.ticks).toBeGreaterThan(2);
  expect(result.length).toBeLessThanOrEqual(1800);
  expect(result.chapters).toBe(1);
  console.log("50 MiB Worker", result);
});
test("10 MiB 无换行文本分页可取消，测量节点有界且释放", async ({ page }) => {
  await page.goto("/test.html");
  const result = await page.evaluate(async () => {
    // Vite serves the same production paginator to this explicit test entry.
    // @ts-expect-error browser module URL
    const { paginateChapter } = await import("/src/domain/pagination.ts");
    const text = "甲👨‍👩‍👧‍👦é乙".repeat(650000),
      abort = new AbortController();
    let count = 0,
      max = 0,
      last = 0,
      exact = true;
    const source = {
      async read(start: number, size: number) {
        let end = Math.min(text.length, start + size);
        if (
          end < text.length &&
          text.charCodeAt(end) >= 0xdc00 &&
          text.charCodeAt(end) <= 0xdfff
        )
          end--;
        return {
          start,
          text: text.slice(start, end),
          next: end,
          done: end === text.length,
        };
      },
    };
    for await (const p of paginateChapter(
      source,
      { start: 0, end: text.length },
      {
        width: 700,
        height: 600,
        fontSize: 20,
        fontFamily: "SimSun",
        lineHeight: 1.95,
        margin: 60,
      },
      abort.signal,
    )) {
      count++;
      exact = exact && p.start === last;
      last = p.end;
      max = Math.max(
        max,
        document.querySelector(".measure")?.textContent?.length ?? 0,
      );
      if (count === 12) abort.abort();
    }
    return {
      count,
      max,
      exact,
      remaining: document.querySelectorAll(".measure").length,
    };
  });
  expect(result.count).toBe(12);
  expect(result.max).toBeLessThanOrEqual(65536);
  expect(result.exact).toBe(true);
  expect(result.remaining).toBe(0);
});
