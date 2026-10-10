import type { TextChunk } from "../bridge/contracts";
import type { PageRange } from "./readerState";
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export function safePrefixLength(text: string, max: number): number {
  let last = 0;
  for (const item of segmenter.segment(text)) {
    const end = item.index + item.segment.length;
    if (end > max) break;
    last = end;
  }
  return last;
}
export interface Layout {
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
}
export interface TextSource {
  read(start: number, maxUtf16: number): Promise<TextChunk>;
}
export interface MeasuredPage extends PageRange {
  continuation: boolean;
}
export function renderParagraphs(
  el: HTMLElement,
  text: string,
  continuation: boolean,
) {
  const fragment = document.createDocumentFragment();
  const lines = text.split("\n");
  lines.forEach((line, n) => {
    const p = document.createElement("p");
    p.textContent = line || "\u200b";
    if (n === 0 && continuation) p.className = "continuation";
    fragment.append(p);
  });
  el.replaceChildren(fragment);
}
export function createDomMeasure(layout: Layout) {
  const el = document.createElement("div");
  el.className = "page-text measure";
  Object.assign(el.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    fontSize: `${layout.fontSize}px`,
    fontFamily: layout.fontFamily,
    lineHeight: String(layout.lineHeight),
    visibility: "hidden",
    overflow: "hidden",
  });
  document.body.append(el);
  return {
    fits(text: string, continuation: boolean) {
      renderParagraphs(el, text, continuation);
      return el.scrollHeight <= el.clientHeight + 1;
    },
    dispose() {
      el.remove();
    },
  };
}
export async function* paginateChapter(
  source: TextSource,
  range: PageRange,
  layout: Layout,
  signal: AbortSignal,
): AsyncGenerator<MeasuredPage> {
  await document.fonts.ready;
  if (signal.aborted) return;
  if (
    layout.height < layout.fontSize * layout.lineHeight ||
    layout.width < layout.fontSize * 2
  )
    throw new Error("窗口过小，请缩小字号或关闭侧栏");
  const measure = createDomMeasure(layout);
  let start = range.start,
    readAt = start,
    buffer = "",
    done = false,
    continuation = false,
    count = 0;
  try {
    if (range.start === range.end) {
      yield { ...range, continuation: false };
      return;
    }
    while (start < range.end) {
      if (signal.aborted) return;
      if (buffer.length < 4096 && !done) {
        const block = await source.read(readAt, 32768);
        if (block.next <= readAt && !block.done)
          throw new Error("正文读取没有推进");
        buffer += block.text;
        readAt = block.next;
        done = block.done;
      }
      const boundaries = [0];
      for (const s of segmenter.segment(buffer))
        boundaries.push(s.index + s.segment.length);
      // Last cluster can continue into the next read block. Read another block if it is the only one.
      let available = boundaries.length - 1;
      if (!done) available--;
      if (available <= 0 && !done) {
        if (buffer.length >= 65536)
          throw new Error("正文含有异常长的单个字素，请检查 TXT 内容");
        const block = await source.read(
          readAt,
          Math.min(32768, 65536 - buffer.length),
        );
        if (block.next <= readAt && !block.done)
          throw new Error("正文读取没有推进");
        buffer += block.text;
        readAt = block.next;
        done = block.done;
        continue;
      }
      let lo = 0,
        hi = Math.max(0, available);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure.fits(buffer.slice(0, boundaries[mid]), continuation))
          lo = mid;
        else hi = mid - 1;
      }
      const used = boundaries[lo];
      if (!used) throw new Error("当前排版无法容纳正文，请缩小字号");
      // A short tail fitting wholly is not a real page end until more source is available.
      if (lo === available && !done && buffer.length < 65536) {
        const block = await source.read(
          readAt,
          Math.min(32768, 65536 - buffer.length),
        );
        buffer += block.text;
        readAt = block.next;
        done = block.done;
        continue;
      }
      yield { start, end: start + used, continuation };
      continuation = buffer[used - 1] !== "\n";
      start += used;
      buffer = buffer.slice(used);
      if (++count % 8 === 0) await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    measure.dispose();
  }
}
