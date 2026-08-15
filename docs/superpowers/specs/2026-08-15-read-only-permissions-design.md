# Obsidian Codex CLI 本机只读权限设计

日期：2026-08-15  
状态：已批准，等待实施

## 1. 目标

调整 Obsidian Codex CLI 插件的默认权限，使 Codex 读取本机文件时尽量不再打断用户，同时继续保护写入、修改、删除和网络访问。

权限边界如下：

- 读取本机任意路径默认允许，不要求用户逐次确认。
- Vault 内写入继续由 `workspace-write` 沙箱约束。
- Vault 外写入、修改和删除必须请求用户确认。
- 网络访问必须请求用户确认；Codex 原生网页搜索继续禁用。
- 审批仍只提供“允许一次”和“拒绝”，不保存永久授权。
- 无法被 Codex CLI 明确认定为可信只读的命令继续请求确认。

## 2. 方案

插件继续使用 Codex CLI `0.147.0` 实验性 `app-server`，仅将新建和恢复线程时的审批策略从 `on-request` 改为 `untrusted`：

```text
approvalPolicy: "untrusted"
approvalsReviewer: "user"
sandbox: "workspace-write"
config.web_search: "disabled"
```

`untrusted` 由 Codex CLI 自己维护可信命令分类。CLI 认定为可信的文件浏览、读取和文本搜索命令可以直接在沙箱中运行；非可信命令仍向插件发送审批请求。

插件不解析命令字符串，也不自行自动批准收到的审批请求。这样可以避免管道、重定向、脚本和复合命令把写入操作伪装成只读操作。

## 3. 请求流程

1. 插件新建或恢复 Codex 线程，传入 `untrusted`、`workspace-write` 和禁用网页搜索的配置。
2. Codex CLI 对可信只读命令直接在沙箱内执行，不向 Obsidian 请求确认。
3. Codex CLI 对非可信命令、网络命令或需要扩大权限的操作发送 `commandExecution/requestApproval`。
4. 文件修改请求通过 `fileChange/requestApproval` 发送给插件。
5. 插件对收到的审批请求继续显示现有弹窗，只允许用户选择“允许一次”或“拒绝”。
6. 用户关闭审批弹窗等同拒绝。

## 4. 安全边界

- 不启用 `never`、`danger-full-access`、`dangerously-bypass-approvals-and-sandbox` 或等效配置。
- 不把 Vault 外目录加入可写工作区。
- 不启用 Codex 原生网页搜索。
- 不在插件中维护命令白名单或使用正则表达式判断命令是否只读。
- `untrusted` 的可信命令集合由固定版本的 Codex CLI 决定；不常见的只读命令可能仍弹出确认，这是保守兜底，不自动放行。
- 插件仍严格检查 Codex CLI 版本为 `0.147.0`，避免版本变化导致审批语义漂移。

## 5. 代码与文档范围

实施阶段只修改以下范围：

- `plugin/src/codex/codex-client.ts`：线程配置改为 `approvalPolicy: "untrusted"`。
- `plugin/tests/codex-client.test.ts`：新建和恢复线程的配置断言。
- `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md`：同步最终权限模型。
- `docs/testing/obsidian-codex-cli-acceptance.md`：同步桌面验收项。
- 根目录 `AGENTS.md`：明确本机读取无需批准，网络和写入仍需批准。

不修改审批弹窗、成果存储、Git 提交、会话目录或界面布局。

## 6. 测试与验收

自动测试必须证明：

- 新建线程使用 `approvalPolicy: "untrusted"`。
- 恢复线程重新覆盖为 `approvalPolicy: "untrusted"`。
- `approvalsReviewer` 仍为 `user`。
- 沙箱仍为 `workspace-write`。
- 网页搜索仍为 `disabled`。
- 命令审批和文件修改审批仍只返回单次允许或拒绝。

Windows 桌面手工验收必须证明：

- 使用常见可信命令读取 Vault 外本机文件时不弹出审批。
- 尝试修改 Vault 外文件时弹出审批。
- 尝试访问网络时弹出审批。
- 拒绝审批后操作不执行，会话可以继续。
- 允许一次只影响当前请求，后续同类非可信操作仍需审批。

## 7. 完成标准

- 完整类型检查、单元测试、集成测试和生产构建通过。
- 已安装插件构建包含 `untrusted` 配置。
- Git 只包含权限逻辑、测试和相关中文文档，不包含 `Codex Chats/`、Obsidian 本地配置或个人笔记。
- 用户在 Obsidian 中重载插件后完成三项桌面检查：本机只读无弹窗、Vault 外写入有弹窗、网络访问有弹窗。
