# AsterinBook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的网页 Demo 做成可安装、可离线管理和阅读中文 TXT 的 Windows 应用，交付安装 EXE。

**Architecture:** React/TypeScript 提供书架、阅读状态、导入解析和 DOM 分页，Rust 提供受限文件操作、SQLite 与数据迁移。规范化正文存文件，章节索引、逻辑阅读位置和偏好存 SQLite；界面通过类型化 DesktopPort 调用原生能力。

**Tech Stack:** React、TypeScript、Vite、Tauri 2、rusqlite（bundled）、Web Worker、Vitest、Playwright、NSIS。

**Spec:** [2026-10-08-asterinbook-design.md](../specs/2026-10-08-asterinbook-design.md)。执行者先阅读方案和本计划，保留 `demo/` 作为视觉参照。

## Global Constraints

- 当前 Windows，最终打包为安装版 EXE。
- TypeScript 为主，桌面能力采用 Tauri + 少量 Rust。
- 程序安装目录、阅读数据目录分别自定义。
- 复制原文件到阅读数据目录，不依赖原文件路径。
- 点击书籍后，阅读界面填满整个应用窗口。
- 一屏一页；点击、方向键、滚轮上下翻页。
- 翻页到章节首尾时停留，不自动跨章。
- 首版不做正文关键词搜索。
- 正文位置统一使用规范化文本中的 UTF-16 全局偏移；字节范围及页面范围为左闭右开。
- 单文件导入上限为 50 MiB，即 52,428,800 字节；超出在复制前提示。
- 进度约 1 秒内合并保存，正常退出刷新；书签和设置得到存储成功回应后才显示成功。
- 原阅读数据目录在迁移成功后保留，不自动删除；升级与卸载保留书库及启动记录。

## Review Focus

1. Windows 路径大小写、中文、空格、目录连接及父子关系：不能把书库迁到自身内部，也不能误删外部路径。任务 2、9 覆盖。
2. 解码成功但编码不正确、正文中提到章节、只有卷标题的文本：可预览纠正，不丢正文。任务 3 覆盖。
3. 超长无章节文本、emoji、组合字符及反复排版：页内容完整，锚点稳定，界面可以继续响应。任务 6、7 覆盖。
4. 导入和迁移在任一提交点退出、磁盘满、目标库有效但与来源不同：至少原书库仍可打开，不能静默覆盖。任务 4、9 覆盖。
5. 退出时保存失败、触控板惯性、多个窗口同时打开：用户得到明确反馈，不跨章，不让并发写入破坏数据。任务 2、7、10 覆盖。

---

## 执行约定与当前基线

2026-10-09 执行状态：十项首版实现已完成并交付安装包，最终回归与独立审查修复见 `docs/verification/release-results.md`。勾选项表示实现/验证已完成；含人工条件、未测量峰值或较广测试矩阵的复合步骤保留未勾选，实际已覆盖部分见验收记录，不视为全部通过。任务 4 Step 5 的编码/正文预览、分块进度和重试已完成，单独的原文件元数据展示仍未加入。文件分组及测试命令以执行 ledger 的对应决定为准。

2026-10-08 检查：工作区目前只有 Demo 和设计文档，没有正式工程，也不是 Git 仓库。Node v24.18.0、npm 11.16.0、Rust/Cargo 1.97.1 可调用；最小 Rust 编译在此前已验证。实施开始时重新检查工具链，不将旧检查当作 Tauri 构建成功。

本计划不初始化工程、不安装依赖。计划审阅并选择执行方式后才开始任务 1。任务按 1 → 10 顺序执行，各任务结束提供产物、验证结果和剩余限制。

命令均从 `C:\code\ts\AsterinBook` 的 PowerShell 执行，一次运行一个命令。不得使用会覆盖现有目录的生成器选项，不改用户级代理、Codex 配置和现有 Demo。依赖首次选择当前兼容的稳定版本，用 `package-lock.json`、`Cargo.lock` 固定；不直接沿用过时版本号。

任务中的提交步骤仅在执行工作区已经是 Git 仓库时执行；否则记录阶段结果，不为了提交惯例单独初始化仓库。若之后使用 Git，执行时按 using-git-worktrees 技能选择隔离位置，本计划路径随工作区调整。

### 验证命令约定

```text
npm run typecheck                         TypeScript 静态检查
npm run test -- <test-file>               指定 Vitest 测试
npm run test                             全部领域/状态测试
npm run test:e2e -- <test-file>            指定真实浏览器测试
npm run build                            前端生产构建
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri -- dev                     原生开发窗口
npm run tauri -- build --bundles nsis     正式安装包
```

浏览器测试使用显式测试入口和内存 DesktopPort，不在普通预览中伪装真实文件写入。真实文件、退出、迁移和安装器另做原生验证。新业务规则先运行失败测试再实现；纯样式、脚手架通过构建和视觉检查验证，不写只重复实现的测试。

## 文件与接口地图

| 文件/目录 | 单一职责 | 所属任务 |
| --- | --- | --- |
| `src/app/App.tsx`、`AppShell.tsx`、`useStartup.ts` | 页面切换、启动检查、桌面接口注入 | 1、2 |
| `src/bridge/contracts.ts`、`tauriPort.ts` | 唯一前后端契约和命令映射 | 2，后续逐项接入 |
| `src/domain/novel.ts`、`workers/import.worker.ts` | 解码、规范化、目录索引、Worker 协议 | 3 |
| `src/features/import/` | 编码预览与导入提交协调 | 4 |
| `src/features/library/` | 书架、重命名、移除、排序 | 5 |
| `src/domain/pagination.ts`、`pageMeasure.ts` | 页范围与真实 DOM 测量 | 6 |
| `src/features/reader/` | 阅读会话、控件、进度、面板 | 7、8 |
| `src/features/settings/` | 阅读数据路径与迁移界面 | 9 |
| `src/styles/tokens.css`、`layout.css`、`reader.css` | Demo 配色、页面及纸张样式 | 1、6、7 |
| `src-tauri/src/commands/` | 薄层 Tauri 命令，不放业务实现 | 2、4、5、7、8、9 |
| `src-tauri/src/services/data_root.rs`、`bootstrap.rs` | 数据目录验证与定位记录 | 2 |
| `src-tauri/src/services/import.rs`、`recovery.rs` | 暂存会话、导入/删除恢复 | 4、5 |
| `src-tauri/src/services/migration.rs`、`fs_ops.rs` | 迁移状态机、可注入失败的文件操作 | 9 |
| `src-tauri/src/storage/` | SQLite 架构、仓储、串行调度 | 2、4、5、7、8 |
| `tests/browser/`、`src-tauri/tests/` | 浏览器与真实存储回归 | 2—10 |
| `docs/verification/` | 原生和安装验证记录 | 1、10 |

