# Windows 验收记录

当前 Windows 10.0.26200，x64；2026-10-09。最终构建与性能见 `release-results.md`。

| 项目 | 证据与结果 |
| --- | --- |
| 含中文空格的自定义安装位置 | NSIS 实际安装到 `C:\code\ts\AsterinBook\.superpowers\installer-verification\程序 安装`；exit 0，注册表 InstallLocation 与文件路径一致 |
| 安装目录选择页 | 实际生成 `src-tauri/target/release/nsis/x64/installer.nsi` 包含 `MUI_PAGE_DIRECTORY`；图形安装页手动点选未执行 |
| 安装后的生产程序 | `installed-smoke-results.json`；实际 EXE 显示首次启动页，第二个进程 exit 0，原窗口保持单实例 |
| 正常关闭首次启动窗口 | 最初回归暴露未建库时 flushWrites 导致无法关闭；修复后由 WM_CLOSE 触发真实 onCloseRequested，退出通过 |
| 两本真实小说和独立记录 | Rust library 集成测试 + `native-smoke-results.json`；真实 SQLite、正文文件、进度、书签、字体设置 |
| 原生二进制导入链路 | WebView2 中 ArrayBuffer → 发布 Worker → 分块 raw IPC → SQLite commit；UTF-8 小说识别两章，GBK 样本中文精确恢复 |
| 删除原始 TXT 后阅读 | 原生脚本删除测试源 TXT 后 read_text 返回正确中文；复制文件仍保留 |
| 整窗、分页、锚点、章节边界 | Edge 浏览器测试与 WebView2 截图；正文真实 DOM 测量、连续页范围；跨块 emoji 与组合字符完整覆盖 |
| 退出和重启 | 独立原生验证程序使用同一生产 builder/Core/命令；关窗保存被 Core 延迟时禁止翻页，重启后迁移路径、四本书、书签、偏好及逻辑位置一致 |
| 迁移失败恢复 | 复制后、提交目录前、路径切换后故障注入；重开仍可读两本书、进度和书签；损坏目标数据库回退来源 |
| 同路径覆盖安装 | 实际重复安装 exit 0；保留配置目录中的测试标记 |
| 卸载与重装 | uninstall /S exit 0，程序移除；已迁移的 reader.db SHA256 不变，应用配置目录标记保留；重新安装 exit 0 |
| 长文本 | 50 MiB 实际 Worker 解码与章节扫描，主线程 heartbeat 持续；10 MiB 无换行分页可取消，测量节点 ≤64 Ki 单元并释放 |
| 断网阅读 | 生产 UI 没有远程字体、远程资源或联网阅读服务；未切断当前电脑网络做实测 |

原生验证程序只把测试文件选择/目标目录准备交给独立 harness，生产 IPC、Worker、存储和窗口关闭处理均复用发布实现。它不包含在安装包中，不能把这项测试称作原生文件对话框的手动验收。

尚未手动验证：原生文件/目录选择对话框交互、缺失 WebView2 时的联网安装、断网环境。当前机器只提供 C 盘文件系统，未进行非 C 盘实际迁移。没有人为填满磁盘或修改当前用户 ACL 来测试磁盘满/只读目录；这些错误路径有边界检查，故障注入主要覆盖复制、提交和指针切换。

安装器工具下载超时后，从同一 Tauri 官方发行地址下载 NSIS 3.11 和 nsis_tauri_utils 0.5.3，校验与官方源码一致的 SHA1 后放入标准工具缓存。未修改用户代理设置。[官方 NSIS 构建源码](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)
