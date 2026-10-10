import { useEffect, useRef, useState } from "react";
import type { DesktopPort, Encoding, NovelIndex } from "../../bridge/contracts";
import { errorMessage } from "../../bridge/contracts";
export function ImportDialog({
  port,
  onDone,
  onClose,
}: {
  port: DesktopPort;
  onDone: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState("选择文件");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [encoding, setEncoding] = useState<Encoding>("utf-8");
  const [chapters, setChapters] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const worker = useRef<Worker | null>(null),
    session = useRef(""),
    index = useRef<NovelIndex | null>(null),
    committed = useRef(false),
    contentReady = useRef(false),
    aliveRef = useRef(true);
  const pendingChunk = useRef<{ sequence: number; bytes: Uint8Array } | null>(
    null,
  );
  const uploading = useRef(false);
  async function upload(
    chunk: { sequence: number; bytes: Uint8Array },
    w: Worker,
  ) {
    pendingChunk.current = chunk;
    uploading.current = true;
    await port.writeImportChunk(session.current, chunk.sequence, chunk.bytes);
    pendingChunk.current = null;
    if (aliveRef.current) {
      setPhase(`保存正文 · 第 ${chunk.sequence + 1} 块`);
      w.postMessage({ kind: "ack", jobId: 1, sequence: chunk.sequence });
    }
  }
  async function commit() {
    if (!index.current) throw new Error("缺少章节索引");
    setPhase("提交书籍与目录");
    await port.commitImport(session.current, titleRef.current, index.current);
    committed.current = true;
    if (aliveRef.current) onDone();
  }
  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    const w = new Worker(
      new URL("../../workers/import.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = async (e) => {
      if (!alive) return;
      const m = e.data;
      try {
        if (m.kind === "preview") {
          setEncoding(m.encoding);
          setExcerpt(m.excerpt);
          setChapters(m.chapters);
          setPhase("预览正文与编码");
          setBusy(false);
        } else if (m.kind === "index") {
          index.current = m.index;
        } else if (m.kind === "chunk") {
          await upload(m, w);
        } else if (m.kind === "done") {
          contentReady.current = true;
          await commit();
        } else if (m.kind === "error") {
          setError(m.message);
          setBusy(false);
        }
      } catch (err) {
        if (alive) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }
    };
    w.onerror = (e) => {
      if (alive) {
        setError(e.message || "文件解析失败，请重新导入");
        setBusy(false);
      }
    };
    void (async () => {
      try {
        const r = await port.prepareImport();
        if (!r) {
          if (alive) onClose();
          return;
        }
        if (r.kind === "duplicate") {
          if (alive) {
            setError("这本小说已经在书架中");
            setBusy(false);
          }
          return;
        }
        session.current = r.value.sessionId;
        if (!alive) {
          await port.cancelImport(session.current);
          return;
        }
        setTitle(r.value.suggestedTitle);
        titleRef.current = r.value.suggestedTitle;
        const bytes = await port.readImportSource(session.current);
        if (alive) w.postMessage({ kind: "decode", jobId: 1, bytes }, [bytes]);
      } catch (err) {
        if (alive) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }
    })();
    return () => {
      alive = false;
      aliveRef.current = false;
      w.terminate();
      if (session.current && !committed.current)
        void port.cancelImport(session.current).catch(() => {});
    };
  }, [port]);
  const titleRef = useRef(title);
  titleRef.current = title;
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-label="导入小说">
        <h2>给书架添一个故事</h2>
        <p>{phase}</p>
        {session.current && (
          <>
            <label>
              书名
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              文件编码
              <select
                value={encoding}
                disabled={busy || contentReady.current || uploading.current}
                onChange={(e) => {
                  const v = e.target.value as Encoding;
                  setEncoding(v);
                  setBusy(true);
                  setError("");
                  worker.current?.postMessage({
                    kind: "decode",
                    jobId: 1,
                    encoding: v,
                  });
                }}
              >
                {["utf-8", "gb18030", "utf-16le", "utf-16be"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <pre className="import-preview">{excerpt}</pre>
            <p>识别 {chapters} 个章节；请确认中文显示正常。</p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || !session.current || !title.trim() || !excerpt}
            onClick={() => {
              setBusy(true);
              setError("");
              if (pendingChunk.current && worker.current)
                void upload(pendingChunk.current, worker.current).catch(
                  (err) => {
                    setError(errorMessage(err));
                    setBusy(false);
                  },
                );
              else if (contentReady.current)
                void commit().catch((err) => {
                  setError(errorMessage(err));
                  setBusy(false);
                });
              else worker.current?.postMessage({ kind: "confirm", jobId: 1 });
            }}
          >
            确认导入
          </button>
        </div>
      </section>
    </div>
  );
}
