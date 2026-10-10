import { test, expect } from "@playwright/test";
test("全部页精确覆盖跨块 emoji、组合字符和换行", async ({ page }) => {
  await page.goto("/test.html");
  const result = await page.evaluate(async () => {
    // @ts-expect-error explicit browser test module
    const { paginateChapter, createDomMeasure } =
      await import("/src/domain/pagination.ts");
    const text = "中".repeat(32766) + "👨‍👩‍👧‍👦é\n" + "甲😀乙é\n".repeat(400),
      bounds = new Set<number>([0]);
    for (const s of new Intl.Segmenter("zh", {
      granularity: "grapheme",
    }).segment(text))
      bounds.add(s.index + s.segment.length);
    const source = {
      async read(start: number, max: number) {
        let end = Math.min(text.length, start + max);
        if (text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff)
          end--;
        return {
          start,
          text: text.slice(start, end),
          next: end,
          done: end === text.length,
        };
      },
    };
    const layout = {
        width: 750,
        height: 600,
        fontSize: 20,
        fontFamily: "SimSun",
        lineHeight: 1.95,
        margin: 60,
      },
      measure = createDomMeasure(layout),
      abort = new AbortController();
    let joined = "",
      last = 0,
      safe = true,
      overflow = false,
      pages = 0;
    try {
      for await (const p of paginateChapter(
        source,
        { start: 0, end: text.length },
        layout,
        abort.signal,
      )) {
        safe = safe && p.start === last && bounds.has(p.end);
        last = p.end;
        const value = text.slice(p.start, p.end);
        joined += value;
        overflow = overflow || !measure.fits(value, p.continuation);
        pages++;
      }
    } finally {
      measure.dispose();
    }
    return {
      exact: joined === text,
      last: safe,
      overflow,
      pages,
      leaked: document.querySelectorAll(".measure").length,
    };
  });
  expect(result.exact).toBe(true);
  expect(result.last).toBe(true);
  expect(result.overflow).toBe(false);
  expect(result.pages).toBeGreaterThan(10);
  expect(result.leaked).toBe(0);
});
