import { describe, it, expect } from "vitest";
import { decodeNovel, normalizeText, indexNovel } from "./novel";
describe("中文 TXT", () => {
  it("行首的章节叙述保留为正文", () => {
    const text = "第一章 山风\n第二章的故事，让他彻夜难眠。\n第二章 归途\n灯火";
    const i = indexNovel(text, "utf-8");
    expect(i.chapters.map((c) => c.title)).toEqual([
      "第一章 山风",
      "第二章 归途",
    ]);
    expect(
      text.slice(i.chapters[0].bodyStart, i.chapters[0].bodyEnd),
    ).toContain("第二章的故事");
  });
  it("保留序言和正文中的章节引用", () => {
    const text = normalizeText(
      "序言内容\r\n第一章 雨\r\n他提到第二章的故事。\r\n第１２章 山\r\n山风。\r\n",
    );
    const i = indexNovel(text, "utf-8");
    expect(i.chapters.map((c) => c.title)).toEqual([
      "序言",
      "第一章 雨",
      "第１２章 山",
    ]);
    expect(text.slice(i.chapters[1].bodyStart, i.chapters[1].bodyEnd)).toBe(
      "他提到第二章的故事。\n",
    );
  });
  it("识别无空格标题和中文数字", () =>
    expect(
      indexNovel(
        "第两百零一章山门\n内容\n第一千章 新篇\n正文",
        "utf-8",
      ).chapters.map((c) => c.title),
    ).toEqual(["第两百零一章山门", "第一千章 新篇"]));
  it("只有卷时保留卷后的正文", () => {
    const text = "第一卷 山\n卷后说明\n";
    const i = indexNovel(text, "utf-8");
    expect(i.volumes[0].title).toBe("第一卷 山");
    expect(text.slice(i.chapters[0].bodyStart, i.chapters[0].bodyEnd)).toBe(
      "卷后说明\n",
    );
  });
  it("无章节全文作为正文", () => {
    const i = indexNovel("普通文本\n第二行", "utf-8");
    expect(i.chapters[0].bodyStart).toBe(0);
    expect(i.chapters[0].title).toBe("正文");
  });
  it("空文件不入库", () => expect(() => indexNovel("  \n", "utf-8")).toThrow());
  it("GBK 解码", () =>
    expect(
      decodeNovel(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), "gb18030").text,
    ).toBe("中文"));
  it("UTF16 LE/BE BOM", () => {
    expect(decodeNovel(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e])).text).toBe(
      "中",
    );
    expect(decodeNovel(new Uint8Array([0xfe, 0xff, 0x4e, 0x2d])).text).toBe(
      "中",
    );
  });
  it("非法 UTF8 显式选择不替换字符", () =>
    expect(() => decodeNovel(new Uint8Array([0xff]), "utf-8")).toThrow());
  it("章节字节与 UTF16 范围对应且长文本有 checkpoint", () => {
    const t = "序章\n😀👨‍👩‍👧‍👦山风\n" + "长".repeat(70000) + "\n第2章 归\n末尾";
    const i = indexNovel(t, "utf-8");
    const bytes = new TextEncoder().encode(t);
    for (const c of i.chapters)
      expect(
        new TextDecoder().decode(bytes.slice(c.byteStart, c.byteEnd)),
      ).toBe(t.slice(c.bodyStart, c.bodyEnd));
    expect(i.checkpoints.length).toBeGreaterThan(1);
    expect(i.totalUtf16).toBe(t.length);
    expect(i.totalBytes).toBe(bytes.length);
  });
});
