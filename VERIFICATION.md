# mcp-bridge 1.2.0 验证报告

环境：Windows 11 build 26200、Node.js 26.3.0、Electron 44.4.1、electron-builder 26.15.3。本文对应本地 1.2.0 构建，不代表已公开发布。

## 已通过

| 验证 | 结果 | 本地证据（不随源码公开） |
|---|---|---|
| JavaScript 语法及单元/集成回归 | 49/49，0 失败、0 跳过 | cmd-52 |
| 开发态任务/变更记录真实桌面流程 | 18/18 | .verification/update-flow-dev/flow-result.json |
| 开发态模式/更新桌面流程 | 13/13 | .verification/features-dev-final/feature-result.json |
| 开发态真实进程重启 | 7/7 | .verification/update-restart-dev/restart-result.json |
| 打包程序任务/变更记录流程 | 18/18 | .verification/update-packaged-final/flow-result.json |
| 打包程序模式/更新流程 | 13/13 | .verification/features-packaged-final/feature-result.json |
| 源码目录外完整解压 ZIP 的任务/变更流程 | 18/18 | .verification/update-portable-final/flow-result.json |
| 最终 ZIP 的模式/更新流程 | 13/13 | .verification/features-portable-final/feature-result.json |
| 最终 ZIP 的真实进程重启 | 7/7 | .verification/update-restart-portable-final/restart-result.json |
| 构建 | 安装包及 ZIP 构建退出 0，未发布 | cmd-54 |
| ASAR 一致性 | 33 个 main/core/ui/assets 文件与源码逐字节一致；版本、包名、许可一致 | .verification/update-artifacts.json |

未报告编辑器诊断错误。桌面截图只使用 capturePage 捕获测试应用自身窗口，不采集用户桌面。

## 覆盖范围

- 真实 PowerShell 任务启动、输出、输入、完成、失败、停止及进程退出；停止连接后任务状态不错误回到运行中。
- 真实文件修改、历史列表即时刷新、差异、恢复、冲突及跨工作区隔离；只读文件写入失败不留下成功记录。
- 手动审批默认值、拒绝后无写入；自动审批的常规操作与风险提示；关闭的能力仍不可用。
- 完全访问本机确认/拒绝、工作目录外夹具的实际读写与 cwd、退出恢复权限、重新阻止越界；非法路径仍拒绝。仅使用操作工作区内的隔离兄弟目录，不访问用户私人文件。
- 已确认的完全访问选择跨重启保留，退出该模式后恢复原 Capture=false；原配置、加密凭据和文件历史保留，任务列表按设计不跨重启保留。
- 远程截图参数不能伪造内部 preConfirmed；未进行实际桌面截图测试。
- 更新元数据/版本/域名校验、仅检查不自动下载、全局新版入口、真实 loopback HTTP 下载夹具、进度、取消、长度及 SHA256、失败清理、安装前再校验、篡改拒绝、运行任务阻止安装。打包程序拒绝安装确认不会退出或启动夹具。

## 真实 GitHub 网络验证与限制

`.verification/update-live/live-result.json`：模拟当前版本 1.1.0，成功从真实 GitHub 最新稳定版 API 发现公开 1.1.1，解析大小 125420875 字节及 SHA256 `b9cca4f19d1029f494e762593d0dd2c03a6d911c84ced0cc1e4391fbadfbf2d1`。

**真实安装包完整下载未通过**：两次尝试分别出现 `read ECONNRESET` 和 `connect ETIMEDOUT 185.199.109.133:443`。未关闭 TLS 或系统安全检查，也未用本地文件冒充真实下载成功。下载/校验逻辑由隔离 HTTP 夹具和故障测试验证，不能据此声称真实网络端到端更新验收完成。客户端会显示错误，可重试或打开发布页手动下载。

## 自动化边界

- 原生授权弹窗由隔离测试进程自动应答，不代表人工点击系统弹窗验收。
- 虚构 v9.0.0 和 MZ 字节仅用于测试；从未执行测试安装包。
- 未运行安装/卸载向导；未验证实际安装替换后重启。安装版/免安装版的程序本体和独立重启已测试。
- 自动检查的 10 秒/6 小时调度未进行 6 小时实等待验收；隔离桌面测试关闭真实自动检查，显式触发检查流程。
- 未重新验证公网隧道、实际屏幕分享、真实 .NET/Godot 工程或所有 Windows 10/11 版本。
- Execute 不是操作系统沙箱；自动审批风险规则并不完备，完全访问不自动提权。
- 文件历史只覆盖 apply_patch，不提供断电情况下的跨文件原子事务保证。
- 既有用户配置/凭据目录未改动。测试均使用隔离 profile。

## Windows x64 产物

目录：`release/mcp-bridge-1.2.0/`。

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| mcp-bridge-1.2.0-Setup-x64.exe | 125427616 | e188217e7bc40b8d1fb71e174dbd34421807d01845d7ec3972491073cd59b0b9 |
| mcp-bridge-1.2.0-x64.zip | 171371534 | 1561d8a38d2939d64974f923f061ab354991705ed13bfcf4fd0bac727ece7322 |

程序及安装包 ProductName 均为 mcp-bridge，ProductVersion 分别为 1.2.0.0 和 1.2.0；签名状态均为 NotSigned。ZIP 需完整解压。1.1.1 首次升级需要手动下载安装包或 ZIP。本次没有推送源码或发布 1.2.0 Release，公开最新版仍是 1.1.1。
