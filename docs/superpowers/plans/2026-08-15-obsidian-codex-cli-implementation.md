# Obsidian Codex CLI 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 桌面版 Obsidian 中提供原生 Codex 对话侧边栏，将临时对话仅保存在本机，将确认后的成果保存到独立目录，并允许用户选择性提交成果文件。

**Architecture:** 插件采用 TypeScript 和 Obsidian API。Codex `app-server` 通过 stdio JSON-RPC 适配层接入，文件、Git 和进程操作通过小型接口隔离，以便测试。控制器负责串联当前笔记、临时会话、成果、审批和提交；UI 只负责展示状态与收集显式确认。

**Tech Stack:** Obsidian API 1.13.1、TypeScript 7.0.2、Node.js 24、esbuild 0.28.2、Vitest 4.1.10、Codex CLI 0.147.0、Git 2.55。

---

## 文件职责

- `.gitignore`：白名单式跟踪源码、文档和成果，排除临时会话、个人笔记、Obsidian 状态和构建产物。
- `AGENTS.md`：约束 Codex 只在 Vault 内工作，不自行提交、推送或删除。
- `plugin/package.json`：开发依赖和构建、测试、类型检查脚本。
- `plugin/esbuild.config.mjs`：打包插件，并把运行产物安装到 Vault 的插件目录。
- `plugin/manifest.json`、`plugin/styles.css`：Obsidian 插件清单和本地化界面样式。
- `plugin/src/domain.ts`：会话、成果、审批和健康状态领域类型。
- `plugin/src/platform/vault-files.ts`：文件访问接口及 Obsidian 适配器。
- `plugin/src/platform/process-runner.ts`：无 shell 的 Windows 子进程执行接口。
- `plugin/src/codex/protocol.ts`：Codex 0.147.0 所需的最小 JSON-RPC 类型。
- `plugin/src/codex/json-rpc.ts`：按行解析 stdio JSON-RPC，请求关联和服务器请求分发。
- `plugin/src/codex/codex-client.ts`：初始化、线程创建或恢复、回合发送、流式事件、取消和审批响应。
- `plugin/src/services/path-policy.ts`：Vault 相对路径净化和目录边界校验。
- `plugin/src/services/transcript-store.ts`：本地临时会话序列化与恢复。
- `plugin/src/services/result-store.ts`：成果创建、列出、读取和当前笔记链接写入。
- `plugin/src/services/context-service.ts`：只在首轮或当前笔记变化时提供笔记上下文。
- `plugin/src/services/git-service.ts`：成果候选、差异预览、精确暂存和 commit。
- `plugin/src/services/health-check.ts`：Windows、Codex、登录、Git 和仓库检查。
- `plugin/src/chat-controller.ts`：会话状态机和各服务编排。
- `plugin/src/ui/chat-view.ts`：右侧栏聊天和成果列表。
- `plugin/src/ui/modals.ts`：审批、成果预览和提交预览弹窗。
- `plugin/src/settings.ts`：本地路径设置和设置页。
- `plugin/src/main.ts`：插件生命周期、视图与命令注册。
- `plugin/tests/`：与上述模块一一对应的单元和集成测试。

---

### Task 1: 初始化 Vault 插件工程和白名单 Git 规则

