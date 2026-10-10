import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Book,
  DesktopPort,
  NovelIndex,
  ReadingPrefs,
  Bookmark,
  Chapter,
} from "../../bridge/contracts";
import { errorMessage } from "../../bridge/contracts";
import {
  paginateChapter,
  safePrefixLength,
  type MeasuredPage,
  type TextSource,
} from "../../domain/pagination";
import { pageForOffset, chapterForOffset } from "../../domain/readerState";
import { bookmarksOnPage } from "../../domain/bookmarks";
import { WheelGesture } from "./wheelGesture";
import type { PositionWriter } from "./positionWriter";
export function ReaderPage({
  book,
  port,
  prefs,
  onPrefs,
  onBack,
  writer,
  notify,
  paused = false,
}: {
  book: Book;
  port: DesktopPort;
  prefs: ReadingPrefs;
  onPrefs: (p: ReadingPrefs) => void;
  onBack: () => void;
  writer: PositionWriter;
  notify: (s: string) => void;
  paused?: boolean;
}) {
  const [index, setIndex] = useState<NovelIndex | null>(null),
    [chapter, setChapter] = useState<Chapter | null>(null),
    [pages, setPages] = useState<MeasuredPage[]>([]),
    [page, setPage] = useState(0),
    [text, setText] = useState(""),
    [marks, setMarks] = useState<Bookmark[]>([]),
    [panel, setPanel] = useState<"toc" | "marks" | "appearance" | null>(null),
    [fonts, setFonts] = useState<string[]>(["SimSun", "Microsoft YaHei"]),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [busy, setBusy] = useState(true),
    [anchor, setAnchor] = useState(book.position);
  const textRef = useRef<HTMLDivElement>(null),
    anchorRef = useRef(book.position),
    generation = useRef(0),
    changingChapter = useRef(false),
    wheel = useMemo(() => new WheelGesture(), []);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const current = pages[page];
  const marked = current ? bookmarksOnPage(marks, current) : [];
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const i = await port.getIndex(book.id);
        if (!alive) return;
        setIndex(i);
        const c = chapterForOffset(i, book.position);
        anchorRef.current = Math.max(
          c.bodyStart,
          Math.min(book.position, c.bodyEnd),
        );
        setAnchor(anchorRef.current);
        if (!pausedRef.current) writer.schedule(book.id, anchorRef.current);
        setChapter(c);
        setMarks(await port.listBookmarks(book.id));
        setFonts(await port.listFonts());
      } catch (e) {
        notify(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [book.id, port]);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s.width === r.width && s.height === r.height
          ? s
          : { width: r.width, height: r.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const source = useMemo<TextSource | null>(
    () =>
      chapter
        ? {
            read: (start, max) =>
              port.readText(book.id, chapter.id, start, max),
          }
        : null,
    [book.id, chapter, port],
  );
  useEffect(() => {
    if (!chapter || !source || !size.width || !size.height) return;
    const abort = new AbortController();
    const job = ++generation.current;
    setBusy(true);
    setPages([]);
    setText("");
    void (async () => {
      const result: MeasuredPage[] = [];
      let revealed = false;
      try {
        for await (const p of paginateChapter(
          source,
          { start: chapter.bodyStart, end: chapter.bodyEnd },
          { ...size, ...prefs },
          abort.signal,
        )) {
          if (job !== generation.current || abort.signal.aborted) return;
          result.push(p);
          if (p.start <= anchorRef.current && anchorRef.current < p.end)
            revealed = true;
          if (
            revealed &&
            (result.length % 8 === 0 ||
              (p.start <= anchorRef.current && anchorRef.current < p.end))
          ) {
            setPages([...result]);
            setPage(pageForOffset(result, anchorRef.current));
          }
        }
        if (job !== generation.current || abort.signal.aborted) return;
        setPages(result);
        setPage(pageForOffset(result, anchorRef.current));
        setBusy(false);
      } catch (e) {
        if (!abort.signal.aborted) {
          setBusy(false);
          notify(errorMessage(e));
        }
      }
    })();
    return () => abort.abort();
  }, [
    source,
    chapter,
    size,
    prefs.fontSize,
    prefs.fontFamily,
    prefs.lineHeight,
    prefs.margin,
  ]);
  useEffect(() => {
    if (!source || !current) {
      setText("");
      return;
    }
    let alive = true;
    void (async () => {
      let at = current.start,
        value = "";
      while (at < current.end) {
        const c = await source.read(at, Math.min(32768, current.end - at));
        if (c.next <= at) break;
        value += c.text;
        at = c.next;
      }
      if (alive) setText(value);
    })().catch((e) => notify(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [source, current]);
  function updateAnchor(offset: number) {
    if (pausedRef.current) return;
    anchorRef.current = offset;
    setAnchor(offset);
    writer.schedule(book.id, offset);
  }
  function flip(delta: -1 | 1) {
    if (pausedRef.current || changingChapter.current || !current) return;
    const next = page + delta;
    if (next < 0 || next >= pages.length) {
      if (delta < 0) notify("已到本章首页");
      else if (!busy && current.end === chapter?.bodyEnd) {
        const nextChapter = index?.chapters[chapterAt + 1];
        if (nextChapter) void change(nextChapter);
        else notify("已到全书末页");
      }
      return;
    }
    setPage(next);
    updateAnchor(pages[next].start);
  }
  async function change(c: Chapter, offset = c.bodyStart) {
    if (pausedRef.current || changingChapter.current) return;
    changingChapter.current = true;
    try {
      await writer.flush();
      if (pausedRef.current) return;
      updateAnchor(offset);
      if (c.id === chapter?.id) setPage(pageForOffset(pages, offset));
      else {
        setPages([]);
        setText("");
        setPage(0);
        setChapter(c);
      }
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      changingChapter.current = false;
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.isComposing ||
        pausedRef.current ||
        el.closest(".reading-panel") ||
        el.closest("input,textarea,select,[contenteditable=true]") ||
        panel === "marks" ||
        panel === "toc"
      )
        return;
      const d = ["ArrowLeft", "ArrowUp"].includes(e.key)
        ? -1
        : ["ArrowRight", "ArrowDown"].includes(e.key)
          ? 1
          : 0;
      if (d) {
        e.preventDefault();
        flip(d);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pages, panel]);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      const direction = wheel.push(e.deltaY, performance.now(), e.deltaMode);
      if (direction) flip(direction);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [page, pages, wheel]);
  async function toggleMark() {
    if (pausedRef.current || !current) return;
    try {
      if (marked.length) {
        for (const m of marked) await port.removeBookmark(m.id);
        notify("已移除书签");
      } else {
        await port.addBookmark(
          book.id,
          current.start,
          text.slice(0, safePrefixLength(text, 60)),
        );
        notify("已记下这一页");
      }
      setMarks(await port.listBookmarks(book.id));
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  const chapterAt = index?.chapters.findIndex((c) => c.id === chapter?.id) ?? 0;
  const margin = Math.min(prefs.margin, size.width < 500 ? 24 : prefs.margin);
  return (
    <section
      data-testid="reader-view"
      data-anchor={anchor}
      data-page-start={current?.start}
      data-page-end={current?.end}
      className={`reading-view reader-theme-${prefs.theme}`}
    >
      <header className="reading-toolbar">
        <div className="reading-title">
          <button className="tool" onClick={onBack}>
            ← 书架
          </button>
          <strong>{book.title}</strong>
        </div>
        <div className="reader-tools">
          <button
            className={`tool ${panel === "toc" ? "active" : ""}`}
            aria-label="章节目录"
            onClick={() => setPanel(panel === "toc" ? null : "toc")}
          >
            ☷ <span>目录</span>
          </button>
          <button
            className={`tool ${marked.length ? "active" : ""}`}
            aria-label="添加或取消书签"
            onClick={() => void toggleMark()}
          >
            ⚑ <span>{marked.length ? "已标记" : "书签"}</span>
          </button>
          <button
            className="tool"
            aria-label="书签列表"
            onClick={() => setPanel(panel === "marks" ? null : "marks")}
          >
            ▤
          </button>
          <button
            className={`tool ${panel === "appearance" ? "active" : ""}`}
            aria-label="阅读设置"
            onClick={() =>
              setPanel(panel === "appearance" ? null : "appearance")
            }
          >
            Aa <span>排版</span>
          </button>
        </div>
      </header>
      <div className="reading-body">
        <article
          className="reader-paper"
          style={{ paddingLeft: margin, paddingRight: margin }}
        >
          <h1 className="chapter-heading" data-testid="reader-chapter">
            {chapter?.title ?? "正在打开小说"}
          </h1>
          <div
            ref={textRef}
            data-testid="page-text"
            className="page-text"
            style={{
              fontSize: prefs.fontSize,
              fontFamily: `"${prefs.fontFamily}",serif`,
              lineHeight: prefs.lineHeight,
            }}
            onClick={(e) => {
              if (window.getSelection()?.toString()) return;
              const r = e.currentTarget.getBoundingClientRect(),
                x = (e.clientX - r.left) / r.width;
              if (x < 0.25) flip(-1);
              else if (x > 0.75) flip(1);
            }}
          >
            {text.split("\n").map((line, n) => (
              <p
                key={n}
                className={
                  n === 0 && current?.continuation ? "continuation" : ""
                }
              >
                {line || "\u200b"}
              </p>
            ))}
          </div>
        </article>
        {panel && (
          <aside className="reading-panel">
            <header>
              <strong>
                {panel === "toc"
                  ? "章节目录"
                  : panel === "marks"
                    ? "我的书签"
                    : "阅读排版"}
              </strong>
              <button aria-label="关闭面板" onClick={() => setPanel(null)}>
                ×
              </button>
            </header>
            {panel === "toc" &&
              index?.chapters.map((c, n) => (
                <div key={c.id}>
                  {index.volumes
                    .filter((v) => v.beforeChapter === n)
                    .map((v) => (
                      <div key={v.id} className="volume-label">
                        {v.title}
                      </div>
                    ))}
                  <button
                    className={`toc-row ${c.id === chapter?.id ? "active" : ""}`}
                    onClick={() => void change(c)}
                  >
                    {c.title}
                  </button>
                </div>
              ))}
            {panel === "marks" &&
              (!marks.length ? (
                <p className="empty-note">
                  还没有书签。读到喜欢的地方，点一下上方书签。
                </p>
              ) : (
                marks.map((m) => (
                  <div className="bookmark-row" key={m.id}>
                    <button
                      onClick={() => {
                        const c = index?.chapters.find(
                          (c) =>
                            c.bodyStart <= m.offset && m.offset < c.bodyEnd,
                        );
                        if (c) void change(c, m.offset);
                      }}
                    >
                      {
                        index?.chapters.find(
                          (c) =>
                            c.bodyStart <= m.offset && m.offset < c.bodyEnd,
                        )?.title
                      }
                      <p>{m.excerpt}…</p>
                    </button>
                    <button
                      className="remove"
                      onClick={() =>
                        void port
                          .removeBookmark(m.id)
                          .then(() => port.listBookmarks(book.id))
                          .then(setMarks)
                          .catch((e) => notify(errorMessage(e)))
                      }
                    >
                      移除书签
                    </button>
                  </div>
                ))
              ))}
            {panel === "appearance" && (
              <div className="appearance">
                <label>
                  字号 · {prefs.fontSize}px
                  <input
                    aria-label="字号"
                    type="range"
                    min="14"
                    max="36"
                    value={prefs.fontSize}
                    onChange={(e) =>
                      onPrefs({ ...prefs, fontSize: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  字体
                  <select
                    aria-label="字体"
                    value={prefs.fontFamily}
                    onChange={(e) =>
                      onPrefs({ ...prefs, fontFamily: e.target.value })
                    }
                  >
                    {[...new Set([prefs.fontFamily, ...fonts])].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label>
                  行距 · {prefs.lineHeight.toFixed(2)}
                  <input
                    aria-label="行距"
                    type="range"
                    min="1.4"
                    max="2.6"
                    step=".05"
                    value={prefs.lineHeight}
                    onChange={(e) =>
                      onPrefs({ ...prefs, lineHeight: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  页边距 · {prefs.margin}px
                  <input
                    aria-label="页边距"
                    type="range"
                    min="20"
                    max="100"
                    value={prefs.margin}
                    onChange={(e) =>
                      onPrefs({ ...prefs, margin: Number(e.target.value) })
                    }
                  />
                </label>
                <label>纸张颜色</label>
                <div className="theme-buttons">
                  {(["warm", "white", "night"] as const).map((theme, n) => (
                    <button
                      className={prefs.theme === theme ? "selected" : ""}
                      key={theme}
                      onClick={() => onPrefs({ ...prefs, theme })}
                    >
                      {["暖纸", "素白", "夜读"][n]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
      <footer className="reading-footer">
        <div className="footer-buttons">
          <button
            disabled={chapterAt <= 0}
            onClick={() => index && void change(index.chapters[chapterAt - 1])}
          >
            上一章
          </button>
          <button
            aria-label="上一页"
            disabled={page === 0}
            onClick={() => flip(-1)}
          >
            ‹
          </button>
          <span>
            {pages.length
              ? `${page + 1} / ${busy ? "排版中" : pages.length}`
              : "正在排版"}
          </span>
          <button
            aria-label="下一页"
            disabled={
              !current ||
              (page === pages.length - 1 &&
                (busy ||
                  current.end !== chapter?.bodyEnd ||
                  !index ||
                  chapterAt >= index.chapters.length - 1))
            }
            onClick={() => flip(1)}
          >
            ›
          </button>
          <button
            disabled={!index || chapterAt >= index.chapters.length - 1}
            onClick={() => index && void change(index.chapters[chapterAt + 1])}
          >
            下一章
          </button>
        </div>
        <span className="progress-label">
          全书 {Math.round((anchor / Math.max(1, book.totalUtf16)) * 100)}% ·
          滚轮 / 方向键翻页
        </span>
      </footer>
    </section>
  );
}
