# 文件树白名单、Excel 显示与文件变更审批概述实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Obsidian 文件树中标绿有效白名单路径、显示并外部打开 Excel 文件，同时让 Codex 文件修改审批展示可核对的摘要与 diff。

**Architecture:** 纯函数模块负责解析文件变更和匹配白名单路径，UI 模块只负责 Obsidian 文件树、文件视图和审批弹窗。`CodexClient` 按 `itemId` 关联 `patchUpdated` 通知与审批请求，并通过订阅函数支持乱序更新。主插件只做生命周期装配。

**Tech Stack:** TypeScript 7、Obsidian API 1.13、Codex app-server JSON-RPC 0.147.0、Vitest 4、Node.js 18、CSS。

**Repository rule:** 当前 Vault 会话不得运行 `git add`、`git commit` 或 `git push`。各任务完成后保留工作区改动和测试结果；只有用户另行明确授权时才创建提交。

---

## 文件结构

- Create: `plugin/src/codex/file-change-detail.ts`：校验 `patchUpdated` 数据、补全绝对路径、统计 diff 行数并生成摘要。
- Modify: `plugin/src/codex/protocol.ts`：增加文件变更通知的实际协议类型。
- Modify: `plugin/src/domain.ts`：扩展审批详情和动态更新订阅类型。
- Modify: `plugin/src/codex/codex-client.ts`：缓存文件变更、关联审批请求、处理乱序与清理生命周期。
- Modify: `plugin/src/ui/modals.ts`：显示摘要和可折叠完整 diff，并订阅后到详情。
- Create: `plugin/src/services/writable-path-highlight.ts`：将绝对白名单映射为 Vault 相对规则并执行文件/目录匹配。
- Create: `plugin/src/ui/writable-path-highlighter.ts`：扫描文件树 DOM、添加/移除绿色 class、监听目录展开。
- Create: `plugin/src/services/spreadsheet-files.ts`：维护表格扩展名并封装系统默认应用调用。
- Create: `plugin/src/ui/spreadsheet-view.ts`：注册表格文件视图并触发外部打开。
- Modify: `plugin/src/main.ts`：注册文件视图、扩展名和文件树标记器生命周期。
- Modify: `plugin/styles.css`：绿色路径、审批 diff 和表格状态样式。
- Modify: `plugin/tests/codex-client.test.ts`：覆盖 `patchUpdated` 与审批关联和乱序更新。
- Create: `plugin/tests/file-change-detail.test.ts`：覆盖各类变更摘要和 diff 行数。
- Create: `plugin/tests/writable-path-highlight.test.ts`：覆盖目录继承、单文件和路径边界。
- Create: `plugin/tests/spreadsheet-files.test.ts`：覆盖扩展名清单和系统打开错误。
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`：追加三项桌面手工验收记录。

### Task 1: 文件变更详情纯函数

**Files:**
- Create: `plugin/src/codex/file-change-detail.ts`
- Test: `plugin/tests/file-change-detail.test.ts`

- [ ] **Step 1: 写入失败测试，固定协议解析和摘要格式**

创建 `plugin/tests/file-change-detail.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  parseFileChangePatchUpdated,
  summarizeFileChanges
} from "../src/codex/file-change-detail.js";