### 跨任务数据契约

任务 2 创建 `src/bridge/contracts.ts`，下面是各任务共享的名称和字段；对应 Rust 类型在 `src-tauri/src/contracts.rs` 使用 `#[serde(rename_all = "camelCase")]`。所有数字为 JS 安全整数；偏移不允许负数，Rust 校验最大范围。

```ts
export type Id = string;
export type Encoding = "utf-8" | "gb18030" | "utf-16le" | "utf-16be";
export type Theme = "warm" | "white" | "night";
export type AppErrorCode =
  | "ROOT_UNAVAILABLE" | "ROOT_NOT_EMPTY" | "PATH_CONFLICT"
  | "FILE_TOO_LARGE" | "ENCODING_ERROR" | "INVALID_INDEX"
  | "SESSION_EXPIRED" | "NO_SPACE" | "IO_ERROR" | "DB_ERROR";
export interface AppError { code: AppErrorCode; message: string; }
export interface RootInfo { path: string; libraryId: Id; schemaVersion: number; }
export type Startup =
  | { status: "needsRoot"; suggestedPath: string }
  | { status: "ready"; root: RootInfo }
  | { status: "unavailable"; path: string; error: AppError };
export interface Chapter {
  id: Id; order: number; title: string; volumeId: Id | null;
  headingStart: number; bodyStart: number; bodyEnd: number;
  byteStart: number; byteEnd: number;
}
export interface TocVolume { id: Id; title: string; beforeChapter: number; }
export interface NovelIndex {
  version: 1; encoding: Encoding; totalUtf16: number; totalBytes: number;
  chapters: Chapter[]; volumes: TocVolume[];
  checkpoints: { utf16: number; byte: number }[];
}
export interface Book {
  id: Id; title: string; author: string | null;
  importedAt: string; lastReadAt: string | null;
  totalUtf16: number; position: number; chapterCount: number;
}
export interface PreparedImport {
  sessionId: Id; suggestedTitle: string; sourceBytes: number;
}
export type PrepareResult =
  | { kind: "duplicate"; bookId: Id }
  | { kind: "prepared"; value: PreparedImport };
export interface Bookmark { id: Id; bookId: Id; offset: number; excerpt: string; createdAt: string; }
export interface ReadingPrefs {
  fontSize: number; fontFamily: string; lineHeight: number;
  margin: number; theme: Theme; sort: "recent" | "title";
}
export interface TextChunk { start: number; text: string; next: number; done: boolean; }
export interface MigrationPlan {
  token: Id; mode: "copy" | "open"; source: string; target: string; bytes: number;
}
```

`DesktopPort` 方法全部返回 Promise，失败抛出 `AppError`。在各任务中实现相应方法，不用空方法假装功能可用。会话、迁移令牌只由 Rust 生成；原生文件选择在 Rust 侧完成，前端不提供任意源文件路径。

```ts
export interface DesktopPort {
  startup(): Promise<Startup>;
  chooseRoot(mode: "initialize" | "open"): Promise<RootInfo | null>;
  listBooks(sort: ReadingPrefs["sort"]): Promise<Book[]>;
  prepareImport(): Promise<PrepareResult | null>;
  readImportSource(sessionId: Id): Promise<ArrayBuffer>;
  writeImportChunk(sessionId: Id, sequence: number, bytes: Uint8Array): Promise<void>;
  commitImport(sessionId: Id, title: string, index: NovelIndex): Promise<Book>;
  cancelImport(sessionId: Id): Promise<void>;
  renameBook(bookId: Id, title: string): Promise<void>;
  removeBook(bookId: Id): Promise<void>;
  getIndex(bookId: Id): Promise<NovelIndex>;
  readText(bookId: Id, chapterId: Id, start: number, maxUtf16: number): Promise<TextChunk>;
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
```

## Task 1: 可启动的桌面壳与 Demo 视觉迁移

**Files:** Create `package.json`、`package-lock.json`、`index.html`、`tsconfig.json`、`tsconfig.node.json`、`vite.config.ts`、`src/main.tsx`、`src/app/App.tsx`、`src/app/AppShell.tsx`、`src/styles/tokens.css`、`src/styles/layout.css`、`src-tauri/Cargo.toml`、`Cargo.lock`（位于 src-tauri）、`src-tauri/build.rs`、`src-tauri/src/main.rs`、`src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`.gitignore`、`README.md`、`docs/verification/desktop-smoke.md`。

**Interfaces:** Produces `AppShell({mode, children}: {mode: "library" | "reader" | "settings"; children: React.ReactNode})`；`mode="reader"` 隐藏通用侧栏和顶栏。后续任务向 App 注入 `DesktopPort`。

- [x] **Step 1: 创建配置并安装锁定依赖。** 手动建立工程文件，避免生成器覆盖 `demo/`、`docs/`。前端依赖 React、ReactDOM、Tauri API 2；开发依赖 TypeScript、Vite、React Vite 插件、Tauri CLI 2、Vitest、Playwright、React 类型。Rust 使用 Tauri 2、serde、serde_json、rusqlite bundled、uuid v4、sha2、tempfile（测试）、dialog 和 single-instance 插件。需要 Windows 字体枚举时在任务 8 添加 windows crate 的必要特性。脚本约定如下：

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 1420 --strictPort",
    "typecheck": "tsc --noEmit",
    "build": "npm run typecheck && vite build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "tauri": "tauri"
  }
}
```

