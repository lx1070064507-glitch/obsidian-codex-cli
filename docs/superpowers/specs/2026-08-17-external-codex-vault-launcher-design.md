# 外部 Codex Vault 启动器设计

日期：2026-08-17  
状态：已实施，待桌面双击验收

## 1. 目标

提供一个运行于 Obsidian 之外的 Windows 入口。用户选择本地项目目录后，入口自动把该目录初始化或更新为具备 Codex CLI 插件的独立 Obsidian Vault，并立即使用 Obsidian 打开。

插件内的“管理工作区”恢复为纯粹的 Codex 多目录配置，不再承担 Vault 初始化或插件安装职责。写入白名单功能保持不变。

## 2. 用户入口

仓库提供：

```text
打开 Codex Vault.cmd
tools/Open-CodexVault.ps1
```

同时在当前用户桌面创建“打开 Codex Vault”快捷方式。双击入口后弹出 Windows 文件夹选择器；选择目录后完成初始化并打开 Obsidian。

脚本也支持命令行：

```powershell
.\tools\Open-CodexVault.ps1 -VaultPath "D:\My_DateBase\OOC"
```

自动测试使用 `-SourcePluginPath` 指向临时插件来源，并使用 `-NoLaunch` 禁止启动 Obsidian。

## 3. 初始化规则

默认插件来源为当前仓库：

```text
.obsidian/plugins/obsidian-codex-cli
```

来源必须包含合法的 `main.js`、`manifest.json` 和 `styles.css`，且清单 ID 必须为 `obsidian-codex-cli`。

目标只创建或更新：

```text
.obsidian/plugins/obsidian-codex-cli/main.js
.obsidian/plugins/obsidian-codex-cli/manifest.json
.obsidian/plugins/obsidian-codex-cli/styles.css
.obsidian/community-plugins.json
```

目标 `data.json`、其他插件、其他启用项、Vault 笔记和项目文件保持不变。三个运行文件与来源内容一致且插件已启用时，不重复写入。

`community-plugins.json` 缺失时按空数组处理；存在时必须是字符串数组。启动器只补充 `obsidian-codex-cli`，不删除或重排其他插件 ID。

## 4. 安全与失败语义

执行写入前完成所有可预检项目：

- 目标路径存在且为目录；
- 来源运行文件存在且为普通文件；
- 来源清单可解析且插件 ID 正确；
- 目标 `.obsidian`、`plugins` 和插件目录不是符号链接或目录联接；
- 已存在的目标运行文件和启用清单是普通文件；
- 已存在的启用清单是合法字符串数组。

任一预检失败时不写入目标、不启动 Obsidian，并显示 Windows 错误窗口。运行文件通过同目录临时文件替换，避免直接写入过程中留下截断文件；临时文件在失败后清理。

初始化成功后把 Windows 路径分隔符转换为正斜杠，仅编码 URI 中的不安全字符，再使用 `obsidian://open?path=<路径>` 打开目标 Vault。URI 启动失败时保留已经完成的 Vault 初始化，并单独提示用户无法启动 Obsidian。

## 5. 插件内移除范围

移除：

- 工作区新增时的 Vault 初始化检查和确认弹窗；
- `workspaceNeedsInitialization()` 与 `initializeWorkspace()` 控制器方法；
- `PluginInstaller` 服务和对应测试；
- 只服务于初始化弹窗的样式、说明和验收项。

保留：

- “管理工作区”入口、路径校验与多目录 Codex 配置；
- “管理写入白名单”入口及权限规则；
- 工作区和白名单设置结构。

此前的“新增工作区自动初始化独立 Vault”设计与计划标记为已废弃，不删除历史文档。

## 6. 测试与验收

自动测试通过 PowerShell 子进程调用启动器并使用临时目录，覆盖：

- 新 Vault 创建插件目录、运行文件和启用清单；
- 已有 `data.json`、其他插件和其他启用项保持不变；
- 重复执行不重复启用且无需重写相同运行文件；
- 来源清单 ID 错误、目标文件类型异常和目录联接被拒绝；
- `-NoLaunch` 不启动 Obsidian。

最终验证：

- TypeScript 类型检查通过；
- 启动器测试和现有相关测试通过；
- 生产构建通过；
- 桌面快捷方式存在并指向仓库启动器；
- 使用启动器初始化 `D:\My_DateBase\OOC` 后，目标插件目录和启用清单正确，重新打开 OOC 可在第三方插件设置中看到 Codex CLI。
