# Obsidian Codex CLI

面向 Windows 桌面版 Obsidian 的本地 Codex CLI 插件。它把讨论保存在本地 Vault，将可复用结论单独保存为成果笔记，并只提交用户明确选择的成果。

## 功能

- 在 Obsidian 右侧栏直接与 Codex CLI 对话。
- 完整对话保存在 `Codex Chats/`，切换会话笔记时自动恢复对应上下文。
- 对话成果保存到 `Codex Results/`，可独立查看和选择性提交。
- `Codex Chats/`、`.obsidian/`、个人笔记、依赖和构建产物默认不进入 Git。
- 本机任意路径只读访问默认允许。
- Vault 内外的写入、修改、删除和网络访问均由插件弹窗逐次审批。
- 审批仅提供“允许一次”和“拒绝”；拒绝后中止当前回合，避免重复申请。
- 明确检查 `codex.cmd`、Codex 登录状态、固定 CLI 版本和 Git 仓库状态。

## 环境要求

- Windows 桌面版 Obsidian
- Codex CLI `0.147.0`，并已完成登录
- Git
- Node.js 与 npm（仅从源码构建时需要）

当前版本依赖 Codex CLI 的实验性 `app-server` 协议，因此严格匹配 CLI `0.147.0`。

## 从源码安装

1. 克隆仓库，并在 Obsidian 中把仓库根目录作为 Vault 打开。
2. 在 `plugin/` 目录运行 `npm install`。
3. 运行 `npm run build`。构建会把 `main.js`、`manifest.json` 和 `styles.css` 安装到当前 Vault 的 `.obsidian/plugins/obsidian-codex-cli/`。
4. 在 Obsidian 的“第三方插件”中启用“Codex CLI”。
5. 在插件设置中确认 `codex.cmd` 和 Git 路径，然后打开右侧栏开始对话。

## 使用方式

- 打开一个 Markdown 笔记，点击“新会话”。
- 使用纸飞机按钮或 `Ctrl+Enter` 发送消息。
- 打开任意 `Codex Chats/*.md` 笔记，可自动切换到对应本地会话。
- 在回复下点击“保存为成果”，编辑后保存到 `Codex Results/`。
- 使用提交按钮选择成果、预览差异并创建只包含所选成果的 Git commit。

## 权限与隐私

插件使用全盘只读权限档案。只读命令在沙箱内执行；任何写入、修改、删除或网络访问都必须通过 Obsidian 弹窗单次确认。插件不保存永久授权，不启用 Codex 网页搜索，也不会自动执行 `git push`。

本地对话不会自动同步到 ChatGPT 客户端。`Codex Chats/` 始终由 `.gitignore` 排除；需要进入版本控制的内容应先保存为 `Codex Results/` 成果。

## 开发与验证

在 `plugin/` 目录运行：

```powershell
npm install
npm run verify
```

`verify` 会依次执行 TypeScript 类型检查、Vitest 测试和生产构建。详细设计与验收记录位于 `docs/`。
