# mcp-bridge

Windows MCP 工作空间控制台，集中管理连接、权限、运行任务和文件变更。已打包程序可直接运行。

## GitHub 源码版本

首次提交对应已验证的 1.1.1 版本。仓库只包含源码、图标、许可和测试脚本，不包含安装包、依赖目录、连接凭据、运行日志或测试数据。下列 release 路径为本地构建输出，并非仓库内置文件。验证报告引用的原始测试数据保留在本地，不公开上传。

## 交付形式

目标平台：Windows x64（Windows 10/11；未逐一验证所有系统版本）。

- `release/mcp-bridge-1.1.1/mcp-bridge-1.1.1-Setup-x64.exe`：安装向导，可选安装路径，带快捷方式和卸载入口。
- `release/mcp-bridge-1.1.1/mcp-bridge-1.1.1-x64.zip`：免安装版。完整解压后运行 `mcp-bridge.exe`。不要只复制 EXE，旁边的 DLL 和 resources 文件夹是运行时的一部分。
- `release/mcp-bridge-1.1.1/win-unpacked/`：未压缩的同一桌面程序。

安装包尚未使用开发者代码签名证书。Windows 可能显示未知发布者或信誉提示；正式公开分发前应配置你自己的代码签名证书。不要关闭系统安全软件。

## 第一次使用

1. 启动 mcp-bridge，点击右上角“选择工作目录”。选择的目录就是文件工具的访问范围。
2. 默认是“仅本地连接”，端口 8788；不会自动开启公网隧道，也不会自动启动 MCP。
3. 点击“启动连接”。同机客户端可以使用本地 URL；远程云端 AI 无法访问你电脑的 `127.0.0.1`，需要先在设置里选择 Cloudflare 临时公网隧道。
4. 复制接入提示词，交给支持 MCP Streamable HTTP / POST JSON-RPC 的客户端。
5. 按需授权：默认只开启 Read，Edit、Execute、Capture 默认关闭。确认开关和工具权限是两层控制。
6. 在“运行任务”查看输出、发送交互输入、停止进程树；在“变更记录”查看修改前后内容，并在没有后续冲突时恢复。

端口和隧道类型只允许在服务停止后更改。公网隧道连接失败时，本地 MCP 仍可用，界面会显示失败原因。Cloudflare 临时域名可能在重连时变化，其网络可达性与速率由第三方服务决定。

## 工具范围

桌面版提供 30 个工具：

- 文件：`read_files`、`read_image`、`list_directory`、`find_files`、`search_files`、`apply_patch`。
- 规范与进度：`list_skills`、`read_skill`、`set_todos`、`update_plan`、`report_progress`。
- 命令：`run_command`、`get_command_output`、`list_jobs`、`send_command_input`、`cancel_command`。
- 视觉：`screenshot`、`screenshot_window`、`run_and_capture`。使用 Electron 桌面采集。
- .NET：`dotnet_detect`、`dotnet_build`、`dotnet_test`、`dotnet_run`、`dotnet_publish`、`dotnet_restore`。
- Godot：`godot_detect`、`godot_import`、`godot_run`、`godot_export`、`godot_check`。

.NET SDK、Godot 需要自行安装，可在应用设置中填写可执行文件路径。桌面包不包含这些 SDK。


## 权限与安全边界

- 文件工具校验所选目录边界、真实路径、符号链接/junction 和硬链接。目录遍历跳过链接、依赖和生成目录。搜索在独立 Worker 中执行，受数量、大小、时间限制。
- **Execute 不是操作系统沙箱。** 命令仅以工作目录作为起始 cwd，仍拥有当前 Windows 用户的系统权限。它可以访问目录以外的系统资源。仅向可信客户端授权，并保留逐次命令确认。
- 关闭 Execute 只阻止新的执行，不会自动终止已运行命令。要终止任务，请使用任务页的停止按钮或“停止连接”。停止连接及正常退出会停止本应用启动的任务进程树和隧道。
- 截图可能包含屏幕上的敏感信息。Capture 默认为关闭，开启后默认仍逐次确认。
- 文件修改前默认显示本地确认。较长内容在确认弹窗中只显示开头，完整前后内容保存到变更记录。
- 连接 URL 的随机 token 等同访问凭据，默认隐藏显示。停止服务后可重新生成，使旧地址失效。应用仅监听 loopback，并校验 Host 和 Origin。
- UI 采用隔离 renderer、sandbox、禁用 Node 集成、限制 IPC、严格 CSP，不向远程网页暴露桌面配置接口。
- 设置保存在 `%APPDATA%\MCPGO Desktop\settings.json`。Windows 可用时，token 使用 Electron safeStorage/系统保护加密；若加密不可用，则不落盘保存 token，下次启动重新生成。
- `history/` 保存最近 50 次文件快照（所有工作区合计），可能含源代码和密钥。`jobs/` 保存有大小限制的命令日志；活动列表不记录参数内容。不要公开上传用户数据目录。
- 变更记录只覆盖 `apply_patch`，不覆盖 shell 命令造成的修改。恢复前校验当前内容，发现后续修改则拒绝覆盖。
- 不要同时让其他编辑器持有同一文件的未保存修改；本应用直接读写磁盘。