- [x] **Step 2: 创建 Tauri 入口与开发配置。** `build.rs` 调用 `tauri_build::build()`；Rust 主入口调用 library crate 的 `run()`。开发端口与 `devUrl` 一致，窗口默认 1100×780、最小 475×540，生产资源指向 `../dist`。

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AsterinBook",
  "version": "0.1.0",
  "identifier": "local.asterinbook.reader",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": { "windows": [{ "label": "main", "title": "AsterinBook", "width": 1100, "height": 780, "minWidth": 475, "minHeight": 540 }] },
  "bundle": { "active": true, "targets": ["nsis"] }
}
```

- [x] **Step 3: 拆出视觉变量和壳层。** 从 `demo/index.html` 提取已有配色、纸张纹理和封面样式，不提取示例导入逻辑。核心布局：

```css
:root { --bg:#f4f1e9; --paper:#f5ecd9; --ink:#332e26; --green:#3e5849; }
html, body, #root { margin:0; min-height:100%; }
.app--reader { height:100dvh; overflow:hidden; display:flex; flex-direction:column; }
.app--reader .reader-body { flex:1; min-height:0; display:flex; }
.reader-paper { flex:1; min-width:0; min-height:0; background:var(--paper); }
```

- [x] **Step 4: 构建并启动。** 分别运行 `npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml`、`npm run tauri -- dev`。预期真实 Windows 窗口打开；仅静态壳层，不展示“导入成功”之类假业务反馈。记录窗口和错误日志到 `desktop-smoke.md`。
- [ ] **Step 5: 检查视觉与版本记录。** 在 1280×820 与 475×612 对比 Demo；修正壳层溢出。若有 Git，提交 `chore: create AsterinBook desktop shell`，否则记录产物。

## Task 2: 数据目录、SQLite 与首次启动

**Files:** Create `src/bridge/contracts.ts`、`src/bridge/tauriPort.ts`、`src/app/useStartup.ts`、`src/features/settings/FirstLaunch.tsx`、`src-tauri/src/contracts.rs`、`commands/startup.rs`、`services/data_root.rs`、`services/bootstrap.rs`、`storage/mod.rs`、`storage/schema.sql`、`storage/actor.rs`、`src-tauri/tests/data_root.rs`；Modify `App.tsx`、`lib.rs`、`capabilities/default.json`。

**Interfaces:** Implements `startup()`、`chooseRoot(mode)`；Rust `open_root(path: &Path, install_dir: &Path) -> Result<RootInfo, AppError>`，`validate_root_path(path: &Path, install_dir: &Path) -> Result<PathBuf, AppError>`。原生使用 `LibraryStore` 串行调度线程；`with_db<T: Send + 'static>(&self, operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T, AppError> + Send + 'static) -> Result<T, AppError>`；`flush(&self) -> Result<(), AppError>`；`close(&self) -> Result<(), AppError>`；`reopen(&self, path: PathBuf) -> Result<(), AppError>`。阻塞等待只能位于 spawn_blocking 线程，不得在 async command 中阻塞界面线程。

- [x] **Step 1: 写目录规则失败测试。** 在测试临时目录使用真实文件，检查非书库非空目录、安装目录内部、中文空格路径，以及同一书库重开：

```rust
#[test]
fn refuses_non_library_nonempty_directory() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("用户文件.txt"), "保留").unwrap();
    let install = tempfile::tempdir().unwrap();
    let error = open_root(root.path(), install.path()).unwrap_err();
    assert_eq!(error.code, "ROOT_NOT_EMPTY");
    assert_eq!(std::fs::read_to_string(root.path().join("用户文件.txt")).unwrap(), "保留");
}
```

新增 case：`图书 数据` 可创建和再次打开且 `libraryId` 不变；安装路径的大小写变化仍拒绝；Windows junction 指向安装目录时按解析后的真实路径拒绝；丢失目录产生 `unavailable` 而不是初始化新库。
- [x] **Step 2: 运行失败测试。** `cargo test --manifest-path src-tauri/Cargo.toml --test data_root`；预期尚未实现接口或规则失败。
- [x] **Step 3: 建库和定位记录。** `canonicalize` 解析已有目录及父目录，使用组件级路径关系而非字符串前缀。先创建/验证 manifest，再打开 SQLite。schema 核心如下，增加 books 的哈希、编码及相对路径列，chapters 按契约存储：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
CREATE TABLE books (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT,
  source_hash TEXT NOT NULL UNIQUE, encoding TEXT NOT NULL,
  source_path TEXT NOT NULL, content_path TEXT NOT NULL,
  total_utf16 INTEGER NOT NULL, total_bytes INTEGER NOT NULL,
  imported_at TEXT NOT NULL, last_read_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('ready','deleting'))
);
CREATE TABLE reading_positions (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  offset INTEGER NOT NULL CHECK(offset >= 0), updated_at TEXT NOT NULL
);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  offset INTEGER NOT NULL CHECK(offset >= 0), excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(book_id, offset)
);
CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK(id = 1), value_json TEXT NOT NULL);
CREATE TABLE text_checkpoints (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  utf16_offset INTEGER NOT NULL, byte_offset INTEGER NOT NULL,
  PRIMARY KEY(book_id, utf16_offset)
);
PRAGMA user_version = 1;
```

`chapters` 保存 Chapter 的全部字段、book_id 外键和 `(book_id, chapter_order)` 唯一约束；`volumes` 保存卷标题与顺序。默认偏好 `{fontSize:20,fontFamily:"SimSun",lineHeight:1.95,margin:64,theme:"warm",sort:"recent"}`。manifest 为 `{libraryId,schemaVersion:1,normalizationVersion:1}`，现有库版本不支持时显式报错。
- [x] **Step 4: 原子保存 bootstrap 并接入启动 UI。** bootstrap 写到 Tauri 的应用配置目录，仅保存 rootPath 与迁移状态；同目录临时文件 write_all/sync_all 后用 windows-sys 的 MoveFileExW（REPLACE_EXISTING | WRITE_THROUGH）替换现有文件，同卷且检查返回值，不使用“先删旧文件再重命名”。本任务添加 windows-sys FileSystem 特性。Rust dialog 选择目录，返回 null 表示取消。缺失/只读书库显示重试和重新选择，不显示空书架。注册 single-instance 插件，第二次运行聚焦已有窗口。
- [ ] **Step 5: 验证。** 目录测试、类型检查、Rust 测试通过；原生选取中文空格目录、关闭重开、再次启动检查单实例。记录 `bootstrap.json` 实际位置与真实数据目录。若有 Git，提交 `feat: initialize configurable reading data storage`。

## Task 3: 解码、章节索引与导入 Worker

**Files:** Create `src/domain/novel.ts`、`src/domain/novel.test.ts`、`src/workers/import.worker.ts`、`src/workers/importProtocol.ts`；Modify `contracts.ts`。

**Interfaces:** `decodeNovel(bytes: Uint8Array, encoding?: Encoding): {text:string; encoding:Encoding}`；`normalizeText(text:string): string`；`indexNovel(text:string, encoding:Encoding): NovelIndex`。Worker 消息 `decode {jobId,bytes,encoding?}` → `preview {jobId,encoding,excerpt,warnings}`；`confirm {jobId}` → `index {jobId,index}` 和 `chunk {jobId,sequence,bytes}`，调用方回传 `ack {jobId,sequence}` 后发送下一块，最后 `done {jobId}`；`cancel {jobId}` 释放数据。错误带 jobId 和 AppError，废弃 job 的输出不得进入当前 UI。

- [x] **Step 1: 写章节及编码失败测试。** 用内联 UTF-8 样例和已知 GBK 字节，不依赖外网小说：