describe("file change detail", () => {
  it("解析 patchUpdated 并统计新增修改删除", () => {
    const event = parseFileChangePatchUpdated({
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      changes: [
        {
          path: "new.txt",
          kind: { type: "add" },
          diff: "--- /dev/null\n+++ b/new.txt\n+one\n+two\n"
        },
        {
          path: "D:\\Repo\\edit.txt",
          kind: { type: "update", move_path: null },
          diff: "--- a/edit.txt\n+++ b/edit.txt\n-old\n+new\n"
        },
        {
          path: "old.txt",
          kind: { type: "delete" },
          diff: "--- a/old.txt\n+++ /dev/null\n-gone\n"
        }
      ]
    });

    expect(event?.itemId).toBe("item-1");
    expect(summarizeFileChanges(event!.changes, "D:\\Repo")).toEqual({
      summary: [
        "新增 D:\\Repo\\new.txt（+2 / -0）",
        "修改 D:\\Repo\\edit.txt（+1 / -1）",
        "删除 D:\\Repo\\old.txt（+0 / -1）"
      ].join("\n"),
      diff: [
        "### 新增 D:\\Repo\\new.txt",
        "--- /dev/null\n+++ b/new.txt\n+one\n+two\n",
        "### 修改 D:\\Repo\\edit.txt",
        "--- a/edit.txt\n+++ b/edit.txt\n-old\n+new\n",
        "### 删除 D:\\Repo\\old.txt",
        "--- a/old.txt\n+++ /dev/null\n-gone\n"
      ].join("\n\n")
    });
  });

  it("显示移动目标并拒绝异常通知", () => {
    const event = parseFileChangePatchUpdated({
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      changes: [{
        path: "before.txt",
        kind: { type: "update", move_path: "after.txt" },
        diff: ""
      }]
    });

    expect(summarizeFileChanges(event!.changes, "D:\\Repo").summary)
      .toBe("移动 D:\\Repo\\before.txt -> D:\\Repo\\after.txt（+0 / -0）");
    expect(parseFileChangePatchUpdated({ itemId: "bad", changes: "invalid" })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行单测并确认按预期失败**

Run: `npm test -- file-change-detail.test.ts`

Expected: FAIL，提示找不到 `../src/codex/file-change-detail.js`。

- [ ] **Step 3: 实现协议解析、路径补全和摘要生成**

创建 `plugin/src/codex/file-change-detail.ts`，包含以下完整导出：

```ts
import { win32 } from "node:path";

import type {
  FileChangePatchUpdated,
  FileUpdateChange,
  PatchChangeKind
} from "./protocol.js";

export interface FileChangeDetail {
  summary: string;
  diff: string | null;
}

export function parseFileChangePatchUpdated(value: unknown): FileChangePatchUpdated | null {
  if (!isRecord(value) ||
      typeof value.threadId !== "string" ||
      typeof value.turnId !== "string" ||
      typeof value.itemId !== "string" ||
      !Array.isArray(value.changes)) {
    return null;
  }
  const changes = value.changes.map(parseChange);
  if (changes.some((change) => change === null)) {
    return null;
  }
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    itemId: value.itemId,
    changes: changes as FileUpdateChange[]
  };
}

export function summarizeFileChanges(
  changes: FileUpdateChange[],
  cwd: string
): FileChangeDetail {
  if (changes.length === 0) {
    return { summary: "暂无详细差异", diff: null };
  }
  const entries = changes.map((change) => {
    const path = absolutePath(cwd, change.path);
    const target = change.kind.type === "update" && change.kind.move_path !== null
      ? absolutePath(cwd, change.kind.move_path)
      : null;
    const action = actionLabel(change.kind);
    const { added, removed } = countChangedLines(change.diff);
    const title = target === null ? `${action} ${path}` : `${action} ${path} -> ${target}`;
    return {
      summary: `${title}（+${added} / -${removed}）`,
      diff: change.diff.length === 0 ? null : `### ${title}\n\n${change.diff}`
    };
  });
  return {
    summary: entries.map((entry) => entry.summary).join("\n"),
    diff: entries.flatMap((entry) => entry.diff === null ? [] : [entry.diff]).join("\n\n") || null
  };
}

function parseChange(value: unknown): FileUpdateChange | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.diff !== "string") {
    return null;
  }
  const kind = parseKind(value.kind);
  return kind === null ? null : { path: value.path, diff: value.diff, kind };
}

function parseKind(value: unknown): PatchChangeKind | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "add" || value.type === "delete") {
    return { type: value.type };
  }
  if (value.type === "update" &&
      (value.move_path === null || typeof value.move_path === "string")) {
    return { type: "update", move_path: value.move_path };
  }
  return null;
}

function actionLabel(kind: PatchChangeKind): string {
  if (kind.type === "add") return "新增";
  if (kind.type === "delete") return "删除";
  return kind.move_path === null ? "修改" : "移动";
}

function countChangedLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function absolutePath(cwd: string, path: string): string {
  return win32.isAbsolute(path) ? win32.normalize(path) : win32.resolve(cwd, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: 在协议类型中增加实际字段**

在 `plugin/src/codex/protocol.ts` 增加：

```ts
export type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };

export interface FileUpdateChange {
  path: string;
  kind: PatchChangeKind;
  diff: string;
}

export interface FileChangePatchUpdated {
  threadId: string;
  turnId: string;
  itemId: string;
  changes: FileUpdateChange[];
}

export interface FileChangeApprovalRequest {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
  grantRoot?: string | null;
}
```

删除旧 `FileChangeApprovalRequest` 中不存在的 `changes?: unknown`。

- [ ] **Step 5: 运行目标测试和类型检查**

Run: `npm test -- file-change-detail.test.ts`

Expected: 2 tests PASS。

Run: `npm run typecheck`

Expected: PASS。

### Task 2: Codex 通知缓存与乱序审批更新

**Files:**
- Modify: `plugin/src/domain.ts`
- Modify: `plugin/src/codex/codex-client.ts`
- Modify: `plugin/tests/codex-client.test.ts`

- [ ] **Step 1: 写入 patch 先到和审批先到的失败测试**

在 `plugin/tests/codex-client.test.ts` 的审批测试后增加：

```ts
it("用同 itemId 的 patchUpdated 填充文件审批概述", async () => {
  const rpc = new FakeRpc();
  const client = new CodexClient(rpc, "D:\\Vault");
  let captured: ApprovalPrompt | null = null;
  client.onApproval(async (prompt) => {
    captured = prompt;
    return "allowOnce";
  });
  rpc.emitNotification({
    method: "item/fileChange/patchUpdated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-file",
      changes: [{
        path: "created.txt",
        kind: { type: "add" },
        diff: "--- /dev/null\n+++ b/created.txt\n+created\n"
      }]
    }
  });

  await rpc.emitServerRequest({
    id: 11,
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-file" }
  });

  expect(captured).toMatchObject({
    detail: "新增 D:\\Vault\\created.txt（+1 / -0）"
  });
  expect(captured?.diff).toContain("+created");
});

it("审批先到时用后续 patchUpdated 更新已打开弹窗", async () => {
  const rpc = new FakeRpc();
  const client = new CodexClient(rpc, "D:\\Vault");
  let finishApproval: ((choice: ApprovalChoice) => void) | null = null;
  const updates: ApprovalDetail[] = [];
  client.onApproval((prompt) => {
    expect(prompt.detail).toBe("正在获取变更概述");
    prompt.subscribeDetail?.((detail) => updates.push(detail));
    return new Promise((resolve) => { finishApproval = resolve; });
  });

  const approval = rpc.emitServerRequest({
    id: 12,
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-late" }
  });
  await vi.waitFor(() => expect(finishApproval).not.toBeNull());
  rpc.emitNotification({
    method: "item/fileChange/patchUpdated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-late",
      changes: [{
        path: "late.txt",
        kind: { type: "update", move_path: null },
        diff: "--- a/late.txt\n+++ b/late.txt\n-old\n+new\n"
      }]
    }
  });
  expect(updates.at(-1)?.detail).toBe("修改 D:\\Vault\\late.txt（+1 / -1）");
  finishApproval!("allowOnce");
  await approval;
});
```

同时把测试文件顶部导入补全为：

```ts
import type { ApprovalChoice } from "../src/codex/codex-client.js";
import type { ApprovalDetail, ApprovalPrompt } from "../src/domain.js";
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `npm test -- codex-client.test.ts`

Expected: FAIL，表现为文件审批仍是“无详细信息”且 `subscribeDetail` 不存在。

- [ ] **Step 3: 扩展审批领域类型**

将 `plugin/src/domain.ts` 的审批类型改为：

```ts
export interface ApprovalDetail {
  detail: string;
  diff: string | null;
}

export interface ApprovalPrompt extends ApprovalDetail {
  requestId: string | number;
  kind: "command" | "fileChange";
  title: string;
  reason: string | null;
  subscribeDetail?: (handler: (detail: ApprovalDetail) => void) => () => void;
}
```

- [ ] **Step 4: 在 CodexClient 中关联通知、缓存和订阅**

在 `plugin/src/codex/codex-client.ts`：

1. 导入 `ApprovalDetail`、`FileUpdateChange`、`parseFileChangePatchUpdated` 和 `summarizeFileChanges`。
2. 增加以下字段：

```ts
private readonly fileChanges = new Map<
  string,
  { turnId: string; changes: FileUpdateChange[] }
>();
private readonly fileDetailHandlers = new Map<
  string,
  Set<(detail: ApprovalDetail) => void>
>();
```

3. 在 `handleNotification` 的 agent message 分支之前增加：

```ts
if (notification.method === "item/fileChange/patchUpdated") {
  const event = parseFileChangePatchUpdated(notification.params);
  if (event !== null) {
    this.fileChanges.set(event.itemId, {
      turnId: event.turnId,
      changes: event.changes
    });
    const detail = toApprovalDetail(event.changes, this.vaultRoot);
    for (const handler of this.fileDetailHandlers.get(event.itemId) ?? []) {
      handler(detail);
    }
  }
  return;
}
```

4. 将 `toApprovalPrompt` 改成实例方法。命令审批保持现有行为；文件审批从 `params.itemId` 取缓存，缺少缓存时使用加载文案：

```ts
private toApprovalPrompt(request: RpcRequest): ApprovalPrompt {
  const params = isRecord(request.params) ? request.params : {};
  const reason = typeof params.reason === "string" ? params.reason : null;
  if (request.method === "item/commandExecution/requestApproval") {
    return {
      requestId: request.id,
      kind: "command",
      title: "运行外部命令",
      detail: formatDetail(params.command),
      diff: null,
      reason
    };
  }
  const itemId = typeof params.itemId === "string" ? params.itemId : null;
  const cached = itemId === null ? undefined : this.fileChanges.get(itemId);
  const initial = cached === undefined
    ? { detail: "正在获取变更概述", diff: null }
    : toApprovalDetail(cached.changes, this.vaultRoot);
  return {
    requestId: request.id,
    kind: "fileChange",
    title: "修改文件",
    ...initial,
    reason,
    ...(itemId === null ? {} : {
      subscribeDetail: (handler: (detail: ApprovalDetail) => void) =>
        this.subscribeFileDetail(itemId, handler)
    })
  };
}
```

5. 增加订阅与转换方法：

```ts
private subscribeFileDetail(
  itemId: string,
  handler: (detail: ApprovalDetail) => void
): () => void {
  const handlers = this.fileDetailHandlers.get(itemId) ?? new Set();
  handlers.add(handler);
  this.fileDetailHandlers.set(itemId, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) this.fileDetailHandlers.delete(itemId);
  };
}
```

在文件末尾增加：

```ts
function toApprovalDetail(changes: FileUpdateChange[], cwd: string): ApprovalDetail {
  const detail = summarizeFileChanges(changes, cwd);
  return { detail: detail.summary, diff: detail.diff };
}
```

6. `handleServerRequest` 调用 `this.toApprovalPrompt(request)`，并用 `finally` 清理当前审批项：

```ts
const params = isRecord(request.params) ? request.params : {};
const itemId = request.method === "item/fileChange/requestApproval" &&
  typeof params.itemId === "string"
  ? params.itemId
  : null;
const prompt = this.toApprovalPrompt(request);
try {
  const choice = await this.approvalHandler(prompt);
  this.rpc.respond(request.id, {
    decision: choice === "allowOnce" ? "accept" : "decline"
  });
  if (choice === "deny") await this.interrupt();
} finally {
  if (itemId !== null) {
    this.fileChanges.delete(itemId);
    this.fileDetailHandlers.delete(itemId);
  }
}
```

在 `completeTurn` 通过线程和回合校验后清理同回合缓存：

```ts
for (const [itemId, entry] of this.fileChanges) {
  if (entry.turnId === event.turn.id) {
    this.fileChanges.delete(itemId);
    this.fileDetailHandlers.delete(itemId);
  }
}
```

在 `close` 中增加：

```ts
this.fileChanges.clear();
this.fileDetailHandlers.clear();
```

- [ ] **Step 5: 运行 CodexClient 测试和完整单测**

Run: `npm test -- codex-client.test.ts`

Expected: 现有审批测试与 2 个新增测试全部 PASS。

Run: `npm test`

Expected: 全部测试 PASS。

### Task 3: 审批弹窗摘要与可折叠 diff

**Files:**
- Modify: `plugin/src/ui/modals.ts`
- Modify: `plugin/styles.css`

- [ ] **Step 1: 将 ApprovalModal 改为可更新渲染**

在 `ApprovalModal` 增加字段：

```ts
private detailEl: HTMLElement | null = null;
private diffContainerEl: HTMLDetailsElement | null = null;
private diffEl: HTMLElement | null = null;
private unsubscribeDetail: (() => void) | null = null;
```

在 `onOpen` 中用以下结构替换一次性详情创建：

```ts
this.detailEl = this.contentEl.createEl("div", { cls: "codex-modal-detail" });
this.diffContainerEl = this.contentEl.createEl("details", { cls: "codex-approval-diff" });
this.diffContainerEl.createEl("summary", { text: "查看详细差异" });
this.diffEl = this.diffContainerEl.createEl("pre", { cls: "codex-diff-preview" });
this.renderDetail({ detail: this.prompt.detail, diff: this.prompt.diff });
this.unsubscribeDetail = this.prompt.subscribeDetail?.((detail) => {
  this.renderDetail(detail);
}) ?? null;
```

增加方法：

```ts
private renderDetail(value: ApprovalDetail): void {
  this.detailEl?.setText(value.detail || "暂无详细差异");
  if (this.diffContainerEl === null || this.diffEl === null) return;
  this.diffContainerEl.hidden = value.diff === null;
  this.diffEl.setText(value.diff ?? "");
}
```

补充导入：

```ts
import type { ApprovalDetail, ApprovalPrompt } from "../domain.js";
```

在 `onClose` 清理订阅并置空元素引用：

```ts
this.unsubscribeDetail?.();
this.unsubscribeDetail = null;
this.detailEl = null;
this.diffContainerEl = null;
this.diffEl = null;
```

- [ ] **Step 2: 增加审批 diff 样式**

在 `plugin/styles.css` 的 modal 样式后增加：

```css
.codex-approval-diff {
  margin-bottom: 10px;
}

.codex-approval-diff > summary {
  cursor: pointer;
  color: var(--text-muted);
}

.codex-approval-diff .codex-diff-preview {
  max-height: 320px;
  margin: 8px 0 0;
}
```

- [ ] **Step 3: 执行静态验证**

Run: `npm run typecheck`

Expected: PASS，尤其不能出现 `ApprovalPrompt.diff` 或 `ApprovalDetail` 类型错误。

Run: `npm test`

Expected: 全部测试 PASS。

### Task 4: 白名单路径规则与文件树标记器

**Files:**
- Create: `plugin/src/services/writable-path-highlight.ts`
- Create: `plugin/src/ui/writable-path-highlighter.ts`
- Test: `plugin/tests/writable-path-highlight.test.ts`
- Modify: `plugin/styles.css`

- [ ] **Step 1: 写入路径继承与边界失败测试**

创建 `plugin/tests/writable-path-highlight.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  isWritableVaultPath,
  toVaultHighlightRule
} from "../src/services/writable-path-highlight.js";

