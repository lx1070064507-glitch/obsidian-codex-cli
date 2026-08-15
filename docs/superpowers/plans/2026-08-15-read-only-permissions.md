# Local Read-Only Permissions Implementation Plan

> 历史计划：仅使用 `untrusted`、无效的 `sandbox_permissions`，以及 `untrusted + :root 只读 + Vault 可写` 均已在 Windows 桌面验收中失败。最终权限模型以 `docs/superpowers/specs/2026-08-15-read-only-permissions-design.md` 的第三次修订为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Obsidian Codex CLI 的线程审批策略改为 Codex CLI 原生 `untrusted`，让可信的本机只读命令默认执行，同时继续对网络、写入、修改、删除和无法确认安全性的命令请求人工批准。

**Architecture:** 保留现有 `workspace-write` 沙箱、`approvalsReviewer: "user"`、禁用网页搜索和 Obsidian 审批弹窗，仅修改 `CodexClient.threadConfiguration()` 的审批策略。由 Codex CLI `0.147.0` 判断可信只读命令，插件不解析命令文本、不维护白名单，也不自动批准任何已送达插件的请求。

**Tech Stack:** Windows 桌面版 Obsidian、TypeScript 7.0.2、Vitest 4.1.10、esbuild 0.28.2、Codex CLI 0.147.0、Git。

---

## 文件结构

- `plugin/tests/codex-client.test.ts`：锁定新建与恢复线程的完整权限配置，防止安全边界回退。
- `plugin/src/codex/codex-client.ts`：生成传给 Codex `app-server` 的线程配置；本次唯一生产逻辑改动位于此处。
- `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md`：把总体设计中的权限模型同步为 `untrusted`。
- `docs/testing/obsidian-codex-cli-acceptance.md`：记录自动验证结果及 Windows 桌面手工验收项。
- `AGENTS.md`：约束由插件启动的 Codex，明确本机读取、写入与网络的审批边界。
- `.obsidian/plugins/obsidian-codex-cli/main.js`：构建后安装的本地插件产物，仅用于验证，继续由 Git 忽略。

### Task 1: 用回归测试锁定 `untrusted` 线程配置

**Files:**
- Modify: `plugin/tests/codex-client.test.ts`
- Test: `plugin/tests/codex-client.test.ts`

- [ ] **Step 1: 修改新建线程测试的审批策略断言**

将“以 Vault 沙箱启动线程并禁用网页搜索”中的参数断言改为：

```ts
expect(rpc.requests).toContainEqual(expect.objectContaining({
  method: "thread/start",
  params: expect.objectContaining({
    cwd: "D:\\Vault",
    runtimeWorkspaceRoots: ["D:\\Vault"],
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    config: { web_search: "disabled" }
  })
}));
```

- [ ] **Step 2: 修改恢复线程测试的审批策略断言**

将“恢复线程时重新覆盖 Vault 与审批配置”中的参数断言改为：

```ts
expect(rpc.requests).toContainEqual({
  method: "thread/resume",
  params: expect.objectContaining({
    threadId: "thread-old",
    cwd: "D:\\Vault",
    runtimeWorkspaceRoots: ["D:\\Vault"],
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "workspace-write"
  })
});
```

- [ ] **Step 3: 运行目标测试并确认测试先失败**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'
& 'C:\Program Files\nodejs\npm.cmd' test -- codex-client.test.ts
```

Expected: 只有上述两个线程配置测试失败；失败差异显示实际值仍为 `approvalPolicy: "on-request"`，期望值为 `"untrusted"`。其余 `CodexClient` 测试通过。

### Task 2: 最小化修改生产线程配置

**Files:**
- Modify: `plugin/src/codex/codex-client.ts:222`
- Test: `plugin/tests/codex-client.test.ts`

- [ ] **Step 1: 修改统一线程配置**

把 `threadConfiguration()` 改为：

```ts
private threadConfiguration(): Record<string, unknown> {
  return {
    cwd: this.vaultRoot,
    runtimeWorkspaceRoots: [this.vaultRoot],
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    config: { web_search: "disabled" }
  };
}
```

除 `approvalPolicy` 外不修改其他字段。新建线程和恢复线程继续复用同一个方法，避免两条路径产生不同的安全配置。

- [ ] **Step 2: 重跑目标测试并确认通过**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'
& 'C:\Program Files\nodejs\npm.cmd' test -- codex-client.test.ts
```

Expected: `plugin/tests/codex-client.test.ts` 全部通过；输出中没有失败测试。