```ts
import { describe, it, expect } from "vitest";
import { decodeNovel, normalizeText, indexNovel } from "./novel";
describe("中文 TXT", () => {
  it("解码 GBK 字节", () => {
    expect(decodeNovel(new Uint8Array([0xd6,0xd0,0xce,0xc4]), "gb18030").text).toBe("中文");
  });
  it("保留序言且只识别独立标题", () => {
    const text = normalizeText("序言内容\r\n第一章 雨\r\n他提到第二章的故事。\r\n第１２章 山\r\n山风。\r\n");
    const index = indexNovel(text, "utf-8");
    expect(index.chapters.map(c => c.title)).toEqual(["序言", "第一章 雨", "第１２章 山"]);
    const chapter = index.chapters[1];
    expect(text.slice(chapter.bodyStart, chapter.bodyEnd)).toContain("第二章的故事");
    const encoded = new TextEncoder().encode(text);
    expect(new TextDecoder().decode(encoded.slice(chapter.byteStart, chapter.byteEnd)))
      .toBe(text.slice(chapter.bodyStart, chapter.bodyEnd));
  });
});
```

增加 UTF-16 双端 BOM、非法 UTF-8、空文件、无章节、只有卷和卷后说明、emoji、CR 单独换行、独立“序章/后记”、过长伪标题案例。空白文件返回可读错误，不添加空书；没有章节的非空书产生一个“正文”章节。
- [x] **Step 2: 运行失败测试。** `npm run test -- src/domain/novel.test.ts`，预期缺少函数或断言失败。
- [x] **Step 3: 实现规范化与保守扫描。** 只清理开头 BOM 和换行符，段落原文保留。基础规则：

```ts
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
const numberedHeading = /^第[零〇一二三四五六七八九十百千万两\d０-９]+[章回节](?:\s+.*|[：:、].*|[^\p{L}\p{N}].*)?$/u;
const volumeHeading = /^第[零〇一二三四五六七八九十百千万两\d０-９]+[卷部](?:\s+.*)?$/u;
```

标题 trim 后不超过 60 字符；匹配失败不删行。卷作为 TocVolume，卷后的正文在首章前保留为卷内“正文”，不能被目录层级吃掉。中文章节无空格标题如“第一章雨夜”也纳入专门规则测试，禁止直接用宽泛“第…章”子串扫描。用单次行扫描累计 UTF-16 与 UTF-8 偏移，避免为每个标题重新编码全书产生平方复杂度。

同时每约 64 Ki UTF-16 单元在完整字符边界记录 checkpoint（全局 utf16、UTF-8 byte），供任务 6 从附近字节位置开始读正文，不重复从章首扫描巨型章节。空白、换行和标题都参与全局位置计算。
- [x] **Step 4: 实现 Worker 预览及确认。** BOM 优先、无 BOM 严格 UTF-8 后尝试 GB18030；预览总是允许手动改编码。确认后生成编码正文，按 1 MiB 块移交 ArrayBuffer 并等待 ack；每个 job 独立，终止后清空大缓冲区。无效编码产生 `ENCODING_ERROR`，不能自动用替换字符覆盖原内容。
- [ ] **Step 5: 验证并记录。** 单测通过；用 50 MiB 生成文本测扫描耗时和峰值内存，确认主线程可响应取消。若有 Git，提交 `feat: parse Chinese novel encodings and chapter indexes`。

## Task 4: 真实文件导入与可恢复提交

**Files:** Create `src/features/import/ImportDialog.tsx`、`useImport.ts`、`src-tauri/src/commands/import.rs`、`services/import.rs`、`services/recovery.rs`、`storage/books.rs`、`src-tauri/tests/import.rs`；Modify `tauriPort.ts`、`lib.rs`。

**Interfaces:** Implements `prepareImport`、`readImportSource`、`writeImportChunk`、`commitImport`、`cancelImport`。Rust `ImportService::prepare_selected(path)` 仅由原生命令传入已选择文件；`write_chunk(session,sequence,bytes)`；`commit(session,title,index)`；`recover_imports(root)`。内部 manifest 阶段为 `copied` → `contentWritten` → `filesCommitted` → `dbCommitted`。

- [x] **Step 1: 写真实暂存导入失败测试。** `src-tauri/tests/import.rs` 使用 tempdir：

```rust
#[test]
fn rejects_large_source_before_creating_session() {
    let source = tempfile::NamedTempFile::new().unwrap();
    source.as_file().set_len(52_428_801).unwrap();
    let root = tempfile::tempdir().unwrap();
    let service = ImportService::for_test(root.path());
    assert_eq!(service.prepare_selected(source.path()).unwrap_err().code, "FILE_TOO_LARGE");
    assert_eq!(std::fs::read_dir(root.path().join("staging")).unwrap().count(), 0);
}
```

再测：重复哈希返回已有 bookId；索引越界拒绝；第 2 个 chunk 提前到达拒绝；原文件移动后 source.txt 哈希不变；分别在文件提交前、文件提交后、数据库提交后注入中断，重启恢复后可打开已提交书或清理未提交任务。`for_test` 创建实际 SQLite 与 staging，返回 service，不使用空实现。
- [x] **Step 2: 运行失败测试。** `cargo test --manifest-path src-tauri/Cargo.toml --test import`。
- [x] **Step 3: 实现原始复制和二进制 IPC。** 原生 dialog 只选一个 TXT，复制中再次限制实际字节数，防止源文件变大；哈希边复制边计算。source 通过 `tauri::ipc::Response` 返回 ArrayBuffer，正文分块用 raw request 和令牌/sequence header：

```ts
await invoke("write_import_chunk", bytes, {
  headers: { "x-import-session": sessionId, "x-import-sequence": String(sequence) }
});
```

Rust 解析 `InvokeBody::Raw`，令牌映射到预登记暂存目录，限制块大小、序号及总字节数；不从 header 读取文件路径。内容目录以 UUID 创建，不能由书名拼接目录。
- [x] **Step 4: 实现提交和恢复。** 流程是 sync 文件 → 将暂存书籍目录 rename 到 books/ID → SQLite 事务插入索引和元数据 → 标记/清理任务。正文哈希、实际字节长度、UTF-16 长度和 UTF-8 边界校验通过后才提交。恢复先查询数据库是否存在该 bookId 的 ready 记录，再结合 manifest；即使记录仍为 filesCommitted，只要数据库已提交也必须保留。只有确认数据库没有记录的孤立目标目录才允许清理，重试不得生成第二本书。校验空间时按源文件大小、最大规范化 UTF-8 扩张和暂存余量保守估计；实际写失败仍可回滚。
- [ ] **Step 5: 接上预览 UI。** 展示原文件名、大小、编码、首段预览和章节数；确认后逐块落盘并显示进度；取消释放 Worker 和 Rust 会话；`commitImport` 成功后刷新书架。中文错误说明明确区分编码、空间、权限、数据库失败，不显示系统调用的无用堆栈。
- [x] **Step 6: 验证。** Rust 测试、领域单测、前端构建通过；原生导入 UTF-8 与 GBK 两个样本，移走测试源文件，重开仍读得出。若有 Git，提交 `feat: import TXT files into recoverable local library`。

