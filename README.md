# AsterinBook

Windows 本地 TXT 小说阅读器，使用 React、TypeScript、Tauri 2 和 SQLite。界面沿用 `demo/` 的纸张配色和书架风格。

## 安装和使用

1. 运行 `src-tauri/target/release/bundle/nsis/AsterinBook_0.1.1_x64-setup.exe`，选择程序安装位置。
2. 首次启动选择一个空的阅读数据目录；也可打开已有 AsterinBook 书库。阅读目录不能位于程序安装目录内。
3. 在书架点击「导入 TXT」，选文件，检查编码和预览，确认后加入书架。原始 TXT 会被复制，之后可移动原文件。
4. 点击书籍进入整窗阅读。正文左右边缘、四个方向键、滚轮都能翻页。章末继续向后翻会进入下一章首页，全书末尾停留；反向翻页在本章首页停止。也可用「上一章」「下一章」或目录切换章节。
5. 右上角提供书签和排版设置，支持字体、字号、行距、边距、暖纸/素白/夜读。返回书架或正常关窗会刷新保存进度。
6. 设置页可以更改阅读数据目录。迁移复制整个书库，成功后保留原目录；选择有效的其他书库会切换打开，不合并。

支持 UTF-8、UTF-16 LE/BE 和 GBK/GB18030。单个 TXT 上限 50 MiB；首版没有正文关键词搜索。已安装 WebView2 后阅读无需联网；缺少 WebView2 时安装器需要下载运行时。

## 从旧版升级

当前使用安装包手动升级，没有在线自动更新。先正常关闭旧版，让进度保存完成；运行新版安装包，按提示升级并使用原程序安装位置。无需先卸载，也无需重新导入小说。本次 0.1.0 → 0.1.1 保持应用标识、书库结构和读取位置格式不变，原有书架、进度、书签、偏好及阅读目录记录会继续使用。升级前可在应用关闭后备份整个阅读目录。

## 数据和备份

阅读目录包含 `library.json`、`reader.db`、`books/<UUID>/source.txt` 和 `content.txt`；进度、书签及偏好存 SQLite。关闭应用后备份整个阅读目录，不要只复制数据库。迁移后旧副本不会自动删除。

书库位置记录在 `%APPDATA%\local.asterinbook.reader\bootstrap.json`。默认卸载保留阅读数据和此定位记录。卸载器若勾选删除应用数据，定位记录会被移除；小说书库仍可通过「打开已有书库」选回。

## 开发

当前开发环境：Windows，Node 24、Rust MSVC 工具链、Visual Studio Build Tools「使用 C++ 的桌面开发」、WebView2。

```powershell
npm ci
npm run tauri -- dev
```

普通 `npm run dev` 网页入口提示运行桌面应用，不模拟文件写入。`/test.html` 是独立的内存数据测试入口，不进入生产构建；原视觉原型保留在 `demo/index.html`。

```powershell
npm test
npm run test:e2e
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
npm run tauri -- build --bundles nsis
```

浏览器回归使用当前 Windows 的 Edge。核心存储测试可用 `--no-default-features --target-dir src-tauri/target-core`，完整默认构建仍包含桌面功能。

原生自动验证入口独立于发布程序：

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --example native_smoke --features tauri/custom-protocol
node tests/native/smoke.mjs
```

验证脚本启用仅测试子进程的 WebView2 调试端口，不修改用户设置。测试安装与卸载脚本只操作 `.superpowers/installer-verification/程序 安装`，请先检查此目录符合自己的测试用途。

设计与实施计划在 `docs/superpowers/`，首版结果见 `docs/verification/release-results.md`；本次功能与升级验证见 [0.1.1 交付记录](docs/verification/release-0.1.1.md)。