## MCP 握手示例

所有请求都使用 POST，`Content-Type: application/json`。用 UI 复制出来的完整 URL，不要把凭据提交到仓库。

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}
```

随后发送 `notifications/initialized`（无 id），再调用：

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

服务采用无状态 JSON 响应，不提供 SSE 长连接。任务取消使用 `cancel_command`，不是仅发送 JSON-RPC cancellation 通知。

## 源码结构与构建

- `main/`：Electron 主进程、窄 IPC、系统托盘、Windows 采集和 Cloudflare 进程生命周期。
- `core/`：MCP 服务、权限与路径检查、文件历史和命令/.NET/Godot 工具。
- `ui/`：中文控制台，五个页面，无 CDN 依赖。
- `test/`：协议、权限、文件和真实命令回归测试。
- `assets/`、`vendor/`：应用图标、Cloudflare 二进制与许可。

从 Git 获取源码时，`vendor/cloudflared.exe` 默认未跟踪，需要放入合法来源的 cloudflared.exe 并保留许可；当前交付目录已包含该文件。

构建机器需要 Windows x64、Node.js >=22.12 和 npm。无需全局安装 Electron：

```powershell
npm ci
npm run check
npm test
npm start
npm run dist
```

如果机器使用系统代理，可运行 `scripts/build.ps1`；它只为当前构建进程读取并使用系统代理，不修改全局代理、不关闭 TLS 校验、不自动使用你的签名证书。

`npm start` 会清理 父进程环境中的 `ELECTRON_RUN_AS_NODE`，保证启动真实桌面窗口。应用默认使用软件合成，以兼容 Windows 远程/虚拟桌面。

最终测试结果、构建产物与限制见 `VERIFICATION.md`。

## 许可

包含的 MCPGO 代码保留 MIT 许可。Cloudflare 二进制来自提供的 VSIX，未作修改，附 Apache-2.0 许可。没有把原包中的专有 ngrok 二进制纳入分发。参见 `THIRD_PARTY_NOTICES.md`。

## 1.1.0 更新

任务启动、输出和结束会通知界面刷新；任务区区分运行中、已完成、失败和已停止。停止连接后保留近期任务及输出，切换工作区或退出应用时清理任务列表。任务列表不跨重启持久化，已结束任务会按保留策略过期。

变更记录兼容 Windows 路径大小写差异；列表使用轻量元数据缓存，恢复后自动更新状态。只显示当前工作目录的记录。既有配置和连接凭据继续使用原存储目录，无需重新授权。

## 1.1.1 稳定性更新

- 写入失败且原文件未改变时，不再留下成功变更记录，也不会因此提前淘汰旧快照。
- 如果写入只完成了一部分，保留原内容并记录实际失败结果，供查看及恢复；无法核实结果时只允许查看备份，不自动恢复。
- 恢复前先检查文件类型和长度，再校验原始字节哈希，避免读取后来变大的文件或误判截断的 UTF-8 内容。
- 恢复确认期间若停止连接或改变工作区，会拒绝过期的恢复操作。
- 快照和配置跨重启保留；任务列表仍不跨重启持久化，不会把已退出的任务显示成仍在运行。

上述保护不等同于断电情况下的文件与历史数据库原子事务。磁盘故障时请保留数据目录中的备份，并查看具体错误。