## Task 5: 真实书架与书籍管理

**Files:** Create `src/features/library/LibraryPage.tsx`、`BookCard.tsx`、`useLibrary.ts`、`src-tauri/src/commands/library.rs`、`src-tauri/tests/library.rs`、`tests/browser/library.spec.ts`、`tests/browser/support/memoryPort.ts`、`playwright.config.ts`、`src/test-entry.tsx`；Modify `App.tsx`、`storage/books.rs`、`recovery.rs`、`tauriPort.ts`。

**Interfaces:** Implements `listBooks(sort)`、`renameBook`、`removeBook`；`LibraryPage({port,onOpen}: {port:DesktopPort;onOpen:(book:Book)=>void})`。测试 `MemoryPort` 遵守同一 DesktopPort，但只从 `/test.html` 的显式测试入口使用，不进入生产打包入口。

- [x] **Step 1: 写书架与删除失败测试。** 真数据库验证最近排序、中文标题排序、空标题拒绝、SQL 参数绑定、两本书记录隔离，删除 A 不影响 B：

```ts
import { test, expect } from "@playwright/test";
test("打开书籍时进入铺满窗口的阅读壳", async ({ page }) => {
  await page.goto("/test.html?fixture=two-books");
  await page.getByRole("button", { name: "阅读测试小说甲" }).click();
  await expect(page.getByTestId("library-sidebar")).toHaveCount(0);
  const box = await page.getByTestId("reader-view").boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(page.viewportSize()?.width);
});
```

此时阅读壳允许显示加载状态，任务 7 才接完整阅读；删除故障测试要求书籍标记 deleting 不再作为可读书显示，重启继续清理本书目录且不删除测试目录外文件。
- [x] **Step 2: 运行失败测试。** `cargo test --manifest-path src-tauri/Cargo.toml --test library`；`npm run test:e2e -- tests/browser/library.spec.ts`。
- [x] **Step 3: 实现读取、重命名和删除。** 查询只返回 ready books；排序稳定，以 ID 作同时间兜底。名称 trim 后非空、最多 120 字符，使用参数 SQL。删除先事务标记 deleting → 删除已验证的 books/UUID 范围 → 事务删除元数据并级联书签/进度，磁盘失败保留恢复标记。
- [x] **Step 4: 实现 Demo 书架。** 空状态、导入入口、书名生成封面、最近阅读卡、排序、菜单重命名与移除；作者 null 不显示虚构作者/分类。移除弹窗清楚说明仅删除书库副本。UI 使用文本节点，不用未经转义的书名拼 innerHTML：

```tsx
<button aria-label={`阅读${book.title}`} onClick={() => onOpen(book)}>
  <span className="cover-title">{book.title}</span>
  <span>{book.author ?? ""}</span>
</button>
```

- [ ] **Step 5: 验证。** 真实导入两本、改名、排序、移除其中一本，重启复查；书架桌面与窄窗口截图对比 Demo。若有 Git，提交 `feat: manage persistent bookshelf`。

## Task 6: 有界正文读取与 DOM 分页引擎

**Files:** Create `src/domain/pagination.ts`、`pageMeasure.ts`、`pagination.test.ts`、`src/features/reader/chapterSource.ts`、`src-tauri/src/commands/text.rs`、`services/text.rs`、`src-tauri/tests/text.rs`、`tests/browser/pagination.spec.ts`、`src/styles/reader.css`；Modify `tauriPort.ts`、`lib.rs`。

**Interfaces:** Implements `getIndex(bookId)`、`readText(bookId,chapterId,start,maxUtf16)`。Produces `PageRange={start:number;end:number}`；`TextSource.read(start:number,maxUtf16:number):Promise<TextChunk>`；`Layout={width:number;height:number;fontSize:number;fontFamily:string;lineHeight:number;margin:number}`；`paginateChapter(source:TextSource,range:PageRange,layout:Layout,signal:AbortSignal):AsyncGenerator<PageRange>`；`pageForOffset(pages:PageRange[],offset:number):number`；`createDomMeasure(layout:Layout):{fits(text:string,continuesParagraph:boolean):boolean;dispose():void}`。

- [x] **Step 1: 写范围和 UTF-8 定位失败测试。** `pagination.test.ts` 测页范围连续、锚点查找、空章至少一页；`text.rs` 测 checkpoint 前后 emoji、读请求越界和尾段完整字符。`pageForOffset` 在页尾边界选择下一页，章末锚点 clamp 到最后一页：

```ts
import { it, expect } from "vitest";
import { pageForOffset } from "./pagination";
it("页范围为左闭右开，章末归最后一页", () => {
  const pages = [{start:100,end:150},{start:150,end:203}];
  expect(pageForOffset(pages, 149)).toBe(0);
  expect(pageForOffset(pages, 150)).toBe(1);
  expect(pageForOffset(pages, 203)).toBe(1);
});
```

真实浏览器测试由 `/test.html?fixture=pagination` 显示测试采样和状态：

```ts
import { test, expect } from "@playwright/test";
test("分页完整覆盖 emoji 与长段落", async ({ page }) => {
  await page.goto("/test.html?fixture=pagination");
  await expect(page.getByTestId("pagination-result")).toHaveAttribute("data-complete", "true");
  const result = await page.getByTestId("pagination-result").getAttribute("data-coverage");
  expect(result).toBe("exact");
  await expect(page.getByTestId("pagination-result")).toHaveAttribute("data-overflow", "false");
});
```

测试入口以原文按 page range 切片拼接和 DOM scrollHeight/clientHeight 实测产生结果，不能硬编码 data-coverage。加入 ZWJ 家庭 emoji、组合重音、换行及无换行 10 MiB 长段落；分页时取消按钮可用，测量节点文本不超过 64 Ki 单元。
- [x] **Step 2: 运行失败测试。** `npm run test -- src/domain/pagination.test.ts`；`cargo test --manifest-path src-tauri/Cargo.toml --test text`；`npm run test:e2e -- tests/browser/pagination.spec.ts`。
- [x] **Step 3: 实现 Rust 分块读取。** 使用离 start 最近的 checkpoint 定位字节，再向前解码到 start；读取量最多 64 Ki UTF-16 单元，在完整字符边界结束，返回 start/text/next/done。检测不属于本书的 chapterId、负数及越界 start，返回明确错误。前端通过 checkpoint 和序列读取复用已加载块，LRU 正文缓存不超过 8 MiB；索引可常驻，整书正文不得常驻。
- [x] **Step 4: 实现 DOM 测量与异步分页。** await `document.fonts.ready`；隐藏测量容器与正文的字体、宽度、p 标签边距、段首缩进、white-space 和 overflow-wrap 一致。按段落追加，溢出时二分搜索可放置的 grapheme 边界；没有字符能放置时返回“窗口过小”，不死循环。使用 `Intl.Segmenter("zh",{granularity:"grapheme"})` 的局部候选边界，超长文本逐块测量，延续段不重新缩进。读取块仅保证完整字符，分页保留块末尾尚未确认的 grapheme 并与下一块合并，不能把块边界当成页边界。加入 emoji/组合字符恰好横跨 checkpoint 和读取块边界的测试。每产出一批页主动让出主线程并检查 signal：

