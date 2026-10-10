import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const exe = resolve(
    ".superpowers/installer-verification/程序 安装/asterinbook.exe",
  ),
  started = performance.now(),
  child = spawn(exe, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9224",
    },
    windowsHide: true,
    stdio: "ignore",
  });
const result = { exe, pid: child.pid, started: new Date().toISOString() };
let browser;
try {
  for (let n = 0; n < 80; n++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert(browser, "installed window did not start");
  const page = browser.contexts().flatMap((c) => c.pages())[0];
  await page
    .getByRole("button", { name: "选择阅读数据目录", exact: true })
    .waitFor();
  result.startupMs = Math.round(performance.now() - started);
  const sample = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      resolve("tests/native/process-memory.ps1"),
      "-ProcessId",
      String(child.pid),
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "inherit"] },
  );
  let sampleText = "";
  sample.stdout.on("data", (b) => (sampleText += b));
  assert.equal(await new Promise((r) => sample.once("exit", r)), 0);
  result.memory = JSON.parse(sampleText);
  await page.screenshot({
    path: "docs/verification/installed-first-launch.png",
  });
  const second = spawn(exe, [], { windowsHide: true, stdio: "ignore" });
  result.secondExit = await Promise.race([
    new Promise((r) => second.once("exit", r)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("second instance did not exit")), 4000),
    ),
  ]);
  assert.equal(browser.contexts().flatMap((c) => c.pages()).length, 1);
  const close = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      resolve("tests/native/close-window.ps1"),
      "-ProcessId",
      String(child.pid),
      "-ExpectedExe",
      exe,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  assert.equal(await new Promise((r) => close.once("exit", r)), 0);
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("first-launch normal close did not exit")),
        4000,
      ),
    ),
  ]);
  result.status = "passed";
} catch (e) {
  result.status = "failed";
  result.error = e.stack;
  throw e;
} finally {
  child.kill();
  await browser?.close().catch(() => {});
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/installed-smoke-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
}
