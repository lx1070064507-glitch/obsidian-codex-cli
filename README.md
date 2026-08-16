# Obsidian Codex CLI

Obsidian Codex CLI 是一个面向 Windows 桌面版 Obsidian 的本地插件，用于在 Vault 中直接运行 Codex CLI 会话，并将讨论过程与可复用成果分开管理。

插件把完整对话保存在本地，将需要长期保留或进入版本控制的内容另存为成果笔记。提交时，用户可以明确选择要纳入 Git 的成果，避免把私人对话、个人笔记或整个 Vault 一并提交。

## 适用场景

- 在 Obsidian 中与 Codex 协作，不需要频繁切换终端和笔记窗口。
- 让 Codex 读取本机项目、文档和资料，同时保留明确的写入审批边界。
- 将讨论中的方案、总结或文档保存为独立成果。
- 从多个成果中选择需要提交的文件，预览差异后创建 Git commit。
- 让 Codex 会话与对应笔记关联，重新打开笔记时继续原有上下文。

## 核心功能

### Obsidian 内置会话

- 在 Obsidian 右侧栏直接使用 Codex CLI。
- 支持通过发送按钮或 `Ctrl+Enter` 提交消息。
- 每个会话对应一篇本地 Markdown 笔记。
- 打开已有会话笔记时，自动恢复对应的 Codex 上下文。

### 对话与成果分离

- 完整对话保存在 `Codex Chats/`。
- 可复用内容保存到 `Codex Results/`，便于独立查看和编辑。
- `Codex Chats/` 默认不纳入版本控制，避免把私人讨论提交到仓库。
- 成果笔记可以按需选择并单独提交。

### Git 成果提交

- 从 `Codex Results/` 中选择要提交的成果。
- 提交前预览文件差异。
- 创建仅包含所选成果的 Git commit。
- 不自动执行 `git push`。

### 权限审批

- 本机文件读取使用全盘只读权限档案。
- 写入、修改、删除和网络访问需要在 Obsidian 中逐次审批。
- 每次审批仅提供“允许一次”和“拒绝”，不保存永久授权。
- 用户拒绝后中止当前回合，不通过其他方式重复申请。

### 环境检查

插件会检查以下运行条件：

- `codex.cmd` 是否可用。
- Codex CLI 是否已经完成登录。
- Codex CLI 版本是否匹配。
- 当前 Vault 是否为 Git 仓库。
- Git 命令是否可用。

## 工作流程

```text
在 Obsidian 中发起会话
        ↓
对话保存到 Codex Chats/
        ↓
将可复用内容保存为成果
        ↓
成果写入 Codex Results/
        ↓
选择成果并预览差异
        ↓
创建仅包含所选成果的 Git commit
```

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| 操作系统 | Windows |
| Obsidian | 桌面版 `1.8.0` 或更高版本 |
| Codex CLI | `0.147.0`，并已完成登录 |
| Git | 已安装且命令可用 |
| Node.js 与 npm | 仅从源码构建时需要 |

当前版本依赖 Codex CLI 的实验性 `app-server` 协议，因此严格匹配 Codex CLI `0.147.0`。其他版本可能存在协议兼容问题。

## 从源码安装

1. 克隆本仓库。
2. 在 Obsidian 中将仓库根目录作为 Vault 打开。
3. 进入 `plugin/` 目录并安装依赖：

   ```powershell
   npm install
   ```

4. 构建插件：

   ```powershell
   npm run build
   ```

   构建会将 `main.js`、`manifest.json` 和 `styles.css` 安装到当前 Vault 的 `.obsidian/plugins/obsidian-codex-cli/`。

5. 打开 Obsidian 设置，在“第三方插件”中启用“Codex CLI”。
6. 在插件设置中确认 `codex.cmd` 与 Git 的路径。
7. 打开右侧栏，创建会话并开始使用。

## 使用说明

### 创建和继续会话

1. 打开一篇 Markdown 笔记。
2. 在 Codex CLI 侧栏中点击“新会话”。
3. 输入消息，通过发送按钮或 `Ctrl+Enter` 提交。
4. 之后打开对应的 `Codex Chats/*.md` 笔记，即可切换回关联的本地会话。

### 保存成果

1. 在需要保留的回复下点击“保存为成果”。
2. 编辑成果标题和内容。
3. 保存后，成果会写入 `Codex Results/`。

### 提交成果

1. 打开提交界面。
2. 选择需要纳入提交的成果文件。
3. 检查差异预览和提交信息。
4. 创建只包含所选成果的 Git commit。

## 权限与隐私

插件将读取权限与可能改变系统状态的操作分开处理：

- 只读命令在沙箱内执行，可读取本机任意路径，用于分析项目和资料。
- Vault 内外的写入、修改、删除及网络访问都会触发 Obsidian 审批弹窗。
- 插件不保存永久授权，不启用 Codex 网页搜索，也不会自动执行 `git push`。
- 本地会话不会自动同步到 ChatGPT 客户端。
- `Codex Chats/`、`.obsidian/`、个人笔记、依赖目录和构建产物默认不进入 Git。

需要进入版本控制的内容，应先保存到 `Codex Results/`，再通过插件的提交界面明确选择。

## 项目结构

```text
.
├── plugin/                 # Obsidian 插件源码、测试和构建配置
│   ├── src/                # TypeScript 源码
│   ├── tests/              # Vitest 测试
│   ├── manifest.json       # Obsidian 插件清单
│   ├── package.json        # npm 脚本与开发依赖
│   └── styles.css          # 插件样式
├── docs/                   # 设计方案、实施计划和验收记录
├── Codex Chats/            # 本地会话笔记，不纳入版本控制
├── Codex Results/          # 可独立查看和选择性提交的成果笔记
└── README.md               # 项目说明
```

## 开发与验证

在 `plugin/` 目录安装依赖后，可以使用以下命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 以开发模式构建插件 |
| `npm run typecheck` | 运行 TypeScript 类型检查 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:integration` | 运行 Codex 进程与 Git 集成测试 |
| `npm run build` | 创建生产构建并安装到当前 Vault |
| `npm run verify` | 依次执行类型检查、测试和生产构建 |

完整验证命令：

```powershell
cd plugin
npm install
npm run verify
```

详细设计、实施计划和验收记录位于 `docs/`。

## 当前限制

- 仅支持 Windows 桌面版 Obsidian。
- 当前版本为 `0.1.0`，仍处于开发验收阶段，尚未声明为稳定版本。
- Codex CLI 必须为 `0.147.0`，并提前完成登录。
- 依赖 Codex CLI 实验性 `app-server` 协议，后续 CLI 升级可能需要同步适配。
- 插件只创建本地 Git commit，不负责推送到远程仓库。