```ts
export function pageForOffset(pages: PageRange[], offset: number): number {
  const found = pages.findIndex(p => p.start <= offset && offset < p.end);
  if (found >= 0) return found;
  return offset < (pages[0]?.start ?? 0) ? 0 : Math.max(0, pages.length - 1);
}
```

缓存 key 包括内容版本、章节、完整 Layout 和字体就绪状态；范围必须严格推进且无遗漏。正文标题占用空间通过阅读布局扣除，测量时不可忽略标题高度。开头/末尾空白是文本的一部分，不因视觉空白直接跳过逻辑范围。
- [ ] **Step 5: 验证。** 全部测试通过；测量节点 dispose 后无泄漏；50 MiB 无章节样本不插入整本 DOM，取消可用。若有 Git，提交 `feat: paginate novel text with bounded DOM measurement`。

## Task 7: 阅读会话、翻页、目录与续读

**Files:** Create `src/domain/readerState.ts`、`readerState.test.ts`、`src/features/reader/ReaderPage.tsx`、`ReaderToolbar.tsx`、`ReaderFooter.tsx`、`TocPanel.tsx`、`useReader.ts`、`wheelGesture.ts`、`wheelGesture.test.ts`、`positionWriter.ts`、`src-tauri/src/commands/reading.rs`、`storage/reading.rs`、`tests/browser/reader.spec.ts`；Modify `App.tsx`、`tauriPort.ts`、`reader.css`、`lib.rs`。

**Interfaces:** Implements `savePosition(bookId,offset)`、`flushWrites()`；Produces `ReaderState={chapterId:Id;anchor:number;pageIndex:number;pages:PageRange[];generation:number}`；`turnPage(state:ReaderState,delta:-1|1):ReaderState`；`relayout(state:ReaderState,pages:PageRange[]):ReaderState`；`WheelGesture.push(deltaY:number,timeMs:number,deltaMode:0|1|2): -1|0|1`；`PositionWriter.schedule(bookId,offset)`、`flush():Promise<void>`，内部接收 `DesktopPort`。ReaderPage 接受 book、port、onBack，不从全局变量读取当前书籍。

- [x] **Step 1: 写章节边界与锚点失败测试。**

```ts
import { it, expect } from "vitest";
import { turnPage, relayout } from "./readerState";
it("最后一页不跨章，反复排版不改变逻辑锚点", () => {
  const state = {chapterId:"c1",anchor:37,pageIndex:1,
    pages:[{start:0,end:30},{start:30,end:60}],generation:1};
  expect(turnPage(state, 1)).toEqual(state);
  const large = relayout(state, [{start:0,end:60}]);
  expect(large.anchor).toBe(37);
  expect(relayout(large, state.pages).anchor).toBe(37);
});
```

WheelGesture 测一次连续惯性事件只输出一次、静默 200 ms 后允许新手势、deltaMode 的行/页单位归一化。PositionWriter 用假时钟测试 1 秒合并、切书先 flush、写失败传递给调用方且可以重试。
- [x] **Step 2: 运行失败测试。** `npm run test -- src/domain/readerState.test.ts src/features/reader/wheelGesture.test.ts`，为 writer 增加 `positionWriter.test.ts` 后单独运行。
- [x] **Step 3: 实现纯阅读状态与事件过滤。**

```ts
export function turnPage(state: ReaderState, delta: -1 | 1): ReaderState {
  const next = state.pageIndex + delta;
  if (next < 0 || next >= state.pages.length) return state;
  return {...state,pageIndex:next,anchor:state.pages[next].start};
}
export function relayout(state: ReaderState, pages: PageRange[]): ReaderState {
  return {...state,pages,pageIndex:pageForOffset(pages,state.anchor)};
}
```

键盘绑定四个方向键，跳过 inputs、selects、textarea、contenteditable、isComposing 和覆盖面板。点击仅正文左右 25%，selection 非空或拖选时跳过。滚轮只在正文区域 preventDefault，阈值先用 40 像素、手势静默间隔 200 ms，按 deltaMode 归一化；同手势不重复触发，即使方向变动也须等待结束。首尾页提示不切章。
- [x] **Step 4: 接入分页、目录和正文。** ReaderPage 使用整窗 flex 布局；body 非自由滚动。ResizeObserver 更新可用正文宽高，旧 generation/AbortSignal 的结果忽略。首批足以包含 anchor 时展示，未完成总页数显示“排版中”，完成后显示准确页数。目录区分卷和章节；显式切章保存离开位置，切到目标 bodyStart；恢复位置在标题区时 clamp 到对应 bodyStart。正文和章节名均使用文本节点。
- [x] **Step 5: 实现正常退出保存。** 进度绑定主动导航；被动 relayout 不 schedule。返回书架、切书、窗口关闭时 await writer.flush，再 await port.flushWrites。关闭事件先 preventDefault，成功后 destroy 窗口；失败保留窗口并提供重试/明确退出选项，不伪称已保存。Native savePosition 检查 offset 属于本书合法范围，UPSERT 位置并更新 lastReadAt。
- [x] **Step 6: 写并运行浏览器完整交互。** reader.spec.ts 用至少两章 fixture 检查满窗、四键、三种翻页途径首末页停留、目录/按钮可跨章、选择文字不翻、面板滚动不翻、字号和窗口切换后 anchor 一致；检查布局 clientHeight/scrollHeight。退出与重开必须再用原生窗口验证，不以 MemoryPort 替代。若有 Git，提交 `feat: read chapters with stable progress and explicit chapter navigation`。

## Task 8: 书签、阅读偏好与可用字体

