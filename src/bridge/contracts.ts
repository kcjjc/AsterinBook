export type Id = string;
export type Encoding = "utf-8" | "gb18030" | "utf-16le" | "utf-16be";
export interface AppError {
  code: string;
  message: string;
}
export interface RootInfo {
  path: string;
  libraryId: Id;
  schemaVersion: number;
}
export type Startup =
  | { status: "needsRoot"; suggestedPath: string }
  | { status: "ready"; root: RootInfo }
  | { status: "unavailable"; path: string; error: AppError };
export interface Chapter {
  id: Id;
  order: number;
  title: string;
  volumeId: Id | null;
  headingStart: number;
  bodyStart: number;
  bodyEnd: number;
  byteStart: number;
  byteEnd: number;
}
export interface NovelIndex {
  version: 1;
  encoding: Encoding;
  totalUtf16: number;
  totalBytes: number;
  chapters: Chapter[];
  volumes: { id: Id; title: string; beforeChapter: number }[];
  checkpoints: { utf16: number; byte: number }[];
}
export interface Book {
  id: Id;
  title: string;
  author: string | null;
  importedAt: string;
  lastReadAt: string | null;
  totalUtf16: number;
  position: number;
  chapterCount: number;
}
export type PrepareResult =
  | { kind: "duplicate"; bookId: Id }
  | {
      kind: "prepared";
      value: { sessionId: Id; suggestedTitle: string; sourceBytes: number };
    };
export interface Bookmark {
  id: Id;
  bookId: Id;
  offset: number;
  excerpt: string;
  createdAt: string;
}
export interface ReadingPrefs {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  theme: "warm" | "white" | "night";
  sort: "recent" | "title";
}
export interface TextChunk {
  start: number;
  text: string;
  next: number;
  done: boolean;
}
export interface MigrationPlan {
  token: Id;
  mode: "copy" | "open";
  source: string;
  target: string;
  bytes: number;
}
export interface DesktopPort {
  startup(): Promise<Startup>;
  chooseRoot(mode: "initialize" | "open"): Promise<RootInfo | null>;
  listBooks(sort: ReadingPrefs["sort"]): Promise<Book[]>;
  prepareImport(): Promise<PrepareResult | null>;
  readImportSource(sessionId: Id): Promise<ArrayBuffer>;
  writeImportChunk(
    sessionId: Id,
    sequence: number,
    bytes: Uint8Array,
  ): Promise<void>;
  commitImport(sessionId: Id, title: string, index: NovelIndex): Promise<Book>;
  cancelImport(sessionId: Id): Promise<void>;
  renameBook(bookId: Id, title: string): Promise<void>;
  removeBook(bookId: Id): Promise<void>;
  getIndex(bookId: Id): Promise<NovelIndex>;
  readText(
    bookId: Id,
    chapterId: Id,
    start: number,
    maxUtf16: number,
  ): Promise<TextChunk>;
  savePosition(bookId: Id, offset: number): Promise<void>;
  flushWrites(): Promise<void>;
  listBookmarks(bookId: Id): Promise<Bookmark[]>;
  addBookmark(bookId: Id, offset: number, excerpt: string): Promise<Bookmark>;
  removeBookmark(bookmarkId: Id): Promise<void>;
  getPrefs(): Promise<ReadingPrefs>;
  setPrefs(prefs: ReadingPrefs): Promise<void>;
  listFonts(): Promise<string[]>;
  prepareMigration(): Promise<MigrationPlan | null>;
  commitMigration(token: Id): Promise<RootInfo>;
}
export const DEFAULT_PREFS: ReadingPrefs = {
  fontSize: 20,
  fontFamily: "SimSun",
  lineHeight: 1.95,
  margin: 64,
  theme: "warm",
  sort: "recent",
};
export function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);
}
