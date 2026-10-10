import type { NovelIndex, Chapter } from "../bridge/contracts";
export function chapterForOffset(index: NovelIndex, offset: number): Chapter {
  return (
    index.chapters.find(
      (c) => c.headingStart <= offset && offset < c.bodyEnd,
    ) ??
    (offset >= index.totalUtf16 ? index.chapters.at(-1)! : index.chapters[0])
  );
}
export interface PageRange {
  start: number;
  end: number;
}
export interface ReaderState {
  chapterId: string;
  anchor: number;
  pageIndex: number;
  pages: PageRange[];
  generation: number;
}
export function pageForOffset(pages: PageRange[], offset: number): number {
  const n = pages.findIndex((p) => p.start <= offset && offset < p.end);
  return n >= 0
    ? n
    : offset < (pages[0]?.start ?? 0)
      ? 0
      : Math.max(0, pages.length - 1);
}
export function turnPage(state: ReaderState, delta: -1 | 1): ReaderState {
  const next = state.pageIndex + delta;
  return next < 0 || next >= state.pages.length
    ? state
    : { ...state, pageIndex: next, anchor: state.pages[next].start };
}
export function relayout(state: ReaderState, pages: PageRange[]): ReaderState {
  return { ...state, pages, pageIndex: pageForOffset(pages, state.anchor) };
}