**Files:**
- Create: `.gitignore`
- Create: `AGENTS.md`
- Create: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/vitest.config.ts`
- Create: `plugin/esbuild.config.mjs`
- Create: `plugin/manifest.json`
- Create: `plugin/styles.css`
- Create: `plugin/src/main.ts`

- [ ] **Step 1: 写入白名单式 `.gitignore` 和项目规则**

```gitignore
/*
!/.gitignore
!/AGENTS.md
!/plugin/
!/docs/
!/Codex Results/
!/Codex Results/**
/plugin/node_modules/
/plugin/coverage/
```

`AGENTS.md` 的核心规则必须包含：默认中文；`Codex Chats/` 仅本地保存；只允许修改 Vault 内文件；禁止 Codex 自行运行 `git add`、`git commit`、`git push`；删除、覆盖和 Vault 外访问必须先审批。

- [ ] **Step 2: 创建可复现的 Node 工程**

```json
{
  "name": "obsidian-codex-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "verify": "npm run typecheck && npm test && npm run build"
  },
  "devDependencies": {
    "@types/node": "26.2.0",
    "esbuild": "0.28.2",
    "obsidian": "1.13.1",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: 创建 TypeScript、Vitest 和 esbuild 配置**

`tsconfig.json` 使用 `ES2022`、`NodeNext`、`strict: true`、`noUncheckedIndexedAccess: true`。`vitest.config.ts` 只匹配 `tests/**/*.test.ts`，环境为 `node`。

`esbuild.config.mjs` 必须把 `src/main.ts` 打包为 CommonJS，将 `obsidian` 标记为 external，并把 `main.js`、`manifest.json`、`styles.css` 写入 `../.obsidian/plugins/obsidian-codex-cli/`。

```js
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const production = process.argv.includes("production");
const outdir = resolve("../.obsidian/plugins/obsidian-codex-cli");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: production ? false : "inline",
  outfile: resolve(outdir, "main.js")
});
await Promise.all([
  cp("manifest.json", resolve(outdir, "manifest.json")),
  cp("styles.css", resolve(outdir, "styles.css"))
]);
```

`manifest.json` 和最小入口使用以下内容：

```json
{
  "id": "obsidian-codex-cli",
  "name": "Codex CLI",
  "version": "0.1.0",
  "minAppVersion": "1.8.0",
  "description": "在 Obsidian 中运行本地 Codex 会话并保存可提交成果。",
  "author": "Liang Xu",
  "isDesktopOnly": true
}
```

```ts
import { Plugin } from "obsidian";

export default class ObsidianCodexCliPlugin extends Plugin {
  async onload(): Promise<void> {}
  onunload(): void {}
}
```

- [ ] **Step 4: 安装依赖**

Run: `Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'; npm install`

Expected: 退出码为 `0`，生成 `plugin/package-lock.json` 和 `plugin/node_modules/`。

- [ ] **Step 5: 验证空插件可以类型检查和构建**

Run: `Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'; npm run typecheck; npm run build`

Expected: 两个命令退出码均为 `0`；`.obsidian/plugins/obsidian-codex-cli/` 中存在 `main.js`、`manifest.json` 和 `styles.css`。

- [ ] **Step 6: 提交工程骨架**

```powershell
git add -- .gitignore AGENTS.md plugin
git commit -m "build: scaffold Obsidian Codex plugin"
```

---

### Task 2: 定义领域类型和 Vault 路径边界

**Files:**
- Create: `plugin/src/domain.ts`
- Create: `plugin/src/services/path-policy.ts`
- Create: `plugin/tests/path-policy.test.ts`

- [ ] **Step 1: 编写路径策略失败测试**

```ts
import { describe, expect, it } from "vitest";
import { assertResultPath, sanitizeFileStem } from "../src/services/path-policy";

describe("path policy", () => {
  it("只接受 Codex Results 下的 Markdown", () => {
    expect(assertResultPath("Codex Results/方案.md")).toBe("Codex Results/方案.md");
    expect(() => assertResultPath("Codex Chats/会话.md")).toThrow("成果目录");
    expect(() => assertResultPath("../方案.md")).toThrow("非法路径");
  });

  it("净化 Windows 文件名", () => {
    expect(sanitizeFileStem('AUX: 方案?')).toBe("AUX- 方案-");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:\My_DateBase\Obsidian_CodexCli\plugin; npm test -- path-policy.test.ts`

Expected: FAIL，提示无法导入 `path-policy`。

- [ ] **Step 3: 实现最小领域类型与路径策略**

```ts
export type ChatRole = "user" | "assistant" | "system";
export interface ChatEntry { id: string; role: ChatRole; content: string; createdAt: string; }
export interface ChatSession { id: string; title: string; relatedNote: string; transcriptPath: string; codexThreadId: string | null; entries: ChatEntry[]; status: "active" | "completed" | "failed"; createdAt: string; updatedAt: string; }
export interface ResultNote { path: string; title: string; sourceChat: string; relatedNote: string; createdAt: string; content: string; }
export interface ApprovalPrompt { requestId: string | number; kind: "command" | "fileChange"; title: string; detail: string; reason: string | null; }
export interface HealthStatus { windows: boolean; codexPath: string | null; codexVersion: string | null; codexCompatible: boolean; loggedIn: boolean; gitPath: string | null; repositoryRoot: string | null; readyToChat: boolean; readyToCommit: boolean; errors: string[]; }
```