describe("writable path highlight", () => {
  it("目录规则匹配自身和所有子项", () => {
    const rule = toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault\\Tools\\xlsx",
      kind: "directory"
    });
    expect(rule).toEqual({ path: "Tools/xlsx", kind: "directory" });
    expect(isWritableVaultPath("Tools/xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Tools/xlsx/Activity.xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Tools/xlsx-old/Activity.xlsx", [rule!])).toBe(false);
  });

  it("文件规则只匹配文件本身", () => {
    const rule = toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault\\Guide.xlsx",
      kind: "file"
    });
    expect(isWritableVaultPath("guide.xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Guide.xlsx/child", [rule!])).toBe(false);
  });

  it("忽略当前 Vault 之外的白名单", () => {
    expect(toVaultHighlightRule("D:\\Vault", {
      realPath: "E:\\Repo\\Assets",
      kind: "directory"
    })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- writable-path-highlight.test.ts`

Expected: FAIL，提示找不到目标模块。

- [ ] **Step 3: 实现纯路径规则**

创建 `plugin/src/services/writable-path-highlight.ts`：

```ts
import { win32 } from "node:path";

import type { PathInfo } from "./workspace-policy.js";

export interface WritableHighlightRule {
  path: string;
  kind: "file" | "directory";
}

export function toVaultHighlightRule(
  vaultRoot: string,
  info: PathInfo
): WritableHighlightRule | null {
  if (info.kind !== "file" && info.kind !== "directory") return null;
  const relative = win32.relative(vaultRoot, info.realPath);
  if (relative === ".." || relative.startsWith(`..${win32.sep}`) || win32.isAbsolute(relative)) {
    return null;
  }
  return {
    path: normalizeVaultPath(relative),
    kind: info.kind
  };
}

export function isWritableVaultPath(
  candidate: string,
  rules: WritableHighlightRule[]
): boolean {
  const path = normalizeVaultPath(candidate).toLowerCase();
  return rules.some((rule) => {
    const root = normalizeVaultPath(rule.path).toLowerCase();
    if (path === root) return true;
    return rule.kind === "directory" && (root === "" || path.startsWith(`${root}/`));
  });
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
```

- [ ] **Step 4: 实现 DOM 标记器**

创建 `plugin/src/ui/writable-path-highlighter.ts`。文件从以下完整导入开始：

```ts
import {
  isWritableVaultPath,
  toVaultHighlightRule,
  type WritableHighlightRule
} from "../services/writable-path-highlight.js";
import { NodePathInspector } from "../services/workspace-policy.js";
```

该类必须：

- 接收 `Document`、Vault 根路径和 `() => string[]` 设置读取器。
- 使用 `NodePathInspector.inspect` 确定白名单是文件还是目录。
- 只观察 `childList` 和 `subtree`，避免自身 class 变化触发循环。
- 扫描 `.nav-file-title[data-path], .nav-folder-title[data-path]`。
- 对每个节点调用 `classList.toggle("codex-writable-path", matched)`。
- `stop()` 时断开 observer 并移除所有残留 class。

类实现如下：

```ts
const FILE_TREE_PATH_SELECTOR =
  ".nav-file-title[data-path], .nav-folder-title[data-path]";
const WRITABLE_CLASS = "codex-writable-path";

export class WritablePathHighlighter {
  private observer: MutationObserver | null = null;
  private refreshQueued = false;
  private readonly inspector = new NodePathInspector();

  constructor(
    private readonly document: Document,
    private readonly vaultRoot: string,
    private readonly writablePaths: () => string[]
  ) {}

  start(): void {
    if (this.observer !== null) return;
    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(this.document.body, { childList: true, subtree: true });
    this.scheduleRefresh();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const node of this.document.querySelectorAll(`.${WRITABLE_CLASS}`)) {
      node.classList.remove(WRITABLE_CLASS);
    }
  }

  refresh(): void {
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      void this.applyRules();
    });
  }

  private async applyRules(): Promise<void> {
    const rules: WritableHighlightRule[] = [];
    for (const path of this.writablePaths()) {
      try {
        const rule = toVaultHighlightRule(this.vaultRoot, await this.inspector.inspect(path));
        if (rule !== null) rules.push(rule);
      } catch {
        // 设置校验后路径仍可能被用户从磁盘移除；此时只跳过颜色标记。
      }
    }
    for (const node of this.document.querySelectorAll<HTMLElement>(FILE_TREE_PATH_SELECTOR)) {
      const path = node.dataset.path;
      node.classList.toggle(
        WRITABLE_CLASS,
        path !== undefined && isWritableVaultPath(path, rules)
      );
    }
  }
}
```

- [ ] **Step 5: 增加绿色字色样式并验证**

在 `plugin/styles.css` 增加：

```css
.nav-file-title.codex-writable-path,
.nav-folder-title.codex-writable-path {
  color: var(--text-success) !important;
}
```

Run: `npm test -- writable-path-highlight.test.ts`

Expected: 3 tests PASS。

Run: `npm run typecheck`

Expected: PASS。

### Task 5: 表格文件显示与系统默认应用打开

**Files:**
- Create: `plugin/src/services/spreadsheet-files.ts`
- Create: `plugin/src/ui/spreadsheet-view.ts`
- Test: `plugin/tests/spreadsheet-files.test.ts`
- Modify: `plugin/styles.css`

- [ ] **Step 1: 写入扩展名和外部打开失败测试**

创建 `plugin/tests/spreadsheet-files.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";

import {
  SPREADSHEET_EXTENSIONS,
  openWithDefaultApp
} from "../src/services/spreadsheet-files.js";

describe("spreadsheet files", () => {
  it("注册常用 Excel 和表格扩展名", () => {
    expect(SPREADSHEET_EXTENSIONS).toEqual([
      "xlsx", "xls", "xlsm", "xlsb", "xltx", "xltm", "csv", "tsv"
    ]);
  });

  it("调用 Electron shell 并将错误文本转成异常", async () => {
    const success = { openPath: vi.fn().mockResolvedValue("") };
    await expect(openWithDefaultApp("D:\\Vault\\Book.xlsx", success)).resolves.toBeUndefined();
    expect(success.openPath).toHaveBeenCalledWith("D:\\Vault\\Book.xlsx");

    const failure = { openPath: vi.fn().mockResolvedValue("没有关联的应用") };
    await expect(openWithDefaultApp("D:\\Vault\\Book.xlsx", failure))
      .rejects.toThrow("没有关联的应用");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- spreadsheet-files.test.ts`

Expected: FAIL，提示找不到目标模块。

- [ ] **Step 3: 实现扩展名清单和 Electron shell 适配**

创建 `plugin/src/services/spreadsheet-files.ts`：

```ts
export const SPREADSHEET_EXTENSIONS = [
  "xlsx", "xls", "xlsm", "xlsb", "xltx", "xltm", "csv", "tsv"
] as const;

export interface ElectronShell {
  openPath(path: string): Promise<string>;
}

export async function openWithDefaultApp(
  path: string,
  shell: ElectronShell = loadElectronShell()
): Promise<void> {
  const error = await shell.openPath(path);
  if (error.length > 0) throw new Error(`无法使用系统默认应用打开文件: ${error}`);
}

function loadElectronShell(): ElectronShell {
  const desktopWindow = window as Window & {
    require?: (id: string) => { shell?: ElectronShell };
  };
  const shell = desktopWindow.require?.("electron").shell;
  if (shell === undefined) throw new Error("当前环境无法调用系统默认应用");
  return shell;
}
```

- [ ] **Step 4: 实现 Obsidian FileView**

创建 `plugin/src/ui/spreadsheet-view.ts`：

```ts
import {
  FileSystemAdapter,
  FileView,
  Notice,
  type TFile,
  type WorkspaceLeaf
} from "obsidian";

import { openWithDefaultApp } from "../services/spreadsheet-files.js";

export const SPREADSHEET_VIEW_TYPE = "obsidian-codex-cli-spreadsheet";

export class SpreadsheetExternalView extends FileView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return SPREADSHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? "表格文件";
  }

  getIcon(): string {
    return "sheet";
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("codex-spreadsheet-view");
    const status = this.contentEl.createDiv({ text: "正在使用系统默认应用打开…" });
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      const message = "只有桌面文件系统 Vault 可以打开表格文件";
      status.setText(message);
      new Notice(message);
      return;
    }
    try {
      await openWithDefaultApp(adapter.getFullPath(file.path));
      status.setText("已使用系统默认应用打开");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.setText(message);
      new Notice(message);
    }
  }
}
```

- [ ] **Step 5: 增加表格状态样式并验证**

在 `plugin/styles.css` 增加：

```css
.codex-spreadsheet-view {
  display: grid;
  min-height: 100%;
  place-items: center;
  padding: 20px;
  color: var(--text-muted);
  text-align: center;
}
```

Run: `npm test -- spreadsheet-files.test.ts`

Expected: 2 tests PASS。

Run: `npm run typecheck`

Expected: PASS。

### Task 6: 主插件装配、完整验证与验收记录

**Files:**
- Modify: `plugin/src/main.ts`
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`

- [ ] **Step 1: 注册表格视图与扩展名**

在 `plugin/src/main.ts` 导入：

```ts
import { SPREADSHEET_EXTENSIONS } from "./services/spreadsheet-files.js";
import {
  SPREADSHEET_VIEW_TYPE,
  SpreadsheetExternalView
} from "./ui/spreadsheet-view.js";
import { WritablePathHighlighter } from "./ui/writable-path-highlighter.js";
```

在类字段中增加：

```ts
private writablePathHighlighter: WritablePathHighlighter | null = null;
```

在 `onload` 获得 `vaultRoot` 后、注册聊天视图前增加：

```ts
this.registerView(
  SPREADSHEET_VIEW_TYPE,
  (leaf) => new SpreadsheetExternalView(leaf)
);
this.registerExtensions([...SPREADSHEET_EXTENSIONS], SPREADSHEET_VIEW_TYPE);
this.writablePathHighlighter = new WritablePathHighlighter(
  document,
  this.vaultRoot,
  () => this.settings.writablePaths
);
this.app.workspace.onLayoutReady(() => this.writablePathHighlighter?.start());
this.register(() => this.writablePathHighlighter?.stop());
```

- [ ] **Step 2: 在设置更新和卸载时刷新/清理标记器**

在 `updateSettings` 保存设置并关闭运行时后增加：

```ts
this.writablePathHighlighter?.refresh();
```

在 `onunload` 末尾增加并置空：

```ts
this.writablePathHighlighter?.stop();
this.writablePathHighlighter = null;
```

- [ ] **Step 3: 运行完整自动化验证**

Run: `npm run typecheck`

Expected: PASS。

Run: `npm test`

Expected: 所有测试 PASS，新增测试不少于 9 个。

Run: `npm run build`

Expected: PASS，并更新 `.obsidian/plugins/obsidian-codex-cli/main.js`、`manifest.json`、`styles.css`。

- [ ] **Step 4: 检查构建产物包含关键行为**

Run:

```powershell
Select-String -LiteralPath '..\.obsidian\plugins\obsidian-codex-cli\main.js' -SimpleMatch 'item/fileChange/patchUpdated'
Select-String -LiteralPath '..\.obsidian\plugins\obsidian-codex-cli\main.js' -SimpleMatch 'obsidian-codex-cli-spreadsheet'
Select-String -LiteralPath '..\.obsidian\plugins\obsidian-codex-cli\styles.css' -SimpleMatch 'codex-writable-path'
```

Expected: 三条命令均至少返回一个匹配。

- [ ] **Step 5: 更新桌面验收清单**

在 `docs/testing/obsidian-codex-cli-acceptance.md` 的 Obsidian 桌面手工验收中追加，首次保持未勾选：

```markdown
- [ ] 白名单文件、目录及目录子项显示绿色，移除白名单后恢复默认颜色。
- [ ] Excel 和常见表格文件显示在文件树中，双击后使用系统默认 Excel/WPS 打开。
- [ ] 文件修改审批显示完整路径、操作类型、增删行数，并可展开查看 diff。
```

- [ ] **Step 6: 在 Obsidian 中执行手工验收**

1. 重新加载 Codex CLI 插件。
2. 将当前 Vault 内一个目录加入白名单，展开目录并确认目录、子目录和文件均为绿色。
3. 将一个单独文件加入白名单，确认只有该文件变绿。
4. 移除两项白名单并保存，确认颜色恢复。
5. 把一个 `.xlsx` 和一个 `.xls` 放入 Vault，确认文件树显示；双击后确认 Excel/WPS 打开。
6. 让 Codex 在非白名单位置创建一个文本文件，确认审批弹窗显示“新增”、完整路径、行数和 diff。
7. 拒绝审批，确认文件未创建且下一条会话仍可继续。

Expected: 七项全部通过后，将 Step 5 的三个检查项改为 `[x]`；失败时记录真实现象和 Console 错误，不以静态推测代替验收。

## 最终完成条件

- `npm run typecheck`、`npm test`、`npm run build` 全部通过。
- 当前 Vault 白名单颜色与实际权限继承范围一致。
- Excel 和常见表格文件可见并由系统默认应用打开。
- 文件审批不再显示“无详细信息”，能够核对摘要和完整 diff。
- 未改变“允许一次/拒绝”、拒绝后中断、网络审批和白名单权限配置。
