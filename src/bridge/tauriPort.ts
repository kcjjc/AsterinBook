import { invoke } from "@tauri-apps/api/core";
import type { DesktopPort, ReadingPrefs, NovelIndex } from "./contracts";
export const tauriPort: DesktopPort = {
  startup: () => invoke("startup"),
  chooseRoot: (mode) => invoke("choose_root", { mode }),
  listBooks: (sort) => invoke("list_books", { sort }),
  prepareImport: () => invoke("prepare_import"),
  readImportSource: (sessionId) =>
    invoke<ArrayBuffer>("read_import_source", { sessionId }),
  writeImportChunk: async (sessionId, sequence, bytes) => {
    await invoke("write_import_chunk", bytes, {
      headers: {
        "x-import-session": sessionId,
        "x-import-sequence": String(sequence),
      },
    });
  },
  commitImport: (sessionId, title, index: NovelIndex) =>
    invoke("commit_import", { sessionId, title, index }),
  cancelImport: (sessionId) => invoke("cancel_import", { sessionId }),
  renameBook: (bookId, title) => invoke("rename_book", { bookId, title }),
  removeBook: (bookId) => invoke("remove_book", { bookId }),
  getIndex: (bookId) => invoke("get_index", { bookId }),
  readText: (bookId, chapterId, start, maxUtf16) =>
    invoke("read_text", { bookId, chapterId, start, maxUtf16 }),
  savePosition: (bookId, offset) => invoke("save_position", { bookId, offset }),
  flushWrites: () => invoke("flush_writes"),
  listBookmarks: (bookId) => invoke("list_bookmarks", { bookId }),
  addBookmark: (bookId, offset, excerpt) =>
    invoke("add_bookmark", { bookId, offset, excerpt }),
  removeBookmark: (bookmarkId) => invoke("remove_bookmark", { bookmarkId }),
  getPrefs: () => invoke("get_prefs"),
  setPrefs: (prefs: ReadingPrefs) => invoke("set_prefs", { prefs }),
  listFonts: () => invoke("list_fonts"),
  prepareMigration: () => invoke("prepare_migration"),
  commitMigration: (token) => invoke("commit_migration", { token }),
};
