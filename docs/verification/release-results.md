# AsterinBook 0.1.0 交付记录

验收日期：2026-10-09，当前 Windows x64。使用已确认的 Demo 实现 React/TypeScript/Tauri 桌面应用。

## 安装包

- 文件：`C:\code\ts\AsterinBook\src-tauri\target\release\bundle\nsis\AsterinBook_0.1.0_x64-setup.exe`
- 大小：3,068,774 字节，2.927 MiB。
- SHA256：`3c6c1f82ec6c92e3d2de3f23a6ad56a62a47d35bd1078dcbd1b7c3a222e5b9c4`。
- 未代码签名；中文 NSIS、当前用户安装、支持安装位置选择，阅读数据目录由首次启动单独选择。
- 元数据见 [artifact.json](artifact.json)。安装器依赖现有 WebView2；缺少运行时时会下载安装。

## 已验证

| 检查 | 本次结果 |
| --- | --- |
| Vitest 领域/保存队列 | 18/18，通过 |
| Edge 浏览器交互 | 14/14，通过 |
| 默认 desktop features 的 Rust 集成测试 | 20/20，通过 |
| TypeScript / Vite 生产构建 | 通过 |
| Rust fmt / clippy lib（warnings denied） | 通过；MSVC 链接器的库生成提示不属于代码警告 |
| release + NSIS 构建 | 通过，生成上述实际文件 |
| 独立最终审查 | 7 Important + 1 提级 Important 已修复；各项 RED→GREEN，完整回归通过；无延期 Minor |
| 实际安装版 | 中文空格自定义位置，首次启动、单实例、WM_CLOSE 退出通过 |
| 覆盖安装、卸载、重装 | 实际执行 exit 0；配置目录测试标记保留，真实测试书库 DB SHA256 不变 |
| 原生 WebView2 生产链路 | 四本真实书、二进制 IPC、发布 Worker、UTF-8/GBK 导入、移除原 TXT、阅读/书签/偏好/迁移/重启通过 |

真实桌面 harness 复用生产 builder/Core/commands/assets，只有选择测试文件/目录、延迟 Core 和请求关闭的事件属于验证工具。发布安装包没有这些事件。原生 harness 与安装版共享单实例标识，因此必须顺序运行。

## 功能与证据

书架支持多书、排序、重命名和移除；TXT 原始副本保存在阅读目录。章节解析支持常见中文数字/全角数字、卷、序言及无章节正文，导入支持编码预览与手动选择。UTF-8/UTF-16/GB18030 样例有领域测试，UTF-8 和 GBK 另经实际 WebView2/Worker/SQLite 验证。

阅读页占整个窗口，提供纸张配色、字体/字号/行距/边距、目录和书签。点击正文边缘、四个方向键、滚轮上下按单页切换；章节首末停止，跨章使用明确的按钮或目录。DOM 页范围连续且精确覆盖跨块 emoji/组合字符，窗口变化与字号重排保留逻辑锚点，深处续读不会临时展示错误前缀页。

保存失败可重试；关窗期间暂停操作并 drain 待保存进度，成功后才销毁窗口。迁移复制完整书库并保留原目录；故障注入验证复制/提交/指针切换失败恢复，损坏目标回退、缺失来源可重试，目标书库在预览后被替换时拒绝切换。

证据：[native-smoke-results.json](native-smoke-results.json)、[installed-smoke-results.json](installed-smoke-results.json)、[installer-preservation-results.json](installer-preservation-results.json)、[final-review.md](final-review.md)、[windows-acceptance.md](windows-acceptance.md)。

## 性能实测与限制

实际安装版本次首次页面可交互耗时 584 ms（已安装 WebView2、缓存可能已预热）。主进程 working set 28.8 MiB/private 6.1 MiB；包含 WebView2 的 7 个进程合计 working set 404.2 MiB/private 208.2 MiB。测试启用了子进程 CDP，working set 合计包含共享页重复统计，这是一份本机首次页面采样，不能据此声称整个阅读器仅占 28.8 MiB。

50 MiB Worker 解码/章节扫描 226 ms，本次主线程 heartbeat 10 次、预览最多 1,800 UTF16 单元；10 MiB 无换行分页可取消，DOM 测量节点有界且释放。异常超过 65,536 UTF16 单元的单个组合字素返回明确错误，不扩张成整章 DOM。单文件上限 50 MiB。未测定导入过程的可靠 Worker 峰值内存。

尚未手动实测：原生选择对话框、图形安装目录页点击、非 C 盘迁移（此机器只有 C 盘）、缺少 WebView2 时的安装、实际断网、真实满盘/ACL 拒绝。当前是本地首版安装包；同版本覆盖安装已测，未来版本升级尚未发生。没有正文关键词搜索、同步或自动更新。

## 代码与执行记录

源码、Demo、设计和计划都保留在当前项目。项目没有 Git 仓库，因此没有制造提交/分支/PR；执行 ledger 保留在 `.superpowers/sdd/2026-10-08-asterinbook-implementation/progress.md`。计划中包含上述人工条件的复合验收步骤继续标为未全部验证；完成情况以本记录和执行 ledger 为准。