**Files:** Create `src/features/reader/BookmarksPanel.tsx`、`AppearancePanel.tsx`、`src/domain/bookmarks.ts`、`bookmarks.test.ts`、`src-tauri/src/commands/preferences.rs`、`storage/preferences.rs`、`storage/bookmarks.rs`、`services/fonts.rs`、`src-tauri/tests/preferences.rs`、`tests/browser/bookmarks.spec.ts`；Modify `useReader.ts`、`ReaderToolbar.tsx`、`tauriPort.ts`、`lib.rs`。

**Interfaces:** Implements `listBookmarks`、`addBookmark`、`removeBookmark`、`getPrefs`、`setPrefs`、`listFonts`；`bookmarksOnPage(marks:Bookmark[],page:PageRange):Bookmark[]`。字号 14—36 px、行距 1.4—2.6、边距 20—100 px，UI 与 Rust 使用相同验证范围；实际边距受窄窗口可用空间约束，不修改用户保存的偏好。

- [x] **Step 1: 写书签与设置失败测试。**

```ts
import { it, expect } from "vitest";
import { bookmarksOnPage } from "./bookmarks";
it("重新分页后页内原书签仍显示已标记", () => {
  const mark = {id:"m1",bookId:"b1",offset:37,excerpt:"山风",createdAt:"2026-10-08T00:00:00Z"};
  expect(bookmarksOnPage([mark], {start:30,end:60})).toEqual([mark]);
  expect(bookmarksOnPage([mark], {start:0,end:37})).toEqual([]);
});
```

Rust 测相同 book/offset 幂等、offset 越界拒绝、书签删除不影响另一本、偏好非法数值拒绝、关闭重开偏好一致；浏览器模拟写失败，按钮和 toast 不显示成功，保留操作可重试。
- [x] **Step 2: 运行失败测试。** `npm run test -- src/domain/bookmarks.test.ts`；`cargo test --manifest-path src-tauri/Cargo.toml --test preferences`。
- [x] **Step 3: 实现书签仓储与面板。** UNIQUE(book_id,offset) 防重复；Excerpt 取当前页开头最多 60 grapheme。若当前页包含一个或多个书签，工具栏显示已标记，取消当前页标记时移除列表中这些书签；列表独立删除仍可用。跳书签以 global offset 定位章节和页面：

```ts
export function bookmarksOnPage(marks: Bookmark[], page: PageRange): Bookmark[] {
  return marks.filter(m => page.start <= m.offset && m.offset < page.end);
}
```

- [x] **Step 4: 实现偏好与字体。** 偏好事务保存后提交 UI 已保存状态；连续滑动先预览再合并保存，失败标记尚未保存。Rust 通过 Windows 系统字体 API 枚举 family；列表筛选使用 `document.fonts.check`，保留 SimSun/Microsoft YaHei 等可用字体和系统回退，不需要网络字体。改变字体 await fonts.ready，再用原 anchor 重排。warm/white/night 主题只改 token，保留纸张质感和可读对比度。
- [x] **Step 5: 验证。** 书签跳转、删除、重排后状态、窄窗口覆盖面板、深色主题、重开偏好通过；真实数据库中书签确认写入后再强制退出仍存在。若有 Git，提交 `feat: persist bookmarks and reading preferences`。

## Task 9: 阅读数据迁移与启动恢复

**Files:** Create `src/features/settings/SettingsPage.tsx`、`MigrationDialog.tsx`、`src-tauri/src/commands/migration.rs`、`services/migration.rs`、`services/fs_ops.rs`、`src-tauri/tests/migration.rs`、`tests/browser/migration.spec.ts`；Modify `bootstrap.rs`、`recovery.rs`、`data_root.rs`、`App.tsx`、`tauriPort.ts`、`lib.rs`。

**Interfaces:** Implements `prepareMigration()`、`commitMigration(token)`；Rust `MigrationService::prepare(target: PathBuf) -> Result<MigrationPlan, AppError>`、`commit(token: String) -> Result<RootInfo, AppError>`、`recover() -> Result<Startup, AppError>`。准备结果 mode=copy 表示复制迁移，mode=open 表示已存在书库，界面明确确认“打开此书库”后通过同一 token 提交切换，bytes=0。`FsOps` 封装 copy/sync/rename/atomic_replace/hash/free_space，测试实现可在指定操作序号或阶段返回错误；真实实现只接收已校验的 PathBuf。迁移状态 `planned` → `copying` → `verified` → `targetCommitted` → `pointerSwitched`。

- [ ] **Step 1: 写迁移失败与恢复矩阵。** 各阶段注入错误/退出，重开后至少来源可读；数据库完整性失败、空间不足、目标非空、目标路径为来源父/子、junction alias、原书库只读、目标已存在不同 libraryId 分别测试。真实文件夹内容与 SQLite 一同校验，不能只测状态字符串。

```rust
#[test]
fn interrupted_migration_keeps_source_library_readable() {
    for phase in ["copying", "verified", "targetCommitted", "pointerSwitched"] {
        let fixture = MigrationFixture::with_two_books_and_bookmark();
        fixture.interrupt_at(phase);
        let _ = fixture.migrate();
        let reopened = fixture.restart();
        assert_eq!(reopened.books().len(), 2);
        assert_eq!(reopened.bookmarks().len(), 1);
        assert!(fixture.source_manifest_exists());
    }
}
```

`MigrationFixture` 在 `tests/migration.rs` 创建两个实际文本文件、章节索引、SQLite、bootstrap 和 FsOps 故障注入点；restart 创建新 service 并读取磁盘，不沿用旧内存状态。
- [x] **Step 2: 运行失败测试。** `cargo test --manifest-path src-tauri/Cargo.toml --test migration`。
- [x] **Step 3: 实现可恢复迁移。** 准备阶段拿原生目录选择结果，解析真实路径、估算完整库大小；显示精确来源和目标。界面先暂停操作、调用 PositionWriter.flush，再发 commitMigration；Rust 获取迁移独占锁，拒绝新 import/rename/read/save 等书库命令，然后 store.flush/close，避免一边拒绝 save 一边要求 UI flush 的死锁。复制到目标父目录的独立 staging，与目标同卷以便最后 rename。目标已存在且为空时，提交前再次确认空且无人写入，再移除该空目录并 rename；出现用户文件立即停止，不删除文件。

临时 marker 记录 source、target、libraryId 和阶段。哈希逐文件比较并运行 SQLite `PRAGMA integrity_check`；verify 后提交目标，再用任务 2 原子替换方式切换 bootstrap。成功 reopen 目标；失败 reopen 来源。若 pointerSwitched 后新库校验失败，在来源仍有效时恢复旧 pointer 并报告错误。来源始终保留。
- [x] **Step 4: 接入迁移与已有库打开 UI。** 在设置页展示实际路径和迁移数据量，迁移进行时遮罩阻止阅读操作。目标是有效不同书库时弹出“打开此书库”，flush/close 当前库后切换 bootstrap，不执行合并或覆盖。完成/失败状态须包含路径，失败仍可回原书架；不要自动删原目录。
- [ ] **Step 5: 验证。** 迁移测试矩阵、中文路径、不同驱动器、取消目录选择、已有库切换通过；原生迁移一次后重启查看两本书的进度和书签一致。若有 Git，提交 `feat: migrate reading data with crash recovery`。

