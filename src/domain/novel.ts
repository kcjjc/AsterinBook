import type { Chapter, Encoding, NovelIndex } from "../bridge/contracts";

export function decodeNovel(
  bytes: Uint8Array,
  encoding?: Encoding,
): { text: string; encoding: Encoding } {
  const bom: Encoding | undefined =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
          ? "utf-8"
          : undefined;
  const chosen = encoding ?? bom;
  if (chosen)
    return {
      text: new TextDecoder(chosen, { fatal: true }).decode(bytes),
      encoding: chosen,
    };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("gb18030", { fatal: true }).decode(bytes),
      encoding: "gb18030",
    };
  }
}
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
const heading =
  /^第[零〇一二三四五六七八九十百千万亿两\d０-９]+([章回节卷部])(.*)$/u;
const specials = /^(?:序章|楔子|尾声|后记|序言)(?:\s+.*)?$/u;
export function indexNovel(text: string, encoding: Encoding): NovelIndex {
  if (!text.trim()) throw new Error("文件没有可阅读的正文");
  const chapters: Chapter[] = [];
  const volumes: NovelIndex["volumes"] = [];
  const checkpoints: NovelIndex["checkpoints"] = [{ utf16: 0, byte: 0 }];
  let offset = 0,
    byte = 0,
    volumeId: string | null = null,
    pending: Chapter | undefined;
  const make = (
    title: string,
    headingStart: number,
    bodyStart: number,
    startByte: number,
  ): Chapter => ({
    id: `c${chapters.length}`,
    order: chapters.length,
    title,
    volumeId,
    headingStart,
    bodyStart,
    bodyEnd: text.length,
    byteStart: startByte,
    byteEnd: 0,
  });
  const end = (at: number, atByte: number) => {
    if (pending) {
      pending.bodyEnd = at;
      pending.byteEnd = atByte;
      chapters.push(pending);
      pending = undefined;
    }
  };
  const ensure = (at: number, atByte: number) => {
    if (!pending)
      pending = make(
        chapters.length === 0 && volumes.length === 0 ? "序言" : "正文",
        at,
        at,
        atByte,
      );
  };
  // Streaming line scanner: huge no-newline chapters do not build an array of lines.
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const endLine = newline < 0 ? text.length : newline + 1;
    const raw = text.slice(offset, newline < 0 ? text.length : newline);
    const trimmed = raw.trim();
    const candidate = trimmed.length <= 60 ? trimmed.match(heading) : null;
    // Common narrative references such as "第二章的故事" are prose, whereas
    // a separator (or an ordinary no-space title) still permits a heading.
    const match =
      candidate && /^(?:的|中|里|提到|说过|讲过)/u.test(candidate[2])
        ? null
        : candidate;
    const isSpecial = trimmed.length <= 60 && specials.test(trimmed);
    const lineByte = byte;
    // Advance in Unicode scalar values; byte/UTF16 checkpoints share exact boundaries.
    for (let at = offset; at < endLine;) {
      const cp = text.codePointAt(at)!;
      const units = cp > 0xffff ? 2 : 1;
      byte += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      at += units;
      if (at - checkpoints[checkpoints.length - 1].utf16 >= 65536)
        checkpoints.push({ utf16: at, byte });
    }
    if (match || isSpecial) {
      end(offset, lineByte);
      if (match && "卷部".includes(match[1])) {
        volumeId = `v${volumes.length}`;
        volumes.push({
          id: volumeId,
          title: trimmed,
          beforeChapter: chapters.length,
        });
      } else pending = make(trimmed, offset, endLine, byte);
    } else if (raw.length || pending) {
      ensure(offset, lineByte);
    }
    offset = endLine;
  }
  end(text.length, byte);
  if (!chapters.length)
    chapters.push({
      id: "c0",
      order: 0,
      title: "正文",
      volumeId,
      headingStart: 0,
      bodyStart: 0,
      bodyEnd: text.length,
      byteStart: 0,
      byteEnd: byte,
    });
  if (chapters.length === 1 && chapters[0].title === "序言" && !volumes.length)
    chapters[0].title = "正文";
  return {
    version: 1,
    encoding,
    totalUtf16: text.length,
    totalBytes: byte,
    chapters,
    volumes,
    checkpoints,
  };
}