`path-policy.ts` 使用正斜杠规范化 Vault 相对路径，拒绝绝对路径、空段和 `..`。`assertResultPath()` 只允许 `Codex Results/*.md`。文件名替换 Windows 禁止字符并把空白压缩为单个空格。

- [ ] **Step 4: 运行测试和类型检查**

Run: `npm test -- path-policy.test.ts; npm run typecheck`

Expected: 测试全部 PASS，类型检查退出码为 `0`。

- [ ] **Step 5: 提交领域基础**

```powershell
git add -- plugin/src/domain.ts plugin/src/services/path-policy.ts plugin/tests/path-policy.test.ts
git commit -m "feat: add domain types and Vault path policy"
```

---

### Task 3: 实现临时会话和成果存储

**Files:**
- Create: `plugin/src/platform/vault-files.ts`
- Create: `plugin/src/services/transcript-store.ts`
- Create: `plugin/src/services/result-store.ts`
- Create: `plugin/tests/memory-vault.ts`
- Create: `plugin/tests/transcript-store.test.ts`
- Create: `plugin/tests/result-store.test.ts`

- [ ] **Step 1: 编写会话与成果存储失败测试**

```ts
it("把完整会话写入 Codex Chats", async () => {
  const vault = new MemoryVault();
  const store = new TranscriptStore(vault, () => "2026-08-15T10:00:00.000Z");
  const session = await store.create("需求讨论", "项目.md");
  session.entries.push({ id: "u1", role: "user", content: "分析方案", createdAt: "2026-08-15T10:00:00.000Z" });
  await store.save(session);
  expect(session.transcriptPath).toMatch(/^Codex Chats\//);
  expect(await vault.read(session.transcriptPath)).toContain("分析方案");
});

it("创建独立成果并只在当前笔记追加链接", async () => {
  const vault = new MemoryVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");
  const result = await store.create({ title: "最终方案", sourceChat: "Codex Chats/需求讨论.md", relatedNote: "项目.md", content: "采用 app-server。" });
  expect(result.path).toBe("Codex Results/2026-08-15-最终方案.md");
  expect(await vault.read("项目.md")).toContain("[[Codex Results/2026-08-15-最终方案|最终方案]]");
  expect(await vault.read("项目.md")).not.toContain("采用 app-server。");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- transcript-store.test.ts result-store.test.ts`

Expected: FAIL，提示存储类和 `MemoryVault` 尚不存在。

- [ ] **Step 3: 实现可测试文件接口和 Markdown 序列化**

```ts
export interface VaultFiles {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  listMarkdown(directory: string): Promise<string[]>;
}
```

`TranscriptStore.save()` 每次完整重写单个会话文件，使用 YAML 元数据保存 `codex_thread_id`、`related_note`、时间和状态；消息使用 `## 用户`、`## Codex`、`## 系统` 标题。控制器将对流式更新做节流，避免每个字符都写盘。

`ResultStore.create()` 必须先创建 `Codex Results/`，生成不冲突的日期文件名，写入来源元数据和正文，再向当前笔记追加一次唯一链接。

- [ ] **Step 4: 运行存储测试**

Run: `npm test -- transcript-store.test.ts result-store.test.ts`

Expected: 两组测试全部 PASS；临时会话路径和成果路径严格分离。

- [ ] **Step 5: 提交存储层**

```powershell
git add -- plugin/src/platform/vault-files.ts plugin/src/services/transcript-store.ts plugin/src/services/result-store.ts plugin/tests
git commit -m "feat: separate local transcripts from saved results"
```

---

### Task 4: 实现成果选择和精确 Git 提交

**Files:**
- Create: `plugin/src/platform/process-runner.ts`
- Create: `plugin/src/services/git-service.ts`
- Create: `plugin/tests/fake-process-runner.ts`
- Create: `plugin/tests/git-service.test.ts`

- [ ] **Step 1: 编写精确暂存失败测试**

