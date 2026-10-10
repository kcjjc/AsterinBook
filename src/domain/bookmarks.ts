import type { Bookmark } from "../bridge/contracts";
import type { PageRange } from "./readerState";
export function bookmarksOnPage(
  marks: Bookmark[],
  page: PageRange,
): Bookmark[] {
  return marks.filter((m) => page.start <= m.offset && m.offset < page.end);
}
