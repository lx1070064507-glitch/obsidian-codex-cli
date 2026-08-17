# 新增工作区自动初始化独立 Vault 设计

日期：2026-08-17  
状态：已废弃，由外部 Codex Vault 启动器替代

## 1. 目标

调整工作区管理流程，使用户新增一个项目目录时，该目录自动具备可用的 Codex CLI Obsidian 插件，并可作为独立 Vault 使用。

同时移除当前工作区列表中的“安装到独立 Vault”图标和独立安装弹窗，改为新增工作区时的一次初始化确认，避免用户先添加工作区、再逐项安装插件。

## 2. 非目标

- 不改变 Codex 会话的多工作区权限模型。
- 不改变写入白名单规则、审批按钮语义或会话存储格式。
- 不自动修改目标 Vault 的 `data.json`。
- 不覆盖目标 Vault 中的其他插件、插件设置或用户的已有启用列表。
- 不负责自动打开或切换 Obsidian 窗口；本次只保证目标目录完成 Vault 与插件初始化。

## 3. 用户流程

1. 用户打开“管理工作区”弹窗并输入一个绝对目录路径。
2. 插件先校验路径存在且为目录，并解析真实路径、去重。
3. 插件检查目标目录的 Vault 配置和 Codex CLI 插件状态。
4. 若需要初始化或更新，显示一次简短确认，说明将创建或更新：
   - `.obsidian/`
   - `.obsidian/plugins/obsidian-codex-cli/main.js`
   - `.obsidian/plugins/obsidian-codex-cli/manifest.json`
   - `.obsidian/plugins/obsidian-codex-cli/styles.css`
   - `.obsidian/community-plugins.json` 中的插件启用项
5. 用户确认后执行初始化；取消则不改变草稿列表。
6. 初始化成功后，目录才写入当前工作区草稿列表。
7. 用户点击“保存”后，沿用现有设置校验、持久化和运行时重启流程。

已有正确安装的 Codex CLI 插件再次添加时，不重复覆盖插件设置；仅在运行文件缺失或版本需要更新时更新运行文件。

## 4. 设计方案

### 4.1 界面边界

`PathManagerModal` 在工作区模式下不再渲染下载图标，也不再打开 `InstallPluginModal`。`WorkspaceModalOptions` 删除 `installPlugin` 回调。

工作区新增逻辑负责调用 Vault 初始化服务。白名单模式保持现状，不触发 Vault 初始化。

初始化提示采用一次确认弹窗或同等的 Obsidian 原生确认交互。确认按钮执行初始化，取消按钮只关闭提示，不移除已有工作区，也不写入新路径。

### 4.2 服务边界

将现有 `PluginInstaller` 的职责表达为 Vault 初始化服务（可重命名为 `VaultProvisioner`；若保持现有类名能减少无关改动，也可仅调整调用边界）。服务接收：

- 当前插件运行文件来源目录；
- 插件 ID；
- 目标 Vault 根目录。

服务负责：

- 校验目标目录及 `.obsidian` 配置链不是符号链接或目录联接；
- 创建缺失的 `.obsidian`、`plugins` 和插件目录；
- 校验来源 `manifest.json` 的插件 ID；
- 复制三个插件运行文件；
- 读取并合并 `community-plugins.json`，确保 Codex CLI 插件 ID 只出现一次；
- 保留已有 `data.json` 和其他内容。

服务不负责：

- 修改当前插件设置；
- 修改 Codex 工作区或白名单；
- 启动或切换 Obsidian Vault；
- 解析或改写其他插件配置。

### 4.3 数据流与失败语义

工作区草稿路径的更新顺序为：

```text
输入路径
  -> 工作区路径校验
  -> Vault 初始化确认
  -> Vault 初始化服务
  -> 更新工作区草稿
  -> 保存设置
```

初始化服务失败时：

- 不把路径加入草稿列表；
- 保留目标目录中初始化前已存在的用户文件；
- 在当前弹窗显示错误通知；
- 用户可以修复目录后重新添加。

运行文件写入前继续执行目标路径校验，拒绝符号链接、目录联接、目录代替普通文件等异常目标。`community-plugins.json` 格式非法时拒绝本次初始化，不覆盖原文件。

## 5. 兼容与安全

- 旧版设置数据无需迁移，`workspaceRoots` 和 `writablePaths` 结构保持不变。
- 已存在的目标 Vault 只更新 Codex CLI 插件运行文件，不覆盖 `data.json`。
- 其他社区插件 ID 原样保留，Codex CLI ID 重复时不再次追加。
- 目录真实路径解析和现有工作区策略保持一致，避免通过目录联接绕过边界。
- 初始化是用户明确点击确认后的本地文件写入，不调用网络 API。

## 6. 测试与验收

### 自动测试

- 新目录可创建 `.obsidian`、插件目录、三个运行文件和启用列表。
- 已有 `data.json`、其他插件和其他启用项保持不变。
- 已启用 Codex CLI 时不重复写入插件 ID。
- 已有插件运行文件更新时，插件设置文件不被覆盖。
- 工作区新增初始化失败时，草稿工作区列表不增加该路径。
- 取消初始化确认时，草稿工作区列表不增加该路径。
- 来源清单 ID 不匹配、目标路径异常、符号链接或目录联接均被拒绝。
- 白名单管理流程不触发 Vault 初始化。
- 移除工作区安装图标和 `InstallPluginModal` 后，类型检查和现有 UI 测试通过。

### Obsidian 验收

1. 添加一个没有 `.obsidian` 的项目目录，确认一次后目录可作为独立 Vault 使用。
2. 添加一个已有 `.obsidian` 和其他插件的目录，确认其他设置与插件不受影响。
3. 取消初始化或制造无效目标，确认工作区列表不出现该目录。
4. 重复添加同一目录，确认不会重复启用插件或重复写入配置。
5. 确认工作区列表不再显示独立 Vault 安装图标。
6. 确认 Codex 会话仍可使用当前 Vault 与所有额外工作区。

## 7. 预期修改范围

- `plugin/src/ui/workspace-modals.ts`：移除工作区行安装入口，接入新增时初始化确认。
- `plugin/src/settings.ts`：调整弹窗回调接口。
- `plugin/src/main.ts`：提供工作区新增时调用 Vault 初始化服务的控制器方法。
- `plugin/src/services/plugin-installer.ts`：作为内部 Vault 初始化服务保留或重命名。
- `plugin/tests/plugin-installer.test.ts` 及相关 UI/控制器测试：补充新增流程和失败语义。
- `README.md`、验收文档：更新用户流程和限制说明。

不修改聊天、成果、Git 提交、Codex 权限和白名单服务。