```ts
it("只暂存用户选择的成果", async () => {
  const runner = new FakeProcessRunner().withResult(
    "git",
    ["status", "--porcelain=v1", "-z", "--", "Codex Results"],
    { exitCode: 0, stdout: "?? Codex Results/A.md\0?? Codex Results/B.md\0", stderr: "" }
  );
  const service = new GitService("D:\\Vault", "git", runner);
  const candidates = await service.listCandidates();
  expect(candidates.map(x => x.path)).toEqual(["Codex Results/A.md", "Codex Results/B.md"]);
  await service.commit(["Codex Results/B.md"], "docs: add B result");
  expect(runner.calls).toContainEqual(["git", ["add", "--", "Codex Results/B.md"], "D:\\Vault"]);
  expect(runner.calls).not.toContainEqual(["git", ["add", "--", "Codex Results/A.md"], "D:\\Vault"]);
});

it("拒绝临时会话路径", async () => {
  const service = new GitService("D:\\Vault", "git", new FakeProcessRunner());
  await expect(service.commit(["Codex Chats/A.md"], "bad")).rejects.toThrow("成果目录");
});

it("候选成果启动前已有修改时阻止自动提交", async () => {
  const runner = new FakeProcessRunner().withResult(
    "git",
    ["status", "--porcelain=v1", "-z", "--", "Codex Results"],
    { exitCode: 0, stdout: " M Codex Results/Old.md\0", stderr: "" }
  );
  const service = new GitService("D:\\Vault", "git", runner);
  await service.captureBaseline();
  await expect(service.commit(["Codex Results/Old.md"], "docs: update result")).rejects.toThrow("已有未提交修改");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- git-service.test.ts`

Expected: FAIL，提示 `GitService` 尚不存在。

- [ ] **Step 3: 实现无 shell 进程接口和 Git 服务**

```ts
export interface ProcessResult { exitCode: number; stdout: string; stderr: string; }
export interface ProcessRunner { run(executable: string, args: string[], cwd: string): Promise<ProcessResult>; }
```

`GitService.captureBaseline()` 在插件启动时记录已经处于 dirty 状态的成果路径。`listCandidates()` 使用 `git status --porcelain=v1 -z -- "Codex Results"`。`preview(paths)` 先校验每个路径；已跟踪文件使用 `git diff --no-ext-diff -- paths`，未跟踪成果直接读取完整 Markdown 作为新增文件预览。`commit(paths, message)` 拒绝基线 dirty 的成果、空文件列表和空提交说明，依次执行精确的 `git add -- <paths>` 与 `git commit -m <message> -- <paths>`。

所有进程调用都使用 `spawn(executable, args, { shell: false, cwd })`，不拼接命令字符串。

- [ ] **Step 4: 运行 Git 服务测试**

Run: `npm test -- git-service.test.ts`

Expected: 测试全部 PASS；调用记录中不存在 `Codex Chats/` 或个人笔记路径。

- [ ] **Step 5: 提交 Git 服务**

```powershell
git add -- plugin/src/platform/process-runner.ts plugin/src/services/git-service.ts plugin/tests/fake-process-runner.ts plugin/tests/git-service.test.ts
git commit -m "feat: commit selected result notes only"
```

---

### Task 5: 实现 Codex JSON-RPC 传输层

**Files:**
- Create: `plugin/src/codex/protocol.ts`
- Create: `plugin/src/codex/json-rpc.ts`
- Create: `plugin/tests/json-rpc.test.ts`

- [ ] **Step 1: 编写 JSON-RPC 请求与服务器审批测试**

```ts
it("关联响应并转发服务器请求", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const rpc = new JsonRpcTransport(input, output);
  const request = rpc.request("initialize", { clientInfo: { name: "obsidian-codex-cli", title: "Obsidian Codex CLI", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  const sent = JSON.parse(await readLine(output));
  input.write(JSON.stringify({ id: sent.id, result: { userAgent: "codex", codexHome: "C:/Codex", platformFamily: "windows", platformOs: "windows" } }) + "\n");
  await expect(request).resolves.toMatchObject({ platformOs: "windows" });

  const approval = vi.fn();
  rpc.onServerRequest(approval);
  input.write(JSON.stringify({ id: 9, method: "item/commandExecution/requestApproval", params: { command: "curl example.com" } }) + "\n");
  await vi.waitFor(() => expect(approval).toHaveBeenCalled());
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- json-rpc.test.ts`

Expected: FAIL，提示 JSON-RPC 模块不存在。

- [ ] **Step 3: 定义最小协议类型并实现按行传输**

`protocol.ts` 只定义实际使用的 `initialize`、`thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`item/agentMessage/delta`、`turn/completed`、`item/commandExecution/requestApproval` 和 `item/fileChange/requestApproval`。审批决定只允许 `accept`、`decline`、`cancel`，不暴露 `acceptForSession`。

```ts
export type RequestId = string | number;
export interface RpcRequest { id: RequestId; method: string; params?: unknown; }
export interface RpcNotification { method: string; params?: unknown; }
export interface RpcResponse { id: RequestId; result?: unknown; error?: { code: number; message: string; data?: unknown }; }

