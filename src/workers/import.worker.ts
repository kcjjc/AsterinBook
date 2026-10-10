import { decodeNovel, normalizeText, indexNovel } from "../domain/novel";
import type { Encoding } from "../bridge/contracts";
const workerSelf = self as unknown as {
  postMessage(data: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const postMessage = (data: unknown, transfer: Transferable[] = []) =>
  workerSelf.postMessage(data, transfer);
let jobId = 0,
  source: Uint8Array | undefined,
  text = "",
  encoding: Encoding = "utf-8",
  encoded: Uint8Array | undefined,
  sequence = 0;
function next() {
  if (!encoded) return;
  const start = sequence * 1048576;
  if (start >= encoded.length) {
    postMessage({ kind: "done", jobId });
    encoded = undefined;
    source = undefined;
    text = "";
    return;
  }
  const bytes = encoded.slice(start, start + 1048576);
  postMessage({ kind: "chunk", jobId, sequence, bytes }, [bytes.buffer]);
}
workerSelf.onmessage = (event: MessageEvent) => {
  const m = event.data;
  try {
    if (m.kind === "decode") {
      jobId = m.jobId;
      source = m.bytes ? new Uint8Array(m.bytes) : source;
      if (!source) throw new Error("未选择文件");
      const d = decodeNovel(source, m.encoding);
      text = normalizeText(d.text);
      encoding = d.encoding;
      const index = indexNovel(text, encoding);
      postMessage({
        kind: "preview",
        jobId,
        encoding,
        excerpt: text.slice(0, 1800),
        chapters: index.chapters.length,
      });
    } else if (m.jobId === jobId && m.kind === "confirm") {
      const index = indexNovel(text, encoding);
      encoded = new TextEncoder().encode(text);
      sequence = 0;
      postMessage({ kind: "index", jobId, index });
      next();
    } else if (m.jobId === jobId && m.kind === "ack") {
      sequence++;
      next();
    } else if (m.kind === "cancel") {
      source = undefined;
      encoded = undefined;
      text = "";
      jobId = m.jobId;
    }
  } catch (e) {
    postMessage({
      kind: "error",
      jobId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
