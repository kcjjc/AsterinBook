import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const base = resolve(
  ".superpowers/native-verification",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(base, { recursive: true });
await mkdir("docs/verification", { recursive: true });
const exe = resolve("src-tauri/target/debug/examples/native_smoke.exe");
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
  assert(page, "production asset page not found");
  await page
    .getByRole("button", { name: "阅读本地小说甲", exact: true })
    .waitFor();
  return { child, browser, page };
}
const results = { base, exe, started: new Date().toISOString(), checks: [] };
let live;
const invoke = (page, name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
try {
  live = await launch();
  let { page } = live;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.screenshot({ path: "docs/verification/native-bookshelf.png" });
  const books = await invoke(page, "list_books", { sort: "recent" });
  assert.equal(books.length, 2);
  const a = books.find((b) => b.title === "本地小说甲");
  await page
    .getByRole("button", { name: "阅读本地小说甲", exact: true })
    .click();
  await page.getByTestId("page-text").filter({ hasText: "山风" }).waitFor();
  const firstAnchor = await page
    .getByTestId("reader-view")
    .getAttribute("data-anchor");
  await page.getByTestId("page-text").hover();
  await page.mouse.wheel(0, 80);
  for (
    let n = 0;
    n < 30 &&
    (await page.getByTestId("reader-view").getAttribute("data-anchor")) ===
      firstAnchor;
    n++
  )
    await page.waitForTimeout(20);
  assert.notEqual(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
    firstAnchor,
  );
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -80);
  for (
    let n = 0;
    n < 30 &&
    (await page.getByTestId("reader-view").getAttribute("data-anchor")) !==
      firstAnchor;
    n++
  )
    await page.waitForTimeout(20);
  assert.equal(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
    firstAnchor,
  );
  const bodyBox = await page.getByTestId("page-text").boundingBox();
  await page.mouse.click(
    bodyBox.x + bodyBox.width - 10,
    bodyBox.y + bodyBox.height / 2,
  );
  assert.notEqual(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
    firstAnchor,
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
    firstAnchor,
  );
  results.checks.push(
    "real WebView2 wheel up/down, edge click and direction-key page changes",
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  let anchor = Number(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
  );
  assert(anchor > 0);
  await page
    .getByRole("button", { name: "添加或取消书签", exact: true })
    .click();
  await page
    .getByRole("button", { name: "添加或取消书签", exact: true })
    .filter({ hasText: "已标记" })
    .waitFor();
  await page.getByRole("button", { name: "阅读设置", exact: true }).click();
  await page.getByLabel("字号").fill("24");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(
    Number(await page.getByTestId("reader-view").getAttribute("data-anchor")),
    anchor,
  );
  await page.screenshot({ path: "docs/verification/native-reader.png" });
  await page.getByRole("button", { name: "← 书架", exact: true }).click();
  assert.equal(
    (await invoke(page, "list_books", { sort: "recent" })).find(
      (b) => b.id === a.id,
    ).position,
    anchor,
  );
  assert.equal(
    (await invoke(page, "list_bookmarks", { bookId: a.id })).length,
    1,
  );
  results.checks.push(
    "real SQLite position/bookmark/preferences + full-window reader",
  );
  // Separate harness event selects a fixture via Core; binary IPC and the production Worker remain real.
  await invoke(page, "plugin:event|emit", {
    event: "smoke-prepare",
    payload: null,
  });
  const prepared = JSON.parse(
    await readFile(join(base, "prepared.json"), "utf8"),
  );
  const sessionId = prepared.value.sessionId;
  const workerFile = (await readdir("dist/assets")).find((p) =>
    p.startsWith("import.worker-"),
  );
  const upload = async (sessionId, title) =>
    await page.evaluate(
      async ({ sessionId, workerFile, title }) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const bytes = await invoke("read_import_source", { sessionId });
        if (!(bytes instanceof ArrayBuffer))
          throw new Error("binary response is not ArrayBuffer");
        return await new Promise((resolve, reject) => {
          const worker = new Worker(
            new URL(`/assets/${workerFile}`, location.href),
            { type: "module" },
          );
          let index;
          worker.onerror = (e) => {
            worker.terminate();
            reject(new Error(e.message));
          };
          worker.onmessage = async (e) => {
            const m = e.data;
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
                const b = await invoke("commit_import", {
                  sessionId,
                  title,
                  index,
                });
                worker.terminate();
                resolve(b);
              } else if (m.kind === "error") throw new Error(m.message);
            } catch (err) {
              worker.terminate();
              reject(err);
            }
          };
          worker.postMessage({ kind: "decode", jobId: 1, bytes }, [bytes]);
        });
      },
      { sessionId, workerFile, title },
    );
  const imported = await upload(sessionId, "真实 Worker 导入");
  assert.equal(imported.chapterCount, 2);
  results.checks.push(
    "ArrayBuffer source -> production Worker -> binary chunks -> SQLite commit",
  );
  await rm(join(base, "待导入.txt"));
  const index = await invoke(page, "get_index", { bookId: imported.id });
  const c = index.chapters[0];
  assert(
    (
      await invoke(page, "read_text", {
        bookId: imported.id,
        chapterId: c.id,
        start: c.bodyStart,
        maxUtf16: 100,
      })
    ).text.includes("山风"),
  );
  await writeFile(
    join(base, "待导入.txt"),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 10, 0xd6, 0xd0, 0xce, 0xc4, 10]),
  );
  await invoke(page, "plugin:event|emit", {
    event: "smoke-prepare",
    payload: null,
  });
  const gbkPrepared = JSON.parse(
    await readFile(join(base, "prepared.json"), "utf8"),
  );
  const gbkBook = await upload(gbkPrepared.value.sessionId, "GBK 中文样本");
  const gbkIndex = await invoke(page, "get_index", { bookId: gbkBook.id });
  assert.equal(gbkIndex.encoding, "gb18030");
  await rm(join(base, "待导入.txt"));
  assert.equal(
    (
      await invoke(page, "read_text", {
        bookId: gbkBook.id,
        chapterId: gbkIndex.chapters[0].id,
        start: 0,
        maxUtf16: 100,
      })
    ).text,
    "中文\n中文\n",
  );
  results.checks.push(
    "GBK source -> production Worker fallback -> exact normalized Chinese text after original removal",
  );
  await invoke(page, "plugin:event|emit", {
    event: "smoke-migrate",
    payload: null,
  });
  const plan = JSON.parse(await readFile(join(base, "migration.json"), "utf8"));
  const migrated = await invoke(page, "commit_migration", {
    token: plan.token,
  });
  assert(migrated.path.includes("迁移后"));
  results.checks.push(
    "real migration retains source; deleted original TXT remains readable",
  );
  await page
    .getByRole("button", { name: "阅读本地小说甲", exact: true })
    .click();
  await page.getByTestId("page-text").filter({ hasText: "山风" }).waitFor();
  await page.keyboard.press("ArrowRight");
  anchor = Number(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
  );
  await invoke(page, "plugin:event|emit", {
    event: "smoke-hold",
    payload: null,
  });
  for (let n = 0; n < 40; n++) {
    try {
      await readFile(join(base, "hold.json"));
      break;
    } catch {
      await page.waitForTimeout(25);
    }
  }
  // Window close travels through production onCloseRequested -> flush -> destroy.
  await invoke(page, "plugin:event|emit", {
    event: "smoke-close",
    payload: null,
  });
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowRight");
  assert.equal(
    Number(await page.getByTestId("reader-view").getAttribute("data-anchor")),
    anchor,
    "window close must freeze navigation while disk flush is pending",
  );
  await page
    .getByRole("status")
    .filter({ hasText: "正在保存并退出" })
    .waitFor();
  await Promise.race([
    new Promise((r) => live.child.once("exit", r)),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("normal window close timed out")),
        6000,
      ),
    ),
  ]);
  await live.browser.close();
  live = await launch();
  page = live.page;
  const reopened = await invoke(page, "list_books", { sort: "recent" });
  assert.equal(reopened.length, 4);
  assert.equal(reopened.find((b) => b.id === a.id).position, anchor);
  assert.equal((await invoke(page, "get_prefs")).fontSize, 24);
  assert.equal(
    (await invoke(page, "list_bookmarks", { bookId: a.id })).length,
    1,
  );
  assert((await invoke(page, "startup")).root.path.includes("迁移后"));
  assert.equal((await invoke(page, "list_fonts")).length > 2, true);
  results.checks.push(
    "close/restart preserves migrated path, four books, anchor, bookmark and font preference; Windows font enumeration",
    "close freezes navigation while native Core is busy; pending latest position survives restart",
  );
  assert.deepEqual(errors, []);
  results.completed = new Date().toISOString();
  results.status = "passed";
} catch (e) {
  results.status = "failed";
  results.error = e.stack;
  throw e;
} finally {
  if (live) {
    live.child.kill();
    await live.browser.close().catch(() => {});
  }
  await writeFile(
    "docs/verification/native-smoke-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
}
