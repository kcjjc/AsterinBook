import { it, expect } from "vitest";
import {
  turnPage,
  relayout,
  pageForOffset,
  chapterForOffset,
} from "./readerState";
import { indexNovel } from "./novel";
it("开卷说明前的位置从第一章开始，书尾恢复到最后一章", () => {
  const i = indexNovel(
    "\n第一卷 山\n第一章 开端\n山风\n第二章 归途\n灯火",
    "utf-8",
  );
  expect(chapterForOffset(i, 0).title).toBe("第一章 开端");
  expect(chapterForOffset(i, i.totalUtf16).title).toBe("第二章 归途");
});
it("末页停留且被动重排不改逻辑锚点", () => {
  const s = {
    chapterId: "c1",
    anchor: 37,
    pageIndex: 1,
    pages: [
      { start: 0, end: 30 },
      { start: 30, end: 60 },
    ],
    generation: 1,
  };
  expect(turnPage(s, 1)).toEqual(s);
  const wide = relayout(s, [{ start: 0, end: 60 }]);
  expect(wide.anchor).toBe(37);
  expect(relayout(wide, s.pages).anchor).toBe(37);
  expect(turnPage(s, -1).anchor).toBe(0);
  expect(pageForOffset(s.pages, 30)).toBe(1);
});