- [ ] **Step 3: 提交权限逻辑和回归测试**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git add -- 'plugin/src/codex/codex-client.ts' 'plugin/tests/codex-client.test.ts'
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: allow trusted local read commands"
```

Expected: 暂存文件列表只有上述两个文件；提交成功，不包含 `.obsidian/`、`Codex Chats/`、个人笔记或成果笔记。

### Task 3: 同步中文权限文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md`
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新总体设计的已确认范围**

在 `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md` 中，将权限相关的两条范围说明替换为：

```markdown
- 以 Vault 作为 Codex 工作区，使用 `workspace-write` 沙箱，默认只允许写入该工作区内部。
- 使用 Codex CLI 原生 `untrusted` 审批策略：可信的本机只读命令默认执行；网络、写入、修改、删除和无法确认安全性的命令显示审批请求。
```

- [ ] **Step 2: 更新总体设计的权限模型**

用以下内容替换设计文档第 6 节：

```markdown
## 6. 权限模型

Codex 以 Vault 为工作区根目录，使用 `workspace-write` 沙箱、`approvalPolicy: "untrusted"` 和 `approvalsReviewer: "user"`。第一版不启用 Codex 原生网页搜索。Codex CLI `0.147.0` 认定为可信的文件浏览、读取和文本搜索命令可以直接在沙箱中执行；网络、写入、修改、删除及无法明确认定为可信只读的命令必须触发 `app-server` 审批请求。

插件不解析命令字符串、不维护只读白名单，也不自动批准收到的请求。审批只对当前请求生效，插件不保存永久允许规则。Git commit 只能从插件界面主动发起，且只能包含用户选中的成果文件；发送给 Codex 的项目规则明确禁止 Codex 自行提交、推送、删除文件或修改仓库配置。

插件绝不启用 `--dangerously-bypass-approvals-and-sandbox`、`danger-full-access`、`approvalPolicy: "never"` 或等效配置。
```

并将验收标准第 6 条替换为：

```markdown
6. 常见可信命令读取 Vault 外本机文件时不弹窗；Vault 外写入和网络访问必须显示 Obsidian 审批窗口。
```

- [ ] **Step 3: 更新 Vault 的 Agent 权限规则**

将 `AGENTS.md` 最后一条替换为：

```markdown
- 本机文件读取默认允许；写入、修改、删除、访问网络以及 Codex CLI 无法明确认定为可信只读的操作必须先获得审批。
```

其他 Git、推送和临时会话约束保持不变。

- [ ] **Step 4: 更新自动化与桌面验收清单**

在 `docs/testing/obsidian-codex-cli-acceptance.md` 的“自动化验收”中增加：

```markdown
- [ ] 新建和恢复 Codex 线程均使用 `untrusted`，并继续设置 `approvalsReviewer: "user"`、`workspace-write` 和禁用网页搜索。
```

此时先保持未勾选，Task 4 的完整验证通过后再改为 `[x]`。

将原有“外部命令或 Vault 外文件操作显示审批弹窗”替换为以下五项；在实际完成 Obsidian 桌面检查前保持未勾选：

```markdown
- [ ] 常见可信命令读取 Vault 外本机文件时不显示审批弹窗。
- [ ] 尝试写入、修改或删除 Vault 外文件时显示审批弹窗。
- [ ] 尝试访问网络时显示审批弹窗。
- [ ] 选择“拒绝”后操作不执行，并且当前会话可以继续。
- [ ] 选择“允许一次”后，同类非可信操作再次执行时仍需审批。
```

- [ ] **Step 5: 检查文档没有残留旧策略或错误边界**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
rg -n 'on-request|外部命令、网络访问和 Vault 外路径访问|删除、覆盖和访问 Vault 外路径' AGENTS.md docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md docs/testing/obsidian-codex-cli-acceptance.md
```

Expected: 没有匹配结果。已批准的历史设计 `docs/superpowers/specs/2026-08-15-read-only-permissions-design.md` 可以保留“从 `on-request` 改为 `untrusted`”这一变更说明，不纳入此检查。

### Task 4: 完整验证并检查安装产物和仓库边界

**Files:**
- Verify: `plugin/src/codex/codex-client.ts`
- Verify: `plugin/tests/codex-client.test.ts`
- Verify: `.obsidian/plugins/obsidian-codex-cli/main.js`
- Verify: Git working tree

- [ ] **Step 1: 运行完整验证**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'
& 'C:\Program Files\nodejs\npm.cmd' run verify
```