## Task 10: 安装 EXE、整体验收与交付

**Files:** Create `assets/asterinbook.svg`、`src-tauri/icons/`、`src-tauri/windows/installer-hooks.nsh`、`docs/verification/windows-acceptance.md`、`docs/verification/release-results.md`；Modify `tauri.conf.json`、`README.md`、`package.json`，必要时创建 `src-tauri/windows/installer.nsi`（只有实际默认模板不能满足目录选择/保留启动记录时才加入）。

**Interfaces:** Produces `src-tauri/target/release/bundle/nsis/*-setup.exe` 和测试记录。最终交付链接使用构建实际返回的文件名，不能把计划中的通配路径当成产物。

- [x] **Step 1: 跑完整回归，修复已有失败。** npm test/typecheck/build、指定浏览器回归、cargo test/fmt/clippy；重复测试仅在修改或出现新失败后运行。原生验证必须覆盖真实文件选择、退出写入和目录迁移，不只打开网页预览。
- [x] **Step 2: 配置 NSIS。** 自制简单书本 SVG 图标并通过 Tauri 图标工具生成 Windows ico。安装器选择中文和 currentUser，WebView2 用现有运行时，缺失时 bootstrapper 安装。配置片段：

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper", "silent": true },
      "nsis": {
        "installMode": "currentUser",
        "languages": ["SimpChinese"],
        "displayLanguageSelector": false,
        "installerHooks": "windows/installer-hooks.nsh"
      }
    }
  }
}
```

先验证默认模板具有安装目录页。hooks 不操作阅读数据目录；若默认卸载器会删除 bootstrap，保留其所在应用配置目录的必要记录，模板改动按当前官方模板最小调整。卸载不得删除用户选择路径，升级时 schema migration 必须保留旧数据。不加入自动更新服务。
- [x] **Step 3: 构建安装包。** `npm run tauri -- build --bundles nsis`；预期前端生产构建、Rust release、NSIS 都成功并得到真实 setup.exe。记录大小、SHA-256、版本、产物绝对路径；首版交付本机安装包，不伪称已完成代码签名。
- [ ] **Step 4: 在本机实际安装验收。** 记录以下项目的实际路径和观察结果，不只打勾：

| 场景 | 应看到的结果 |
| --- | --- |
| 改程序安装目录，含中文与空格 | 程序在指定位置，能正常启动 |
| 首次启动另选阅读数据目录 | 原始副本、正文、DB 在独立位置 |
| 导入两本、目录跳转、三种翻页 | 数据独立，章末停留 |
| 字号/字体/窗口/面板反复变化 | 同一正文锚点可见，不漂移 |
| 书签添加后关闭重开 | 书签、偏好、位置仍存在 |
| 测试源 TXT 移出原路径 | 书库副本继续可读 |
| 第二次启动应用 | 聚焦原窗口，不多进程写书库 |
| 数据目录迁到非 C 盘后重开 | 书籍和记录完整 |
| 接近 50 MiB 的长文本 | 界面可取消/响应，无整书 DOM |
| 同路径升级安装 | 数据和启动记录保留 |
| 卸载并重新安装 | 阅读数据与 bootstrap 保留，可恢复 |
| 断网阅读 | 已安装 WebView2 后照常使用 |

安装、卸载验证只对本次创建的 AsterinBook 测试安装执行，不操作用户其他程序。使用的两个目录与安装器最终写入路径先记录；手动验证能力不可用时保留安装包并在交付记录明确列出未验证项，不将其算作通过。
- [x] **Step 5: 最终复查。** 对照设计文档第 10 节逐项映射到测试或原生记录；无 UI 假操作、无正文搜索入口、无静默丢书。填写 `release-results.md` 的实测启动耗时、内存、安装包大小与剩余限制，README 写清安装、首次目录选择、导入、迁移和书库备份方式。若有 Git，提交 `build: package and verify Windows reader installer`。

## 需求覆盖索引

| 设计要求 | 实现任务 | 关键证据 |
| --- | --- | --- |
| Windows/TypeScript/Tauri | 1、10 | 原生启动、release 构建、实际安装 |
| 两个目录独立 | 2、9、10 | 目录规则与迁移矩阵、安装目录页 |
| TXT 复制与中文编码 | 3、4 | 字节哈希、编码样例、源文件移走后阅读 |
| 多本书架与管理 | 4、5 | 双书隔离、排序、重命名、删除恢复 |
| 目录、卷、序言、无章节 | 3、7 | 解析样例、目录跳转 |
| 满窗纸张单页 | 1、6、7、8 | 桌面/窄窗口截图、DOM 尺寸 |
| 点击/方向键/滚轮，章末停留 | 7 | 状态测试、事件浏览器测试、原生滚轮 |
| 长文本与字符完整 | 3、6 | checkpoint、范围覆盖、50 MiB 实测 |
| 进度锚点稳定与正常退出保存 | 7 | 反复 relayout、writer 错误与原生重开 |
| 书签/字体/主题/字号 | 8 | DB 重开、书签重排定位、样式检查 |
| 迁移中断与不可用目录 | 2、4、9 | 故障注入、启动错误状态 |
| EXE 升级卸载保留数据 | 10 | Windows 验收记录与真实产物 |
| 首版范围排除项 | 5、7、10 | UI 与依赖复查，无正文搜索等入口 |

## 执行方式交接

计划审阅后选定一种执行方式：

- **当前会话直接执行（建议）**：主代理依次完成十个任务，任务结束验证，最后做整体审查。该项目的导入索引、逻辑位置、分块读取和迁移接口相互依赖，连续实现更容易保持接口一致。
- **子代理逐任务执行**：每个任务交给新的实现代理和审查代理，先完成当前任务审查再进入下一任务；独立审查更频繁，也需要更多上下文与等待。

两种方式都使用本计划和设计文档，不跳过真实 Windows 验证。此文档没有表示任何任务已完成；执行时才勾选相应步骤。

## 技术资料

接口与安装配置在计划编写时已核对 Tauri 2 官方文档；实施时用项目实际锁定版本再次确认。

- [Tauri 命令及二进制请求/响应](https://v2.tauri.app/develop/calling-rust/)
- [Tauri NSIS 安装程序](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri 配置，包含 installerHooks 与 installMode](https://v2.tauri.app/reference/config/)
