import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

// Use a copied 0.1.0 test library. Never open or modify the user's bootstrap or library.
const prior = JSON.parse(
  await readFile(".superpowers/change-0.1.1/native-smoke-0.1.0.json", "utf8"),
);
const base = resolve(".superpowers/change-0.1.1", `旧库兼容-${Date.now()}`);
const root = join(base, "图书 数据");
await mkdir(join(base, "config"), { recursive: true });
await cp(join(prior.base, "迁移后 数据"), root, { recursive: true });
const locator = JSON.parse(
  await readFile(join(prior.base, "config/bootstrap.json"), "utf8"),
);
await writeFile(
  join(base, "config/bootstrap.json"),
  JSON.stringify({ ...locator, rootPath: root }),
);
const exe = resolve("src-tauri/target/debug/examples/native_smoke.exe");
const report = {
  version: "0.1.1",
  base,
  oldLibrary: prior.base,
  started: new Date().toISOString(),
  checks: [],
};
const invoke = (page, name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
let live;
async function launch() {
  const child = spawn(exe, [base], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223",
    },
    windowsHide: true,
    stdio: "ignore",
  });
  let browser;
  try {
    for (let n = 0; n < 80; n++) {
      try {
        browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    assert(browser, "WebView2 debug connection unavailable");
    let page;
    for (let n = 0; n < 40; n++) {
      page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes("tauri.localhost"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(page, "production page not found");
    await page
      .getByRole("button", { name: "阅读本地小说甲", exact: true })
      .waitFor();
    return { child, browser, page };
  } catch (e) {
    child.kill();
    await browser?.close();
    throw e;
  }
}
async function close() {
  const child = live.child;
  const exited = new Promise((r) => child.once("exit", r));
  await invoke(live.page, "plugin:event|emit", {
    event: "smoke-close",
    payload: null,
  });
  let timer;
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("normal window close timed out")),
        6000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  await live.browser.close();
  live = null;
}
try {
  live = await launch();
  let { page } = live;
  const before = await invoke(page, "list_books", { sort: "title" });
  assert.equal(before.length, 4);
  const oldPrefs = await invoke(page, "get_prefs");
  assert.equal(oldPrefs.fontSize, 24);
  const markedBook = before.find((b) => b.title === "本地小说甲");
  const oldMarks = await invoke(page, "list_bookmarks", {
    bookId: markedBook.id,
  });
  assert.equal(oldMarks.length, 1);
  for (const book of before) {
    const index = await invoke(page, "get_index", { bookId: book.id });
    const c = index.chapters[0];
    const text = await invoke(page, "read_text", {
      bookId: book.id,
      chapterId: c.id,
      start: c.bodyStart,
      maxUtf16: 100,
    });
    assert(text.text.length > 0, `old book unreadable: ${book.title}`);
  }
  report.checks.push(
    "0.1.0 library opens in 0.1.1: four books and text, positions, bookmark, font settings retained",
  );
  await writeFile(
    join(base, "待导入.txt"),
    "第一章 山风\n山风吹过。\n第二章 归途\n归途灯火。\n第三章 尾声\n故事结束。\n",
  );
  await invoke(page, "plugin:event|emit", {
    event: "smoke-prepare",
    payload: null,
  });
  const prepared = JSON.parse(
    await readFile(join(base, "prepared.json"), "utf8"),
  );
  const workerFile = (await readdir("dist/assets")).find((p) =>
    p.startsWith("import.worker-"),
  );
  const book = await page.evaluate(
    async ({ sessionId, workerFile }) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const bytes = await invoke("read_import_source", { sessionId });
      if (!(bytes instanceof ArrayBuffer))
        throw new Error("expected binary source");
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL(`/assets/${workerFile}`, location.href),
          { type: "module" },
        );
        let index;
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.onmessage = async ({ data: m }) => {
          try {
            if (m.kind === "preview")
              worker.postMessage({ kind: "confirm", jobId: 1 });
            else if (m.kind === "index") index = m.index;
            else if (m.kind === "chunk") {
              await invoke("write_import_chunk", m.bytes, {
                headers: {
                  "x-import-session": sessionId,
                  "x-import-sequence": String(m.sequence),
                },
              });
              worker.postMessage({
                kind: "ack",
                jobId: 1,
                sequence: m.sequence,
              });
            } else if (m.kind === "done") {
              const book = await invoke("commit_import", {
                sessionId,
                title: "跨章升级测试",
                index,
              });
              worker.terminate();
              resolve(book);
            } else if (m.kind === "error") throw new Error(m.message);
          } catch (e) {
            worker.terminate();
            reject(e);
          }
        };
        worker.postMessage({ kind: "decode", jobId: 1, bytes }, [bytes]);
      });
    },
    { sessionId: prepared.value.sessionId, workerFile },
  );
  assert.equal(book.chapterCount, 3);
  await page.reload();
  await page
    .getByRole("button", { name: "阅读跨章升级测试", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风吹过");
  for (const way of ["ArrowRight", "ArrowDown", "edge", "wheel", "button"]) {
    if (way === "edge") {
      const r = await page.getByTestId("page-text").boundingBox();
      await page.mouse.click(r.x + r.width - 10, r.y + r.height / 2);
    } else if (way === "wheel") {
      await page.getByTestId("page-text").hover();
      await page.mouse.wheel(0, 80);
    } else if (way === "button")
      await page.getByRole("button", { name: "下一页", exact: true }).click();
    else await page.keyboard.press(way);
    await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
    await expect(page.getByTestId("page-text")).toContainText("归途灯火");
    await expect(page.getByTestId("reader-view")).toHaveAttribute(
      "data-anchor",
      "20",
    );
    if (way !== "button") {
      await page.getByRole("button", { name: "上一章", exact: true }).click();
      await expect(page.getByTestId("page-text")).toContainText("山风吹过");
    }
  }
  report.checks.push(
    "production WebView2: right/down keys, right-edge click, wheel down and next-page button enter next chapter first page",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
  await page
    .getByRole("button", { name: "添加或取消书签", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "添加或取消书签", exact: true }),
  ).toContainText("已标记");
  await page.screenshot({
    path: "docs/verification/chapter-forward-0.1.1.png",
  });
  await close();
  live = await launch();
  page = live.page;
  assert.deepEqual(
    (await invoke(page, "list_books", { sort: "title" })).filter(
      (b) => b.id !== book.id,
    ),
    before,
  );
  assert.deepEqual(await invoke(page, "get_prefs"), oldPrefs);
  assert.deepEqual(
    await invoke(page, "list_bookmarks", { bookId: markedBook.id }),
    oldMarks,
  );
  assert.equal(
    (await invoke(page, "list_books", { sort: "title" })).find(
      (b) => b.id === book.id,
    ).position,
    20,
  );
  await page
    .getByRole("button", { name: "阅读跨章升级测试", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("归途灯火");
  await expect(
    page.getByRole("button", { name: "添加或取消书签", exact: true }),
  ).toContainText("已标记");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-text")).toContainText("故事结束");
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status")).toContainText("已到全书末页");
  await expect(page.getByTestId("reader-chapter")).toContainText("第三章");
  report.checks.push(
    "normal close/restart retains chapter-two position and new bookmark, preserves all old books/positions/bookmarks/preferences; reverse and whole-book boundaries stop",
  );
  await close();
  report.status = "passed";
  report.completed = new Date().toISOString();
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  throw e;
} finally {
  if (live) {
    live.child.kill();
    await live.browser.close().catch(() => {});
  }
  await writeFile(
    "docs/verification/chapter-forward-0.1.1-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
}
