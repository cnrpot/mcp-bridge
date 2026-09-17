# mcp-bridge 1.1.1 验证报告

环境：Windows 11 build 26200，Node.js 26.3.0，Electron 44.4.1，electron-builder 26.15.3。

## 修复内容

1. 写入失败但原文件未变时，不再留下成功变更记录；仅在写入成功后执行旧快照淘汰。
2. 部分写入失败时保留原内容，并记录实际写入后的原始字节哈希，允许在无后续冲突时恢复。无法核实结果的记录只提供备份查看，不自动恢复。
3. 恢复前先检查类型和长度，再读取并核对原始字节，拒绝后来变大的文件；正确处理不完整的 UTF-8 字节。
4. 恢复确认期间发生停止连接或工作区变化时，拒绝过期操作；确认返回后再次检查工具是否忙碌。
5. 补齐一处工作目录错误提示的产品名称。

主要代码变更：`core/history.js`、`core/tools-files.js`、`core/scope.js`、`main/index.cjs`、`ui/app.js`。新增/扩展测试：`test/core.test.cjs`、`main/flow-test.cjs`、`main/restart-test.cjs`。版本、启动脚本与文档同步更新。

## 实测结果

- 先补充回归测试，在修改实现前实际复现 3 项失败：失败写入留下记录、部分写入无法恢复、恢复时无界读取。
- 修复后 `npm run check` 通过，`npm test` **28/28 通过，0 跳过**。
- 开发态真实桌面流程 **18/18 通过**：`.verification/review-dev-final/flow-result.json`。
- 打包程序真实桌面流程 **18/18 通过**：`.verification/review-packaged-final/flow-result.json`。
- 在源码目录之外完整解压最终 ZIP，真实桌面流程 **18/18 通过**：`.verification/review-portable-final/flow-result.json`。
- 实际退出并再次启动应用，开发态及最终免安装版各 **6/6 重启检查通过**：`.verification/review-restart-dev/restart-result.json`、`.verification/review-restart-portable/restart-result.json`。
- 打包 ASAR 中 30 个 main/core/ui/assets 文件逐字节匹配当前源码；许可、包名与版本一致；完整解压版与打包目录的 ASAR 哈希一致。
- 最终构建与发布验证命令均退出 0。未报告编辑器诊断错误。

18 项桌面流程覆盖原有任务启动、实时输出、stdin 输入、完成/失败/停止状态、真实进程退出、变更记录、差异、恢复、后续修改冲突、跨工作区隔离；新增真实 Windows 只读文件写入拒绝后不产生虚假历史，以及恢复确认期间停止连接后的取消保护。

6 项重启检查覆盖工作区与配置持久化、加密凭据保留、任务列表按现有设计清空、变更记录持久化、重启后差异查看及从界面恢复后的文件/状态更新。凭据只比较哈希，未写入测试报告。

测试客户端在停止/重启连接时显式关闭 HTTP 连接，避免复用已关闭的测试连接；未通过盲目重试有副作用的工具调用掩盖错误。

## 自动化边界

- 桌面测试使用真实窗口、真实文件、真实 HTTP POST JSON-RPC、真实 PowerShell 和实际应用进程重启。
- 原生授权 API 在隔离测试进程中自动应答；目录选择也使用隔离夹具，未声称人工点击系统弹窗已经验收。
- 磁盘写入失败、部分写入及快照存储失败通过单元测试故障注入验证；不声称真实磁盘发生了这些故障。Windows 只读文件拒绝写入使用真实文件属性测试。
- 未执行安装/卸载向导，未重新验证公网隧道、实际屏幕分享或真实 .NET/Godot 工程。
- 不提供断电情况下文件与快照的跨文件原子事务保证；极端存储故障时应保留备份并查看错误。
- 任务列表仍不跨重启持久化；文件历史只覆盖 apply_patch。默认配置和已有凭据的存储位置未改变，未操作日常用户配置。

## 最终产物

目录：`release/mcp-bridge-1.1.1/`。

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| mcp-bridge-1.1.1-Setup-x64.exe | 125333516 | CB6CA86D7764511F24B755F9EF4626B5BCC10AF48D74705E25E72ECEEE580F60 |
| mcp-bridge-1.1.1-x64.zip | 171279250 | B049D3137ED7F41A19547C52BF174D53B70331735C6CC8BE7B605287FEA8DA88 |

安装包和程序的产品名均为 mcp-bridge，版本均为 1.1.1，签名状态均为 NotSigned。请保留完整解压目录。启动新版前先从托盘退出旧版。
