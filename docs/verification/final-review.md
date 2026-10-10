# 最终代码审查与修复记录

2026-10-09。独立审查代理：`/root/final_review`（gpt-6-astra，fresh context，只读）。审查者检查了实现、设计、计划、执行决定、测试脚本与结果，没有替代执行测试。初始结论 With fixes：无 Critical，7 Important，1 Minor。

| 发现 | 定级与处理 | 失败证据与修复验证 |
| --- | --- | --- |
| 设置失败后 flush 等待同一个拒绝 Promise | Important；保留最新未保存设置，flush 重试，显示持久重试入口，合并尚未执行的设置写入 | 浏览器设置失败后返回书架测试 RED→GREEN；原 toast 消失后重试入口测试 RED→GREEN |
| 第二块失败后 Worker 从零重传；原生部分写入重复 | Important；保留未确认块，原生回退至确认长度并支持同一块幂等重传 | >2 MiB 第二块失败浏览器 RED→GREEN；Rust 部分 append 故障从 9 字节残留 RED→0 字节及精确正文 GREEN |
| 迁移恢复异常困在启动加载页 | Important；Core 与前端均提供 unavailable/retry；保留迁移记录，明确另选书库时归档记录 | Rust 缺失迁移目录 RED→恢复目录后 GREEN；前端异常启动无重试 RED→重试成功 GREEN |
| 单个超长组合字素绕过分页缓冲上限 | Important；65,536 UTF16 单元上限，清晰错误与释放 DOM | 100,001 单元读取 RED→≤65,536 GREEN；正常跨块 Unicode/取消测试仍通过 |
| 保存中关窗仍接受操作，writer 未 drain | Important；关窗 single-flight、inert 遮罩、阅读事件暂停，writer 递归 drain | Unit 新进度只保存 [10] RED→[10,20] GREEN；真实 WebView2/Core 延迟关窗时锚点 239→351 RED→239 保持 GREEN，重启保存一致 |
| 长章深处续读先暴露前缀页面 | Important；到达锚点所在页才发布，之前保持加载状态 | 延迟读取的 90,000 锚点观察到错误前缀 RED→无错误前缀 GREEN |
| 迁移预览的已有书库被清空/替换仍可成功 | Important；保留目标 libraryId，使用不可初始化的已有库打开路径 | Rust 目标清空/替换时错误成功 RED→拒绝且来源 pointer 不变 GREEN |
| 排版面板按钮方向键翻页 | 从 Minor 提升 Important：违背明确的面板交互要求；过滤 `.reading-panel` 来源事件 | 主题按钮方向键使锚点 7→286 RED→锚点 7 GREEN |

一次修复 pass，未再次派遣审查代理。最终全套结果、安装包与原生记录见 [release-results.md](release-results.md)。没有延期 Minor。

独立审查者未判定的手动项目仍保留为未验证：原生选择对话框、图形 NSIS 安装目录页、非 C 盘迁移、缺少 WebView2 的联网安装、实际断网、真实磁盘满/ACL 拒绝。详见 [windows-acceptance.md](windows-acceptance.md)。