Expected: TypeScript 类型检查、全部 Vitest 测试和生产构建均通过；构建将插件重新安装到 `D:\My_DateBase\Obsidian_CodexCli\.obsidian\plugins\obsidian-codex-cli\`。

- [ ] **Step 2: 确认安装后的插件包含新策略且没有旧策略**

Run:

```powershell
$bundle = 'D:\My_DateBase\Obsidian_CodexCli\.obsidian\plugins\obsidian-codex-cli\main.js'
Select-String -LiteralPath $bundle -SimpleMatch 'approvalPolicy: "untrusted"'
Select-String -LiteralPath $bundle -SimpleMatch 'approvalPolicy: "on-request"'
```

Expected: 第一条命令匹配 `main.js` 中的线程配置；第二条命令没有匹配结果。

- [ ] **Step 3: 记录自动化验证通过**

仅在 Step 1 和 Step 2 均符合预期后，把 `docs/testing/obsidian-codex-cli-acceptance.md` 中新增的自动化验收项改为：

```markdown
- [x] 新建和恢复 Codex 线程均使用 `untrusted`，并继续设置 `approvalsReviewer: "user"`、`workspace-write` 和禁用网页搜索。
```

- [ ] **Step 4: 提交中文文档**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git add -- 'AGENTS.md' 'docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md' 'docs/testing/obsidian-codex-cli-acceptance.md'
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: explain local read-only permissions"
```

Expected: 暂存文件列表只有上述三个中文文档；提交成功。

- [ ] **Step 5: 确认 Git 只包含允许的项目文件**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git status --short --ignored
git log -3 --oneline
```

Expected: `.obsidian/`、`.worktrees/`、`Codex Chats/` 和 `plugin/node_modules/` 显示为忽略项；没有被暂存或提交。最近提交只包含计划文档、权限逻辑与测试、相关中文文档。

### Task 5: 在 Obsidian 中完成 Windows 桌面手工验收

**Files:**
- Modify after successful checks: `docs/testing/obsidian-codex-cli-acceptance.md`
- Local-only: `.obsidian/plugins/obsidian-codex-cli/main.js`
- Local-only: `Codex Chats/`

- [ ] **Step 1: 重载已安装插件**

在 Obsidian Windows 桌面版中打开命令面板，执行“重新加载应用”或先禁用再启用 `Obsidian Codex CLI`，然后打开右侧 Codex 侧边栏。

Expected: 插件正常加载，发送按钮可用，开发者控制台没有新的插件错误。

- [ ] **Step 2: 验证 Vault 外可信只读命令无需审批**

发送：

```text
请只读取 C:\Windows\win.ini，并告诉我第一节的名称；不要修改任何文件，也不要访问网络。
```

Expected: 常见可信读取命令直接完成，不显示审批弹窗，且 `C:\Windows\win.ini` 未发生变化。

- [ ] **Step 3: 验证 Vault 外写入仍需审批并拒绝执行**

发送：

```text
请在 C:\Users\Public\codex-obsidian-permission-test.txt 写入 test。
```

Expected: Obsidian 显示审批弹窗。选择“拒绝”后文件未创建，Codex 能继续响应下一条消息。

- [ ] **Step 4: 验证网络访问仍需审批**

发送：

```text
请访问 https://example.com 并返回页面标题。
```

Expected: Obsidian 显示审批弹窗。选择“拒绝”后没有执行网络请求，会话仍可继续。

- [ ] **Step 5: 验证“允许一次”不会持久化**

再次请求同一个网络操作，选择“允许一次”；完成或失败后第三次发送同一请求。

Expected: 第三次请求再次显示审批弹窗，说明插件没有保存永久授权。随后选择“拒绝”。

- [ ] **Step 6: 记录实际验收结果**

仅将已经亲自观察到符合预期的五项权限验收条目从 `[ ]` 改为 `[x]`。如任一项失败，保持未勾选，并在“已知验收限制”下记录实际表现和复现步骤，不把失败项写成已通过。

- [ ] **Step 7: 提交验收记录（仅在文档发生变化时）**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git add -- 'docs/testing/obsidian-codex-cli-acceptance.md'
git diff --cached --check
git diff --cached --name-only
git commit -m "test: record read-only permission acceptance"
```

Expected: 暂存文件列表只有验收文档；提交成功。任何临时会话、测试文件、Obsidian 配置和个人笔记仍未进入提交。
