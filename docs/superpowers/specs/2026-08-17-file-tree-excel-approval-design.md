# 文件树白名单、Excel 显示与文件变更审批概述设计

日期：2026-08-17

## 目标

解决 Obsidian Codex CLI 的三个界面问题：

1. 当前 Vault 文件树中的白名单文件和目录使用绿色字色显示，白名单目录的所有子项继承该颜色。
2. 在 Obsidian 文件树中显示 Excel 及常见表格文件；双击后调用 Windows 默认关联程序（Excel/WPS）打开。
3. Codex 请求文件变更审批时，显示文件路径、操作类型、增删行数，并提供可展开的完整 diff。

不改变现有权限边界、审批按钮语义、会话记录格式或成果存储格式。

## 现状与协议依据

- 白名单已经在 `WorkspacePolicy` 和 Codex `obsidian-vault` 权限档案中生效，但尚未同步到 Obsidian 文件树样式。
- Obsidian 通过 `Plugin.registerExtensions` 将扩展名绑定到文件视图；当前插件没有注册 Excel 扩展名。
- Codex CLI `0.147.0` 的 `item/fileChange/requestApproval` 参数不包含 `changes`。文件变更通过 `item/fileChange/patchUpdated` 通知传递，通知包含 `itemId` 和 `changes` 数组。每项变更包含路径、变更类型和 diff。

## 组件设计

### Excel 外部打开视图

新增轻量 `FileView`，注册以下扩展名：`xlsx`、`xls`、`xlsm`、`xlsb`、`xltx`、`xltm`、`csv`、`tsv`。

文件会被 Obsidian 索引并出现在文件树中。文件视图加载时调用 Windows 默认关联程序打开文件；页签内容显示简短状态，避免出现空白页。打开失败时显示 Obsidian 错误通知，不修改工作簿。

### 白名单文件树标记

新增文件树标记器，读取插件当前解析后的 `writablePaths`。只有当前 Vault 内的白名单路径可以映射到 Obsidian 文件树；额外工作区中的路径不在当前 Vault 文件树中，不显示虚假的颜色标记。

标记规则：

- 单独加入白名单的文件为绿色。
- 白名单目录为绿色。
- 白名单目录下的所有子文件和子目录为绿色。
- 路径边界按 Windows 路径规则判断，避免 `Project` 错误匹配 `Project2`。
- 使用 Obsidian 主题成功色变量，适配浅色和深色主题。

标记器监听布局或文件树 DOM 变化，在目录展开、文件刷新和设置保存后重新扫描。单个节点处理失败只跳过该节点，不影响会话运行。

### 文件变更审批概述

`CodexClient` 增加按 `itemId` 保存的文件变更缓存和待审批项更新通道。收到 `item/fileChange/patchUpdated` 时缓存当前回合的变更；收到 `item/fileChange/requestApproval` 时取出对应项，生成摘要并放入 `ApprovalPrompt`。如果审批弹窗已经打开，后到的同一 `itemId` 变更会通过更新通道刷新该弹窗；审批结束或回合结束后清理缓存和订阅。

摘要包含：

- 完整文件路径。
- 新增、修改、删除或移动。
- 新增行数和删除行数；统计 unified diff 中排除 `+++`、`---` 文件头后的 `+`、`-` 行。
- 可展开查看的完整 diff。

移动操作显示原路径和 `move_path` 目标路径；缺少目标路径时按普通修改显示。

默认界面显示摘要，完整 diff 放入可滚动的折叠区域。审批仍只返回 `allowOnce` 或 `deny`。如果审批请求先于 diff 通知到达，界面先显示“正在获取变更概述”；若协议最终没有提供 diff，则显示“暂无详细差异”，不自动授权。

## 数据流

```text
插件设置保存
    -> 解析 writablePaths
    -> 文件树标记器刷新

Codex item/fileChange/patchUpdated
    -> 按 itemId 缓存变更
    -> item/fileChange/requestApproval
    -> 生成 ApprovalPrompt 摘要和 diff
    -> ApprovalModal 展示
    -> 同 itemId 的后续 patchUpdated 刷新已打开弹窗
    -> 用户允许一次/拒绝
```

## 测试与验收

### 自动化测试

- 白名单目录继承、单文件匹配和路径边界。
- Excel 扩展名注册清单。
- 文件变更通知缓存及通知先后顺序。
- 新增、修改、删除、移动的摘要与行数。
- 缺少 diff、空变更和异常数据的展示兜底。

### 构建验证

在 `plugin/` 目录执行：

```powershell
npm run typecheck
npm test
npm run build
```

### Obsidian 手工验收

- 白名单文件、目录及目录子项在文件树中显示绿色；移除白名单后恢复默认颜色。
- `xlsx`、`xls`、`xlsm`、`xlsb`、`csv`、`tsv` 等文件出现在文件树中。
- 双击表格文件可以使用系统默认 Excel/WPS 打开。
- Codex 创建或修改文件时，审批弹窗显示路径、操作、行数，且可以展开查看 diff。
- 选择拒绝仍中断当前回合；选择允许一次仍保持原有单次授权语义。

## 范围外事项

- 不实现自定义表格查看器或在 Obsidian 内编辑二进制工作簿。
- 不接管或重写 Obsidian 整个文件树。
- 不改变白名单权限模型，不增加永久授权或按会话授权。
- 不对当前 Vault 文件树之外的额外工作区绘制颜色。
