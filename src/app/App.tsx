import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type {
  DesktopPort,
  Startup,
  Book,
  ReadingPrefs,
  MigrationPlan,
} from "../bridge/contracts";
import { DEFAULT_PREFS, errorMessage } from "../bridge/contracts";
import { tauriPort } from "../bridge/tauriPort";
import { AppShell } from "./AppShell";
import { LibraryPage } from "../features/library/LibraryPage";
import { ImportDialog } from "../features/import/ImportDialog";
import { ReaderPage } from "../features/reader/ReaderPage";
import { PositionWriter } from "../features/reader/positionWriter";
export default function App({
  port = tauriPort,
  testMode = false,
}: {
  port?: DesktopPort;
  testMode?: boolean;
}) {
  const [start, setStart] = useState<Startup | null>(null),
    [books, setBooks] = useState<Book[]>([]),
    [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS),
    [book, setBook] = useState<Book | null>(null),
    [view, setView] = useState<"library" | "settings">("library"),
    [importing, setImporting] = useState(false),
    [message, setMessage] = useState(""),
    [edit, setEdit] = useState<{
      kind: "rename" | "remove";
      book: Book;
    } | null>(null),
    [name, setName] = useState(""),
    [migration, setMigration] = useState<MigrationPlan | null>(null),
    [migrating, setMigrating] = useState(false),
    [closing, setClosing] = useState(false);
  const [prefsUnsaved, setPrefsUnsaved] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((s: string) => {
    setMessage(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 5000);
  }, []);
  const writer = useMemo(
    () =>
      new PositionWriter(
        (id, offset) => port.savePosition(id, offset),
        (e) => notify("进度保存失败：" + errorMessage(e)),
      ),
    [port, notify],
  );
  const prefsQueue = useRef(Promise.resolve());
  const latestPrefs = useRef(DEFAULT_PREFS),
    prefsDirty = useRef(false);
  const refresh = useCallback(async () => {
    const p = await port.getPrefs();
    latestPrefs.current = p;
    prefsDirty.current = false;
    setPrefsUnsaved(false);
    setPrefs(p);
    setBooks(await port.listBooks(p.sort));
  }, [port]);
  const startup = useCallback(async () => {
    try {
      const s = await port.startup();
      setStart(s);
      if (s.status === "ready") await refresh();
    } catch (e) {
      setStart({
        status: "unavailable",
        path: "",
        error: { code: "STARTUP_FAILED", message: errorMessage(e) },
      });
      notify(errorMessage(e));
    }
  }, [port, refresh, notify]);
  useEffect(() => {
    if (isTauri() || testMode) void startup();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [startup, testMode]);
  const flush = useCallback(async () => {
    if (start?.status !== "ready") return;
    await writer.flush();
    await prefsQueue.current.catch(() => {});
    if (prefsDirty.current) {
      const p = latestPrefs.current;
      prefsQueue.current = port.setPrefs(p).then(() => {
        if (latestPrefs.current === p) {
          prefsDirty.current = false;
          setPrefsUnsaved(false);
        }
      });
      await prefsQueue.current;
    }
    await port.flushWrites();
  }, [port, writer, start?.status]);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const off = await window.onCloseRequested(async (e) => {
        e.preventDefault();
        if (closingRef.current) return;
        closingRef.current = true;
        setClosing(true);
        try {
          await flush();
          await window.destroy();
        } catch (err) {
          closingRef.current = false;
          setClosing(false);
          notify("保存失败，请重试退出：" + errorMessage(err));
        }
      });
      if (alive) unlisten = off;
      else off();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [flush, notify]);
  async function choose(mode: "initialize" | "open") {
    try {
      const root = await port.chooseRoot(mode);
      if (root) {
        setStart({ status: "ready", root });
        await refresh();
      }
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  function savePrefs(p: ReadingPrefs) {
    if (closingRef.current) return;
    latestPrefs.current = p;
    prefsDirty.current = true;
    setPrefs(p);
    prefsQueue.current = prefsQueue.current
      .catch(() => {})
      .then(() => (latestPrefs.current === p ? port.setPrefs(p) : undefined))
      .then(() => {
        if (latestPrefs.current === p) {
          prefsDirty.current = false;
          setPrefsUnsaved(false);
        }
      })
      .catch((e) => {
        setPrefsUnsaved(true);
        notify("设置未保存：" + errorMessage(e));
        throw e;
      });
    void prefsQueue.current.catch(() => {});
    if (p.sort !== prefs.sort)
      void port
        .listBooks(p.sort)
        .then(setBooks)
        .catch((e) => notify(errorMessage(e)));
  }
  async function back() {
    try {
      await flush();
      setBook(null);
      await refresh();
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  async function manage() {
    if (!edit) return;
    try {
      if (edit.kind === "rename") await port.renameBook(edit.book.id, name);
      else await port.removeBook(edit.book.id);
      setEdit(null);
      await refresh();
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  async function migrate() {
    if (!migration) return;
    setMigrating(true);
    try {
      await flush();
      const root = await port.commitMigration(migration.token);
      setStart({ status: "ready", root });
      setMigration(null);
      await refresh();
      notify(
        migration.mode === "open"
          ? "已打开所选书库"
          : "迁移完成，原目录副本已保留",
      );
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setMigrating(false);
    }
  }
  const content =
    !isTauri() && !testMode ? (
      <main className="startup">
        <h1>AsterinBook</h1>
        <p>
          这是桌面应用的网页入口。请运行桌面程序使用真实文件导入和阅读数据目录。
        </p>
        <p>界面原型仍保留在 demo/index.html。</p>
      </main>
    ) : !start ? (
      <main className="startup">
        <h1>AsterinBook</h1>
        <p>正在打开书库…</p>
      </main>
    ) : start.status !== "ready" ? (
      <main className="startup">
        <div className="eyebrow">WELCOME TO ASTERINBOOK</div>
        <h1>给故事，找一个家。</h1>
        <p>
          {start.status === "unavailable"
            ? "当前阅读数据目录无法访问，请检查路径或重新选择。"
            : "请选择阅读数据目录，小说副本、进度、书签与偏好都保存在这里。"}
        </p>
        <p className="path-text">
          {start.status === "needsRoot" ? start.suggestedPath : start.path}
        </p>
        <button
          className="button primary"
          onClick={() => void choose("initialize")}
        >
          选择阅读数据目录
        </button>{" "}
        <button className="button" onClick={() => void choose("open")}>
          打开已有书库
        </button>
        {start.status === "unavailable" && (
          <>
            <p className="error">{start.error.message}</p>
            <button className="button" onClick={() => void startup()}>
              重试
            </button>
          </>
        )}
      </main>
    ) : (
      <AppShell
        mode={book ? "reader" : view}
        count={books.length}
        onLibrary={() => setView("library")}
        onSettings={() => setView("settings")}
      >
        {book ? (
          <ReaderPage
            key={book.id}
            book={book}
            port={port}
            prefs={prefs}
            paused={closing}
            onPrefs={savePrefs}
            onBack={() => void back()}
            writer={writer}
            notify={notify}
          />
        ) : view === "library" ? (
          <LibraryPage
            books={books}
            sort={prefs.sort}
            onSort={(sort) => savePrefs({ ...prefs, sort })}
            onImport={() => setImporting(true)}
            onOpen={setBook}
            onRename={(b) => {
              setEdit({ kind: "rename", book: b });
              setName(b.title);
            }}
            onRemove={(b) => setEdit({ kind: "remove", book: b })}
          />
        ) : (
          <div className="settings-page">
            <div className="eyebrow">MAKE YOURSELF AT HOME</div>
            <h1>读得舒服，也存得安心。</h1>
            <section className="settings-card">
              <h2>阅读数据位置</h2>
              <p className="path-text">{start.root.path}</p>
              <button
                className="button"
                onClick={() =>
                  void port
                    .prepareMigration()
                    .then(setMigration)
                    .catch((e) => notify(errorMessage(e)))
                }
              >
                更改阅读数据目录
              </button>
              <p className="path-text">
                小说、进度、书签与偏好一起迁移；完成后保留原目录副本。
              </p>
            </section>
            <section className="settings-card">
              <h2>阅读排版</h2>
              <p className="path-text">
                打开一本书，使用阅读页右上角的「排版」调整字号、字体、行距和纸张颜色。
              </p>
            </section>
            <section className="settings-card">
              <h2>AsterinBook 0.1.1</h2>
              <p className="path-text">
                本地 TXT 小说阅读器。无需账号，阅读无需联网。
              </p>
            </section>
          </div>
        )}
      </AppShell>
    );
  return (
    <>
      <div inert={closing}>
        {content}
        {importing && (
          <ImportDialog
            port={port}
            onClose={() => setImporting(false)}
            onDone={() => {
              setImporting(false);
              void refresh();
              notify("小说已加入书架");
            }}
          />
        )}
        {message && (
          <div className="toast-message" role="status">
            {message}
          </div>
        )}
        {prefsUnsaved && (
          <div className="unsaved-message" role="alert">
            阅读设置尚未保存{" "}
            <button
              className="button"
              onClick={() =>
                void flush().catch((e) =>
                  notify("设置未保存：" + errorMessage(e)),
                )
              }
            >
              重试保存设置
            </button>
          </div>
        )}
        {edit && (
          <div className="modal-backdrop">
            <section className="modal" role="dialog">
              <h2>{edit.kind === "rename" ? "修改书名" : "移除书籍"}</h2>
              {edit.kind === "rename" ? (
                <label>
                  书名
                  <input
                    autoFocus
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              ) : (
                <p>
                  将删除《{edit.book.title}》的书库副本、进度和书签。原始 TXT
                  不受影响。
                </p>
              )}
              <div className="modal-actions">
                <button className="button" onClick={() => setEdit(null)}>
                  取消
                </button>
                <button
                  className="button primary"
                  onClick={() => void manage()}
                >
                  确认
                </button>
              </div>
            </section>
          </div>
        )}
        {migration && (
          <div className="modal-backdrop">
            <section className="modal">
              <h2>
                {migration.mode === "open" ? "打开已有书库" : "迁移阅读数据"}
              </h2>
              <p className="path-text">
                来源：{migration.source}
                <br />
                目标：{migration.target}
              </p>
              <p>
                {migration.mode === "open"
                  ? "打开此书库；不合并两个书库。"
                  : `迁移 ${(migration.bytes / 1048576).toFixed(1)} MiB；原目录保留。`}
              </p>
              <div className="modal-actions">
                <button
                  className="button"
                  disabled={migrating}
                  onClick={() => setMigration(null)}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  disabled={migrating}
                  onClick={() => void migrate()}
                >
                  {migrating ? "正在迁移…" : "确认"}
                </button>
              </div>
            </section>
          </div>
        )}
        {testMode && <span className="test-banner">界面测试 · 内存数据</span>}
      </div>
      {closing && (
        <div className="modal-backdrop">
          <section className="modal" role="status">
            正在保存并退出…
          </section>
        </div>
      )}
    </>
  );
}
