# 外部 Codex Vault 启动器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建可双击选择项目目录、初始化 Codex CLI 插件并打开 Obsidian 的 Windows 外部入口，同时移除插件内工作区管理的 Vault 安装职责。

**Architecture:** PowerShell 启动器独立完成路径选择、插件文件预检、幂等复制、启用列表合并和 Obsidian URI 启动；根目录 CMD 与桌面快捷方式只负责启动该脚本。插件内保留多工作区与写入白名单，只删除初始化回调、弹窗和 Node 安装服务。

**Tech Stack:** Windows PowerShell 5.1、WinForms 文件夹选择器、Obsidian URI、TypeScript 7、Vitest 4、Node.js 文件系统测试夹具。

---

### Task 1: 为外部启动器建立失败测试

**Files:**
- Create: `tools/tests/Test-Open-CodexVault.ps1`
- Create: `tools/Open-CodexVault.ps1`

- [x] **Step 1: 创建 PowerShell 测试夹具**

测试脚本在系统临时目录创建来源插件与多个目标 Vault，调用：

```powershell
& $LauncherPath -VaultPath $vault -SourcePluginPath $source -NoLaunch -NonInteractive
```

断言新 Vault 的三个运行文件与启用清单正确；已有 `data.json` 和其他插件保持不变；重复运行不改变相同运行文件的时间戳；错误 manifest、目标文件类型异常和目录联接会失败且不启动 Obsidian。

- [x] **Step 2: 创建只含参数声明的启动器骨架**

```powershell
param(
  [string]$VaultPath,
  [string]$SourcePluginPath,
  [switch]$NoLaunch,
  [switch]$NonInteractive
)

throw "启动器尚未实现"
```

- [x] **Step 3: 运行测试确认失败**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/tests/Test-Open-CodexVault.ps1
```

预期：FAIL，错误包含“启动器尚未实现”。

### Task 2: 实现幂等、安全的 Vault 初始化

**Files:**
- Modify: `tools/Open-CodexVault.ps1`
- Test: `tools/tests/Test-Open-CodexVault.ps1`

- [x] **Step 1: 实现参数与文件夹选择器**

无 `-VaultPath` 时加载 `System.Windows.Forms` 并显示 `FolderBrowserDialog`；取消选择时正常退出。传入路径时验证它存在、为目录且根目录不是重解析点，然后解析为绝对路径。

- [x] **Step 2: 实现来源和目标预检**

默认来源解析为 `$PSScriptRoot` 上级目录下的 `.obsidian/plugins/obsidian-codex-cli`。一次性读取三个来源文件，解析 manifest 并校验 ID；检查目标目录链、运行文件和 `community-plugins.json` 的文件类型与重解析点属性。

- [x] **Step 3: 实现启用列表合并和临时文件替换**

读取或创建字符串数组启用清单，只在缺失时追加 `obsidian-codex-cli`。比较来源与目标字节，相同时跳过；变化时在同目录写临时文件后替换目标。任何失败都清理临时文件并保留 `data.json` 与其他文件。

- [x] **Step 4: 实现 Obsidian URI 启动和错误窗口**

初始化成功且未传 `-NoLaunch` 时调用：

```powershell
$uriPath = [Uri]::EscapeUriString($VaultPath.Replace("\", "/"))
Start-Process ("obsidian://open?path=" + $uriPath)
```

交互模式失败时通过 MessageBox 显示错误；`-NonInteractive` 模式保留非零退出以便测试捕获。

- [x] **Step 5: 运行启动器测试确认通过**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/tests/Test-Open-CodexVault.ps1
```

预期：所有测试 PASS，未打开 Obsidian。

### Task 3: 创建双击入口和桌面快捷方式安装器

**Files:**
- Create: `打开 Codex Vault.cmd`
- Create: `tools/Install-CodexVaultShortcut.ps1`

- [x] **Step 1: 创建 CMD 包装入口**

CMD 使用仓库相对路径启动 PowerShell：

```bat
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0tools\Open-CodexVault.ps1"
```

- [x] **Step 2: 创建快捷方式安装脚本**

脚本使用 `WScript.Shell.CreateShortcut()` 在当前用户桌面创建 `打开 Codex Vault.lnk`，目标为 `powershell.exe`，参数固定引用仓库中的启动器，工作目录为仓库根目录。

- [x] **Step 3: 运行快捷方式安装脚本并验证目标**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/Install-CodexVaultShortcut.ps1
```

预期：桌面快捷方式存在，目标和参数指向当前仓库，不启动 Obsidian。

### Task 4: 移除插件内 Vault 初始化职责

**Files:**
- Modify: `plugin/src/ui/workspace-modals.ts`
- Modify: `plugin/src/settings.ts`
- Modify: `plugin/src/main.ts`
- Delete: `plugin/src/services/plugin-installer.ts`
- Delete: `plugin/tests/plugin-installer.test.ts`

- [x] **Step 1: 恢复工作区新增为纯路径校验**

删除 `WorkspaceModalOptions` 中两个初始化回调、`InitializeWorkspaceModal`、新增工作区检测和确认逻辑。`add(path)` 只把路径加入设置副本、调用 `validate()`、更新草稿并清空输入。

- [x] **Step 2: 删除设置控制器和主插件安装接口**

从 `SettingsController` 和 `modalOptions()` 删除初始化回调；从主插件删除 `PluginInstaller` 导入、两个公开方法以及来源解析辅助方法。

- [x] **Step 3: 删除无调用的安装服务和测试**

删除 `plugin-installer.ts` 与 `plugin-installer.test.ts`，并使用 `rg` 确认没有 `PluginInstaller`、`workspaceNeedsInitialization` 或 `initializeWorkspace` 引用。

- [x] **Step 4: 运行类型检查与相关单元测试**

运行：`npm run typecheck`，再运行：

```powershell
npm test -- --run tests/workspace-policy.test.ts tests/plugin-settings.test.ts
```

预期：全部通过。

### Task 5: 更新文档并初始化 OOC

**Files:**
- Modify: `README.md`
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`
- Modify: `docs/superpowers/plans/2026-08-17-workspace-vault-provisioning.md`

- [x] **Step 1: 更新用户流程和历史状态**

README 改为使用桌面入口或命令行脚本创建/打开独立 Vault；工作区管理说明恢复为纯多目录用途。旧自动初始化计划标记为已废弃，验收清单删除插件内初始化项并增加外部启动器项。

- [x] **Step 2: 使用启动器初始化 OOC但暂不启动 Obsidian**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/Open-CodexVault.ps1 -VaultPath "D:\My_DateBase\OOC" -NoLaunch -NonInteractive
```

预期：OOC 中出现三个插件运行文件，启用清单包含 `obsidian-codex-cli`。

- [x] **Step 3: 运行最终验证**

运行 PowerShell 启动器测试、`npm run typecheck`、相关单元测试和 `npm run build`。全量测试若仍受并行文件变更测试影响，单独记录该既有失败，不修改并行功能。

- [x] **Step 4: 检查最终范围**

确认旧初始化符号无引用、桌面快捷方式指向正确、OOC 插件文件可读、计划无未完成复选框。不执行 `git add`、`git commit` 或 `git push`。