export interface AgentMessageDelta { threadId: string; turnId: string; itemId: string; delta: string; }
export interface TurnCompleted { threadId: string; turn: { id: string; status: "completed" | "interrupted" | "failed" | "inProgress"; error: { message?: string } | null }; }
```

`JsonRpcTransport` 使用 `readline.createInterface()` 解析 stdout；请求写入单行 JSON；pending map 按 id 解析；进程关闭时拒绝全部未完成请求；未知通知交给订阅者，未知服务器请求返回 JSON-RPC `-32601`。

- [ ] **Step 4: 运行传输测试**

Run: `npm test -- json-rpc.test.ts`

Expected: 请求、通知、服务器请求、错误响应和进程关闭用例全部 PASS。

- [ ] **Step 5: 提交协议传输层**

```powershell
git add -- plugin/src/codex plugin/tests/json-rpc.test.ts
git commit -m "feat: add Codex app-server JSON-RPC transport"
```

---

### Task 6: 实现 Codex 会话、流式回复和一次性审批

**Files:**
- Create: `plugin/src/codex/codex-client.ts`
- Create: `plugin/tests/fake-rpc.ts`
- Create: `plugin/tests/codex-client.test.ts`

- [ ] **Step 1: 编写线程配置和审批响应失败测试**

```ts
it("以 Vault 沙箱启动线程并禁用网页搜索", async () => {
  const rpc = new FakeRpc();
  const client = new CodexClient(rpc, "D:\\Vault");
  await client.initialize();
  await client.startThread();
  expect(rpc.requests).toContainEqual(expect.objectContaining({
    method: "thread/start",
    params: expect.objectContaining({
      cwd: "D:\\Vault",
      runtimeWorkspaceRoots: ["D:\\Vault"],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      config: { web_search: "disabled" }
    })
  }));
});

