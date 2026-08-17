# 新增工作区自动初始化独立 Vault Implementation Plan

状态：已废弃，由外部 Codex Vault 启动器替代。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在新增 Codex 工作区时自动初始化目标目录为可用的独立 Obsidian Vault，并移除工作区列表中的独立安装入口。

**Architecture:** 保留现有安全的插件文件安装服务作为内部 Vault 初始化服务；由工作区管理弹窗在路径通过校验后发起一次确认，确认成功后才把路径加入草稿设置。目标 Vault 的 `data.json`、其他插件和启用项通过现有合并逻辑保留。

**Tech Stack:** TypeScript 7、Obsidian API 1.13.1、Vitest 4、Node.js `fs/promises`、Windows 文件系统。

---

### Task 1: 调整 Vault 初始化服务边界并补齐服务测试

**Files:**
- Modify: `plugin/src/services/plugin-installer.ts`
- Test: `plugin/tests/plugin-installer.test.ts`

- [x] **Step 1: 为重复初始化和保留配置补充失败/成功测试**

在现有 `PluginInstaller` 测试中增加：已有插件运行文件可更新但 `data.json` 不变；已有 `.obsidian` 和其他启用插件保持不变；重复初始化后启用列表不重复。保留现有目录联接、来源清单和异常目标覆盖测试。

- [x] **Step 2: 运行服务测试确认基线**

运行：`npm test -- --run tests/plugin-installer.test.ts`

预期：现有测试通过；新增测试在服务行为尚未覆盖时暴露缺口。

- [x] **Step 3: 将服务公开职责改名为 Vault 初始化语义（如不需要则保持类名）**

优先采用最小改动：保留 `PluginInstaller` 类名和已有文件安全逻辑，只在服务注释/调用命名上表达“初始化目标 Vault”，不新增第二套复制逻辑。确保初始化顺序仍为读取来源、校验 manifest、校验目标、合并启用列表、写入运行文件与启用列表。

- [x] **Step 4: 运行服务测试确认通过**

运行：`npm test -- --run tests/plugin-installer.test.ts`

预期：全部服务测试 PASS。

### Task 2: 将工作区新增流程接入一次性初始化确认

**Files:**
- Modify: `plugin/src/ui/workspace-modals.ts`
- Modify: `plugin/src/settings.ts`
- Modify: `plugin/src/main.ts`

- [x] **Step 1: 删除工作区行安装入口的 UI 代码**

从 `WorkspaceModalOptions` 删除 `installPlugin` 回调；从 `renderList()` 删除 `setIcon`、下载按钮和 `InstallPluginModal`；删除 `InstallPluginModal` 类。保留工作区和白名单的路径增删、校验、保存行为。

- [x] **Step 2: 增加工作区初始化回调**

为工作区弹窗选项增加 `initializeWorkspace(vaultRoot: string): Promise<void>`。在 `add(path)` 中先构造包含新路径的设置并调用现有 `validate`，校验通过后调用初始化确认流程；只有初始化 Promise 成功，才更新 `draft` 并渲染列表。白名单模式不调用该回调。

- [x] **Step 3: 实现一次性确认弹窗**

新增轻量确认 Modal，显示目标路径和将创建/更新的 `.obsidian` 插件运行文件；取消直接关闭并拒绝 Promise；确认按钮调用 `initializeWorkspace`，成功 resolve，失败显示现有 `showError` 并允许重试。不要在确认取消或初始化失败时更新草稿列表。

- [x] **Step 4: 在设置控制器中传入初始化方法**

从 `SettingsController` 删除 `installPluginToVault`，改为 `initializeWorkspace(vaultRoot: string): Promise<void>`；`modalOptions()` 将该回调传给工作区弹窗。设置页仍只显示“管理工作区”和“管理写入白名单”两个入口，不增加第三个安装按钮。

- [x] **Step 5: 调整主插件控制器命名和调用**

将 `installPluginToVault` 改为 `initializeWorkspace`，保留现有工作区路径解析、来源目录解析和 `PluginInstaller.install()` 的安全检查。该方法只在工作区新增确认后调用，不改变 CodexClient 的工作区配置。

- [x] **Step 6: 删除不再使用的样式**

从 `plugin/styles.css` 删除 `.codex-path-icon-button` 和 `.codex-install-files`；保留路径列表、操作按钮和权限警告样式。

### Task 3: 补充新增流程的可测试控制器边界

**Files:**
- Modify: `plugin/src/ui/workspace-modals.ts`
- Test: `plugin/tests/plugin-installer.test.ts` 或新建 `plugin/tests/workspace-provisioning.test.ts`

- [x] **Step 1: 抽出可测试的新增流程函数或保持服务边界测试**

若 Obsidian Modal 难以在 Vitest 中构造，则不引入测试专用 DOM 抽象；通过服务测试覆盖初始化结果，并在类型检查中确保回调接口已删除旧安装入口。若可以使用当前测试环境构造 Modal，则覆盖初始化失败不更新草稿、初始化成功后更新草稿、取消不更新草稿三条路径。

- [x] **Step 2: 运行类型检查和全量单元测试**

运行：`npm run typecheck`，再运行：`npm test`。

预期：无 TypeScript 错误，全部单元测试 PASS。

### Task 4: 更新文档并完成构建验证

**Files:**
- Modify: `README.md`
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`

- [x] **Step 1: 更新 README 使用说明**

删除“点击工作区右侧安装图标”和独立安装器说明，改为：添加工作区时确认初始化；已存在 Vault 的 `data.json` 和其他插件设置会保留；初始化失败时路径不会加入工作区。

- [x] **Step 2: 更新验收清单**

增加新目录初始化、已有 Vault 配置保留、取消/失败不加入列表、重复初始化不重复启用，以及工作区列表不再显示安装图标的验收项。

- [x] **Step 3: 运行最终验证**

运行：`npm run verify`。

预期：类型检查、Vitest 单元测试和生产构建全部通过；构建产物仍安装到当前 Vault 的插件目录。

- [x] **Step 4: 检查变更范围**

运行：`git status --short` 和 `rg -n "InstallPluginModal|installPluginToVault|codex-path-icon-button|codex-install-files" plugin README.md docs/testing`。

预期：不再有旧 UI/控制器入口引用；保留服务测试中的初始化类名引用（如果采用最小改动）。不执行 `git add`、`git commit` 或 `git push`。
