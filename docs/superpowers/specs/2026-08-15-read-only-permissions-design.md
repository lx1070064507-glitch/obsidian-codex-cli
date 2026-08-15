# Obsidian Codex CLI 本机只读权限设计

日期：2026-08-15  
状态：已三次修订并实现；Windows 桌面行为待复验

## 1. 目标

调整 Obsidian Codex CLI 插件的默认权限，使 Codex 读取本机文件时不再因 Vault 边界请求授权，同时继续保护写入、修改、删除和网络访问。

权限边界如下：

- 读取本机任意路径默认允许，不要求用户逐次确认。
- Vault 内外的写入、修改和删除都必须请求用户确认。
- 网络访问必须请求用户确认；Codex 原生网页搜索继续禁用。
- 审批仍只提供“允许一次”和“拒绝”，不保存永久授权。

## 2. 方案

插件继续使用 Codex CLI `0.147.0` 实验性 `app-server`。新建和恢复线程时使用自定义权限档案：

```json
{
  "approvalPolicy": "on-request",
  "approvalsReviewer": "user",
  "permissions": "obsidian-vault",
  "config": {
    "web_search": "disabled",
    "permissions": {
      "obsidian-vault": {
        "filesystem": { ":root": "read" },
        "network": { "enabled": false }
      }
    }
  }
}
```

权限档案只对文件系统根目录授予只读访问，不配置任何默认写入规则，并关闭命令网络访问。线程使用 `permissions` 后不再同时传入旧的 `sandbox` 字段，因为 Codex 两套权限机制不能组合。`on-request` 允许只读命令在沙箱内直接执行；写入、修改、删除和网络访问需要扩大权限时，Codex 向插件发送审批请求。

最初仅使用 `untrusted` 的方案已被 Windows 桌面实测推翻：通过 PowerShell 读取 `C:\Windows\win.ini` 时仍显示审批弹窗。随后尝试的 `sandbox_permissions` 配置也被实测推翻：CLI 帮助虽列出该示例，但 `--strict-config` 明确报告未知字段，放入 `thread/start.config` 时会被静默忽略。第三次测试证明，即使自定义档案允许 `:root` 只读，`untrusted` 仍会先按命令信誉拦截 PowerShell；同时把 `:workspace_roots` 设为 `write` 会让 Vault 内写入无需确认。最终方案因此改为全盘只读档案配合 `on-request`。

官方配置依据：[Permissions](https://learn.chatgpt.com/docs/permissions) 和 [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)。

插件不解析命令字符串，也不自行自动批准收到的审批请求。这样可以避免管道、重定向、脚本和复合命令把写入操作伪装成只读操作。

## 3. 请求流程

1. 插件新建或恢复 Codex 线程，传入 `on-request`、`obsidian-vault` 权限档案和禁用网页搜索的配置。
2. 权限档案允许读取本机任意路径，但不授予任何默认写入权限。
3. Codex CLI 对写入、修改、删除、网络命令或其他需要扩大权限的操作发送 `commandExecution/requestApproval`。
4. 文件修改请求通过 `fileChange/requestApproval` 发送给插件。
5. 插件对收到的审批请求继续显示现有弹窗，只允许用户选择“允许一次”或“拒绝”。
6. 用户关闭审批弹窗等同拒绝；拒绝后插件中止当前回合，避免 Codex 换用其他工具重复申请同一操作。

## 4. 安全边界

- 不启用 `never`、`danger-full-access`、`dangerously-bypass-approvals-and-sandbox` 或等效配置。
- 不配置默认可写目录；Vault 内外写入都必须经过审批。
- 不启用 Codex 原生网页搜索。
- 不在插件中维护命令白名单或使用正则表达式判断命令是否只读。
- 自定义权限档案只对 `:root` 授予读取能力，不授予写入能力，并关闭命令网络。
- 不同时使用旧 `sandbox` 配置与新权限档案。
- 插件仍严格检查 Codex CLI 版本为 `0.147.0`，避免版本变化导致审批语义漂移。

## 5. 代码与文档范围

实施阶段只修改以下范围：

- `plugin/src/codex/codex-client.ts`：线程配置同时使用 `on-request` 和 `obsidian-vault` 自定义权限档案。
- `plugin/tests/codex-client.test.ts`：新建和恢复线程的配置断言。
- `plugin/tests/codex-process.integration.test.ts`：真实 `codex.cmd` 线程配置兼容性测试。
- `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md`：同步最终权限模型。
- `docs/testing/obsidian-codex-cli-acceptance.md`：同步桌面验收项。
- 根目录 `AGENTS.md`：明确本机读取无需批准，网络和写入仍需批准。

不修改审批弹窗、成果存储、Git 提交、会话目录或界面布局。

## 6. 测试与验收

自动测试必须证明：

- 新建线程使用 `approvalPolicy: "on-request"`。
- 恢复线程重新覆盖为 `approvalPolicy: "on-request"`。
- 新建和恢复线程均选择 `obsidian-vault` 权限档案。
- 权限档案对 `:root` 只读，不包含任何写入规则，并关闭命令网络。
- 线程参数不再包含旧 `sandbox` 字段。
- `approvalsReviewer` 仍为 `user`。
- Vault 不再是默认可写工作区，所有写入都必须审批。
- 网页搜索仍为 `disabled`。
- 命令审批和文件修改审批仍只返回单次允许或拒绝。

Windows 桌面手工验收必须证明：

- 使用命令读取 Vault 内外本机文件时不弹出审批。
- 尝试修改 Vault 内或 Vault 外文件时弹出审批。
- 尝试访问网络时弹出审批。
- 拒绝审批后操作不执行，会话可以继续。
- 允许一次只影响当前请求，后续同类非可信操作仍需审批。

## 7. 完成标准

- 完整类型检查、单元测试、集成测试和生产构建通过。
- 已安装插件构建包含 `on-request` 和 `obsidian-vault` 权限档案配置。
- Git 只包含权限逻辑、测试和相关中文文档，不包含 `Codex Chats/`、Obsidian 本地配置或个人笔记。
- 用户在 Obsidian 中重载插件后完成桌面检查：本机只读无弹窗、Vault 内外写入有弹窗、网络访问有弹窗。