it("只发送允许一次或拒绝", async () => {
  const rpc = new FakeRpc();
  const client = new CodexClient(rpc, "D:\\Vault");
  client.onApproval(async () => "allowOnce");
  await rpc.emitServerRequest({ id: 7, method: "item/commandExecution/requestApproval", params: { command: "curl example.com", reason: "network" } });
  expect(rpc.responses).toContainEqual({ id: 7, result: { decision: "accept" } });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- codex-client.test.ts`

Expected: FAIL，提示 `CodexClient` 尚不存在。

- [ ] **Step 3: 实现初始化、线程和回合状态机**

初始化顺序必须为：发送 `initialize`，确认 `platformOs === "windows"`，再发送 `initialized` 通知。线程启动参数固定使用 Vault 工作根、`workspace-write`、`on-request`、`approvalsReviewer: "user"` 和 `web_search: "disabled"`。

`startTurn(text)` 发送：

```ts
{
  threadId,
  input: [{ type: "text", text, text_elements: [] }],
  cwd: vaultRoot,
  runtimeWorkspaceRoots: [vaultRoot]
}
```

收到 `item/agentMessage/delta` 时触发 `messageDelta`；收到 `turn/completed` 时按状态解析成功、中断或失败。`resumeThread(threadId)` 必须重新覆盖 cwd、workspace roots、审批人和沙箱。`interrupt()` 使用当前 threadId 和 turnId 发送 `turn/interrupt`。

`CodexClient.fromExecutable()` 必须使用以下无 shell 启动方式，并把进程 stdout/stdin 交给 `JsonRpcTransport`：

```ts
spawn(codexPath, ["app-server", "--listen", "stdio://"], {
  cwd: vaultRoot,
  shell: false,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"]
});
```

同时提供 `fromChildProcess()`，供假 app-server 集成测试注入已启动的子进程。

- [ ] **Step 4: 实现审批映射和未知请求拒绝**

命令审批和文件变更审批都映射为统一 `ApprovalPrompt`。UI 返回 `allowOnce` 时响应 `{ decision: "accept" }`，返回 `deny` 时响应 `{ decision: "decline" }`。服务器请求超出这两类时返回 JSON-RPC `-32601`，不得自动授权。

- [ ] **Step 5: 运行 Codex 客户端测试**

Run: `npm test -- codex-client.test.ts`

Expected: 初始化、启动、恢复、流式消息、完成、中断、允许一次、拒绝和未知请求测试全部 PASS。

- [ ] **Step 6: 提交 Codex 客户端**

```powershell
git add -- plugin/src/codex/codex-client.ts plugin/tests/fake-rpc.ts plugin/tests/codex-client.test.ts
git commit -m "feat: manage Codex threads and one-time approvals"
```

---

### Task 7: 实现健康检查和本地设置

**Files:**
- Create: `plugin/src/services/health-check.ts`
- Create: `plugin/src/settings.ts`
- Create: `plugin/tests/health-check.test.ts`

- [ ] **Step 1: 编写版本、登录和 Git 检查失败测试**

```ts
it("只有 Codex 0.147.0 才允许聊天", async () => {
  const runner = new FakeProcessRunner()
    .withResult("codex.cmd", ["--version"], { exitCode: 0, stdout: "codex-cli 0.147.0\n", stderr: "" })
    .withResult("codex.cmd", ["login", "status"], { exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" })
    .withResult("git", ["--version"], { exitCode: 0, stdout: "git version 2.55.0.windows.1\n", stderr: "" })
    .withResult("git", ["rev-parse", "--show-toplevel"], { exitCode: 0, stdout: "D:/Vault\n", stderr: "" });
  const status = await new HealthCheck(runner).run({ vaultRoot: "D:\\Vault", codexPath: "codex.cmd", gitPath: "git" });
  expect(status.readyToChat).toBe(true);
  expect(status.readyToCommit).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- health-check.test.ts`

Expected: FAIL，提示 `HealthCheck` 尚不存在。

- [ ] **Step 3: 实现精确兼容性检查**

健康检查并行读取 `codex.cmd --version`、`codex.cmd login status`、`git --version`，随后用 `git rev-parse --show-toplevel` 验证仓库。版本正则必须是 `/^codex-cli 0\.147\.0$/m`。聊天只依赖 Windows、兼容 Codex 和登录；成果提交还依赖 Git 与仓库。

默认 Codex 路径为 `%APPDATA%\npm\codex.cmd`，默认 Git 路径为 `git`。设置页允许覆盖两者，并提供“重新检查”按钮。设置对象只包含：

```ts
export interface CodexPluginSettings { codexPath: string; gitPath: string; }
```

- [ ] **Step 4: 运行健康检查测试**

Run: `npm test -- health-check.test.ts`

Expected: 兼容、版本不符、未登录、Git 缺失和非仓库用例全部 PASS。

- [ ] **Step 5: 提交健康检查与设置**

```powershell
git add -- plugin/src/services/health-check.ts plugin/src/settings.ts plugin/tests/health-check.test.ts
git commit -m "feat: validate Codex login version and Git"
```

---

### Task 8: 实现上下文去重和聊天控制器

**Files:**
- Create: `plugin/src/services/context-service.ts`
- Create: `plugin/src/chat-controller.ts`
- Create: `plugin/tests/context-service.test.ts`
- Create: `plugin/tests/chat-controller.test.ts`

- [ ] **Step 1: 编写上下文只发送一次的失败测试**

```ts
it("首轮发送当前笔记，未变化时不重复发送", async () => {
  const context = new ContextService();
  expect(context.compose("项目.md", "# 项目", "第一问")).toContain("# 项目");
  expect(context.compose("项目.md", "# 项目", "第二问")).toBe("第二问");
  expect(context.compose("项目.md", "# 项目\n更新", "第三问")).toContain("更新");
});
```

- [ ] **Step 2: 编写“先落盘再发送”的控制器失败测试**

```ts
it("用户消息保存成功后才调用 Codex", async () => {
  const order: string[] = [];
  const transcripts = fakeTranscriptStore({ onSave: () => order.push("save") });
  const codex = fakeCodexClient({ onStartTurn: () => order.push("send") });
  const controller = new ChatController({ transcripts, results: fakeResultStore(), context: new ContextService(), codex });
  await controller.send("问题");
  expect(order).toEqual(["save", "send"]);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- context-service.test.ts chat-controller.test.ts`

Expected: FAIL，提示上下文服务和控制器不存在。

- [ ] **Step 4: 实现哈希去重和控制器状态机**

`ContextService` 使用 SHA-256 记录 `notePath + "\0" + content`。首次或哈希变化时发送带边界标记的当前笔记内容，否则只发送用户文本。

`ChatController` 公开 `startChat(activeNote)`、`resumeChat(session)`、`send(text)`、`stop()`、`saveResult(entryId, editedTitle, editedContent)` 和 `commitResults(paths, message)`。发送顺序固定为：添加用户消息、保存会话、组合上下文、启动回合、累积 delta、每 250ms 节流保存、完成后立即保存。任何错误都写入 system 条目并把会话标记为 `failed`。

- [ ] **Step 5: 运行控制器测试**

Run: `npm test -- context-service.test.ts chat-controller.test.ts`

Expected: 首轮上下文、内容变化、先保存后发送、流式节流、恢复、停止、保存成果和失败落盘全部 PASS。

- [ ] **Step 6: 提交控制器**

```powershell
git add -- plugin/src/services/context-service.ts plugin/src/chat-controller.ts plugin/tests/context-service.test.ts plugin/tests/chat-controller.test.ts
git commit -m "feat: orchestrate durable context-aware chats"
```

---

### Task 9: 构建 Obsidian 侧边栏、审批和成果提交界面

**Files:**
- Create: `plugin/src/ui/view-model.ts`
- Create: `plugin/src/ui/chat-view.ts`
- Create: `plugin/src/ui/modals.ts`
- Modify: `plugin/src/settings.ts`
- Modify: `plugin/src/main.ts`
- Modify: `plugin/styles.css`
- Create: `plugin/tests/view-model.test.ts`

- [ ] **Step 1: 编写纯视图模型测试**

```ts
it("运行中禁用发送并启用停止", () => {
  expect(deriveControls({ healthReady: true, hasActiveNote: true, running: true })).toEqual({ canSend: false, canStop: true, canSaveResult: false });
});

it("提交列表只保留成果目录", () => {
  expect(filterResultCandidates(["Codex Results/A.md", "Codex Chats/B.md", "项目.md"])).toEqual(["Codex Results/A.md"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- view-model.test.ts`

Expected: FAIL，提示视图模型函数不存在。

- [ ] **Step 3: 实现右侧栏和原生控件**

`ChatView extends ItemView`，视图类型固定为 `obsidian-codex-cli-chat`。工具栏使用 Obsidian `setIcon()`：新会话、恢复、停止、刷新健康状态、成果列表和提交。文本框支持 `Ctrl+Enter` 发送。每条 Codex 完成回复提供“保存为成果”，运行期间按钮尺寸保持固定，不因文本变化导致布局移动。

界面必须使用 Obsidian CSS 变量；卡片圆角不超过 8px；窄侧栏中按钮文字可换行但不得重叠。界面不显示教程式说明，只显示当前状态和可执行命令。

- [ ] **Step 4: 实现三个确认弹窗**

- `ApprovalModal`：显示操作、路径或命令、原因；按钮只有“允许一次”和“拒绝”。关闭弹窗等同拒绝。
- `SaveResultModal`：可编辑标题和正文；确认后创建成果及当前笔记链接。
- `CommitResultsModal`：复选成果文件，显示 diff，可编辑 commit message；最终确认前不运行 Git 写操作。

- [ ] **Step 5: 注册插件生命周期**

`main.ts` 必须注册视图、侧栏图标、打开面板命令和设置页；`onload()` 加载本地设置并执行健康检查；`onunload()` 取消活动回合、关闭 JSON-RPC、终止 app-server 子进程。Obsidian 文件适配器只能使用 Vault API 写笔记，不能绕过 Vault API 直接改 Markdown。

- [ ] **Step 6: 运行视图模型测试、类型检查和构建**

Run: `npm test -- view-model.test.ts; npm run typecheck; npm run build`

Expected: 测试 PASS；类型检查退出码 `0`；插件运行产物生成成功。

- [ ] **Step 7: 提交 UI**

```powershell
git add -- plugin/src/ui plugin/src/settings.ts plugin/src/main.ts plugin/styles.css plugin/tests/view-model.test.ts
git commit -m "feat: add Obsidian chat approvals and result UI"
```

---

### Task 10: 增加真实 Git、假 app-server 和安装验收

**Files:**
- Create: `plugin/tests/fixtures/fake-app-server.cjs`
- Create: `plugin/tests/codex-process.integration.test.ts`
- Create: `plugin/tests/git.integration.test.ts`
- Create: `docs/testing/obsidian-codex-cli-acceptance.md`
- Modify: `plugin/package.json`

- [ ] **Step 1: 创建可执行的假 app-server**

`fake-app-server.cjs` 从 stdin 逐行读取 JSON，请求 `initialize` 时返回 Windows 初始化结果，`thread/start` 返回固定 thread id，`turn/start` 依次发送 `item/agentMessage/delta` 和 `turn/completed`。收到包含 `APPROVAL` 的用户消息时，先发送 `item/commandExecution/requestApproval`，并验证客户端只响应 `accept` 或 `decline`。

- [ ] **Step 2: 编写子进程集成测试**

```ts
it("通过真实 stdio 子进程完成一个回合", async () => {
  const process = spawn(process.execPath, [fixturePath("fake-app-server.cjs")], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const client = CodexClient.fromChildProcess(process, "D:\\Vault");
  await client.initialize();
  const thread = await client.startThread();
  const text = await collectTurn(client, thread.id, "hello");
  expect(text).toBe("fake response");
});
```

- [ ] **Step 3: 编写真实临时 Git 仓库测试**

测试在系统临时目录创建明确的子目录并验证：`.gitignore` 忽略 `Codex Chats/` 和个人笔记；两个成果均能出现在候选列表；只选择一个成果后 commit 只包含该文件；另一个成果保持未提交。测试结束只删除自己创建的临时子目录。

- [ ] **Step 4: 运行完整自动化验证**

Run: `cd D:\My_DateBase\Obsidian_CodexCli\plugin; npm run verify`

Expected: 类型检查 PASS；全部单元与集成测试 PASS；生产构建 PASS。

- [ ] **Step 5: 验证真实 Codex 只进行握手**

运行插件的健康检查测试入口，启动本机 `codex.cmd app-server --listen stdio://`，完成 `initialize` 和 `initialized` 后立即关闭，不发送模型回合、不产生网络用量。

Expected: 返回 `platformOs: "windows"`，协议握手通过，子进程正常结束。

- [ ] **Step 6: 编写并执行 Obsidian 手工验收清单**

验收文档必须逐项记录：插件加载；当前笔记会话；`Codex Chats/` 本地保存且 Git 忽略；重启恢复；命令或 Vault 外操作弹窗；允许一次与拒绝；保存成果；当前笔记只出现链接；成果列表可打开；只提交被选成果；无关修改未暂存。

- [ ] **Step 7: 提交测试和验收文档**

```powershell
git add -- plugin/tests plugin/package.json docs/testing/obsidian-codex-cli-acceptance.md
git commit -m "test: verify Codex process and selective result commits"
```

---

### Task 11: 最终版本检查与项目提交

**Files:**
- Modify: `plugin/manifest.json`
- Modify: `docs/superpowers/specs/2026-08-15-obsidian-codex-cli-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-obsidian-codex-cli-implementation.md`

- [ ] **Step 1: 运行最终验证**

Run: `cd D:\My_DateBase\Obsidian_CodexCli\plugin; npm run verify`

Expected: 所有命令退出码为 `0`。

- [ ] **Step 2: 检查仓库纯净边界**

Run: `git -C D:\My_DateBase\Obsidian_CodexCli status --short --ignored`

Expected: `Codex Chats/`、个人笔记、`.obsidian/`、`node_modules/` 和本地设置显示为 ignored；源码、测试、文档和 `Codex Results/` 成果保持可跟踪。

- [ ] **Step 3: 检查没有危险参数和越界暂存代码**

Run: `rg -n "dangerously-bypass|danger-full-access|acceptForSession|git push|Codex Chats.*git add" D:\My_DateBase\Obsidian_CodexCli\plugin`

Expected: 无匹配；如果测试夹具需要断言这些字符串，匹配只能出现在测试的拒绝断言中。

- [ ] **Step 4: 更新版本和文档状态**

把 `manifest.json` 版本保持为 `0.1.0`，把设计与计划状态更新为“已实现并通过验收”，并在验收文档记录真实命令结果和未完成项。不得在验证失败时标记完成。

- [ ] **Step 5: 提交最终状态**

```powershell
git add -- plugin/manifest.json docs
git commit -m "chore: finalize Obsidian Codex CLI 0.1.0"
git status --short --branch
```

Expected: commit 成功，最终状态只显示 `## main`。
