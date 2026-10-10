import type {
  DesktopPort,
  Book,
  NovelIndex,
  ReadingPrefs,
  Bookmark,
} from "../../../src/bridge/contracts";
import { DEFAULT_PREFS } from "../../../src/bridge/contracts";
import { indexNovel } from "../../../src/domain/novel";
export function memoryPort(importScenario = false, scenario = ""): DesktopPort {
  const text = scenario.startsWith("chapter-")
    ? "第一章 山风\n山风吹过。\n第二章 归途\n归途灯火。\n第三章 尾声\n故事结束。\n"
    : "第一章 山风\n" +
      "山风轻轻拂过长街。雨声落在旧书的纸页上，灯火照亮归途。\n".repeat(
        ["deep", "slow-pagination", "failed-pagination"].includes(scenario)
          ? 4000
          : 90,
      ) +
      "第二章 归途\n" +
      "归途的灯火仍在。年轻人推开门，看见等待已久的朋友。\n".repeat(40);
  const index = indexNovel(text, "utf-8");
  const books: Book[] = ["测试小说甲", "测试小说乙"].map((title, n) => ({
    id: `b${n}`,
    title,
    author: null,
    importedAt: "2026-10-08",
    lastReadAt: null,
    totalUtf16: text.length,
    position: scenario === "deep" ? 90000 : 0,
    chapterCount: index.chapters.length,
  }));
  let prefs: ReadingPrefs = { ...DEFAULT_PREFS };
  let marks: Bookmark[] = [];
  let attempts = 0;
  let startupAttempts = 0,
    prefsAttempts = 0,
    chunkFailed = false,
    positionAttempts = 0;
  const importText = scenario === "chunk-failure" ? text.repeat(260) : text;
  const importBytes = new TextEncoder().encode(importText);
  const uploaded: Uint8Array[] = [];
  const find = (id: string) => {
    const b = books.find((b) => b.id === id);
    if (!b) throw new Error("书籍不存在");
    return b;
  };
  return {
    async startup() {
      if (scenario === "startup-failure" && startupAttempts++ === 0)
        throw new Error("启动暂时失败");
      return {
        status: "ready",
        root: { path: "测试书库", libraryId: "test", schemaVersion: 1 },
      };
    },
    async chooseRoot() {
      return null;
    },
    async listBooks(sort) {
      return [...books].sort((a, b) =>
        sort === "title"
          ? a.title.localeCompare(b.title, "zh-CN")
          : a.id.localeCompare(b.id),
      );
    },
    async prepareImport() {
      return importScenario
        ? {
            kind: "prepared",
            value: {
              sessionId: "import-test",
              suggestedTitle: "新导入小说",
              sourceBytes: importBytes.length,
            },
          }
        : null;
    },
    async readImportSource() {
      return importBytes.slice().buffer;
    },
    async writeImportChunk(_id, sequence, bytes) {
      if (scenario === "chunk-failure" && sequence === 1 && !chunkFailed) {
        chunkFailed = true;
        throw new Error("模拟第二块写入失败");
      }
      if (sequence !== uploaded.length) throw new Error("块序号不匹配");
      uploaded.push(bytes.slice());
    },
    async commitImport(id, title, i) {
      if (scenario !== "chunk-failure" && attempts++ === 0)
        throw new Error("模拟数据库提交失败");
      if (uploaded.reduce((n, b) => n + b.length, 0) !== importBytes.length)
        throw new Error("正文不完整");
      let at = 0;
      for (const chunk of uploaded)
        for (const b of chunk)
          if (b !== importBytes[at++]) throw new Error("正文重复或损坏");
      const b: Book = {
        id,
        title,
        author: null,
        importedAt: new Date().toISOString(),
        lastReadAt: null,
        totalUtf16: i.totalUtf16,
        position: 0,
        chapterCount: i.chapters.length,
      };
      books.push(b);
      return b;
    },
    async cancelImport() {},
    async renameBook(id, title) {
      find(id).title = title;
    },
    async removeBook(id) {
      const n = books.findIndex((b) => b.id === id);
      if (n >= 0) books.splice(n, 1);
    },
    async getIndex() {
      return index;
    },
    async readText(id, chapterId, start, max) {
      if (scenario === "failed-pagination" && start >= 32775)
        throw new Error("模拟后续正文读取失败");
      if (scenario === "deep" || scenario === "slow-pagination")
        await new Promise((r) =>
          setTimeout(r, scenario === "slow-pagination" ? 500 : 70),
        );
      find(id);
      const c = index.chapters.find((c) => c.id === chapterId)!;
      let end = Math.min(start + max, c.bodyEnd);
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
        done: end === c.bodyEnd,
      };
    },
    async savePosition(id, offset) {
      if (scenario === "chapter-save-delay")
        await new Promise((r) => setTimeout(r, 800));
      if (scenario === "chapter-save-failure" && positionAttempts++ === 0)
        throw new Error("模拟进度保存失败");
      find(id).position = offset;
    },
    async flushWrites() {},
    async listBookmarks(id) {
      return marks.filter((m) => m.bookId === id);
    },
    async addBookmark(id, offset, excerpt) {
      const existing = marks.find(
        (m) => m.bookId === id && m.offset === offset,
      );
      if (existing) return existing;
      const m = {
        id: crypto.randomUUID(),
        bookId: id,
        offset,
        excerpt,
        createdAt: new Date().toISOString(),
      };
      marks.push(m);
      return m;
    },
    async removeBookmark(id) {
      marks = marks.filter((m) => m.id !== id);
    },
    async getPrefs() {
      return prefs;
    },
    async setPrefs(p) {
      if (scenario === "prefs-failure" && prefsAttempts++ === 0)
        throw new Error("模拟设置保存失败");
      prefs = { ...p };
    },
    async listFonts() {
      return ["SimSun", "Microsoft YaHei"];
    },
    async prepareMigration() {
      return null;
    },
    async commitMigration() {
      throw new Error("测试入口不迁移本地文件");
    },
  };
}
