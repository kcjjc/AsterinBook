import { it, expect } from "vitest";
import { bookmarksOnPage } from "./bookmarks";
it("书签按页范围识别，不要求等于页首", () => {
  const m = {
    id: "m",
    bookId: "b",
    offset: 37,
    excerpt: "山风",
    createdAt: "2026-10-08T00:00:00Z",
  };
  expect(bookmarksOnPage([m], { start: 30, end: 60 })).toEqual([m]);
  expect(bookmarksOnPage([m], { start: 0, end: 37 })).toEqual([]);
});
