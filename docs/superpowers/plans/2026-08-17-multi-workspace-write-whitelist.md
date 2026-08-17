# Multi-Workspace Write Whitelist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Obsidian Codex CLI 增加独立的多工作区和写入白名单管理，使本机保持全盘只读、白名单路径默认可写、其他写入继续逐次审批。

**Architecture:** 用独立路径策略服务解析 Windows 真实路径并验证“白名单必须位于工作区内”；设置页通过两个管理弹窗编辑列表；`CodexClient` 将当前 Vault 与额外工作区作为运行根，并把白名单真实路径生成为权限档案中的精确 `write` 规则。设置保存或路径失效时关闭旧运行时，下一回合重新校验并使用新权限。

**Tech Stack:** Windows 桌面版 Obsidian、TypeScript 7.0.2、Node.js `fs/promises` 与 `path.win32`、Vitest 4.1.10、esbuild 0.28.2、Codex CLI 0.147.0 `app-server`。

> 当前 Vault 的 `AGENTS.md` 禁止由插件会话执行 `git add`、`git commit` 或 `git push`。本计划用 `git diff --check` 和文件范围检查替代每个任务后的提交步骤；实施过程中不创建提交。

---

## 文件结构

- Create: `plugin/src/services/workspace-policy.ts`：路径探测、规范化、去重、包含关系和完整设置校验。
- Create: `plugin/tests/workspace-policy.test.ts`：覆盖 Windows 路径、真实路径、目录联接语义和失效路径。
- Create: `plugin/src/plugin-settings.ts`：无 Obsidian 运行时依赖的设置类型、默认值和旧数据迁移。
- Create: `plugin/tests/plugin-settings.test.ts`：覆盖空列表默认值和迁移行为。
- Create: `plugin/src/ui/workspace-modals.ts`：工作区与白名单两个管理弹窗。
- Modify: `plugin/src/settings.ts`：显示两个管理入口并连接设置控制器。
- Modify: `plugin/src/codex/codex-client.ts`：接收已解析工作区访问配置并生成线程、回合和权限参数。
- Modify: `plugin/tests/codex-client.test.ts`：锁定多根目录、白名单写规则及原有安全字段。
- Modify: `plugin/tests/codex-process.integration.test.ts`：验证真实 `app-server` 接受多根与绝对白名单规则。
- Modify: `plugin/src/main.ts`：加载迁移后的设置、保存前校验、启动前复验并重建运行时。
- Modify: `plugin/styles.css`：管理弹窗的稳定列表布局、错误与警告样式。
- Modify: `README.md`：记录工作区和白名单的使用方式与安全边界。
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`：新增自动与桌面验收项。

### Task 1: 实现 Windows 工作区路径策略

**Files:**
- Create: `plugin/src/services/workspace-policy.ts`
- Create: `plugin/tests/workspace-policy.test.ts`

- [ ] **Step 1: 写路径校验失败测试**

创建 `plugin/tests/workspace-policy.test.ts`，使用可控的 `FakePathInspector` 表达输入路径到真实路径和文件类型的映射：

```ts
import { describe, expect, it } from "vitest";

import {
  WorkspacePolicy,
  type PathInfo,
  type PathInspector
} from "../src/services/workspace-policy.js";

class FakePathInspector implements PathInspector {
  private readonly entries = new Map<string, PathInfo>();

  add(input: string, realPath: string, kind: PathInfo["kind"]): this {
    this.entries.set(input, { realPath, kind });
    return this;
  }

  async inspect(path: string): Promise<PathInfo> {
    const entry = this.entries.get(path);
    if (entry === undefined) {
      throw new Error(`路径不存在: ${path}`);
    }
    return entry;
  }
}

describe("WorkspacePolicy", () => {
  it("解析、去重工作区并接受工作区内白名单", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\Repo", "D:\\Repo", "directory")
      .add("d:\\repo\\", "D:\\Repo", "directory")
      .add("D:\\Repo\\Assets", "D:\\Repo\\Assets", "directory");
    const policy = new WorkspacePolicy(inspector);

    await expect(policy.resolve(
      ["D:\\Repo", "d:\\repo\\"],
      ["D:\\Repo\\Assets"]
    )).resolves.toEqual({
      workspaceRoots: ["D:\\Repo"],
      writablePaths: ["D:\\Repo\\Assets"]
    });
  });

  it("不把相似目录名前缀视为子目录", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\Project", "D:\\Project", "directory")
      .add("D:\\Project2", "D:\\Project2", "directory");

    await expect(new WorkspacePolicy(inspector).resolve(
      ["D:\\Project"],
      ["D:\\Project2"]
    )).rejects.toThrow("不属于任何工作区");
  });

  it("按真实路径阻止目录联接逃逸", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\Repo", "D:\\Repo", "directory")
      .add("D:\\Repo\\Linked", "E:\\Outside", "directory");

    await expect(new WorkspacePolicy(inspector).resolve(
      ["D:\\Repo"],
      ["D:\\Repo\\Linked"]
    )).rejects.toThrow("不属于任何工作区");
  });

  it("工作区只接受目录，白名单只接受文件或目录", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\file.txt", "D:\\file.txt", "file")
      .add("D:\\Repo", "D:\\Repo", "directory")
      .add("D:\\Repo\\pipe", "D:\\Repo\\pipe", "other");

    const policy = new WorkspacePolicy(inspector);
    await expect(policy.resolve(["D:\\file.txt"], [])).rejects.toThrow("工作区必须是目录");
    await expect(policy.resolve(["D:\\Repo"], ["D:\\Repo\\pipe"]))
      .rejects.toThrow("白名单必须是文件或目录");
  });

  it("拒绝相对路径和失效路径", async () => {
    const policy = new WorkspacePolicy(new FakePathInspector());
    await expect(policy.resolve(["relative\\repo"], [])).rejects.toThrow("必须是绝对路径");
    await expect(policy.resolve(["D:\\Missing"], [])).rejects.toThrow("路径不存在");
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'
& 'C:\Program Files\nodejs\npm.cmd' test -- workspace-policy.test.ts
```

Expected: FAIL，错误为找不到 `src/services/workspace-policy.js`。

- [ ] **Step 3: 实现最小路径策略**

创建 `plugin/src/services/workspace-policy.ts`：

```ts
import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";

export interface PathInfo {
  realPath: string;
  kind: "file" | "directory" | "other";
}

export interface PathInspector {
  inspect(path: string): Promise<PathInfo>;
}

export interface ResolvedWorkspaceAccess {
  workspaceRoots: string[];
  writablePaths: string[];
}

export class NodePathInspector implements PathInspector {
  async inspect(path: string): Promise<PathInfo> {
    let resolved: string;
    try {
      resolved = await realpath(path);
    } catch {
      throw new Error(`路径不存在或无法访问: ${path}`);
    }
    const status = await stat(resolved);
    const kind = status.isDirectory() ? "directory" : status.isFile() ? "file" : "other";
    return { realPath: normalizeWindowsPath(resolved), kind };
  }
}

export class WorkspacePolicy {
  constructor(private readonly inspector: PathInspector = new NodePathInspector()) {}

  async resolve(workspaceRoots: string[], writablePaths: string[]): Promise<ResolvedWorkspaceAccess> {
    const roots = await this.resolveMany(workspaceRoots, "workspace");
    const writable = await this.resolveMany(writablePaths, "writable");
    for (const path of writable) {
      if (!roots.some((root) => isWithinWindowsPath(root, path))) {
        throw new Error(`白名单路径不属于任何工作区: ${path}`);
      }
    }
    return { workspaceRoots: roots, writablePaths: writable };
  }

  private async resolveMany(paths: string[], role: "workspace" | "writable"): Promise<string[]> {
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const input of paths) {
      if (!win32.isAbsolute(input.trim())) {
        throw new Error(`路径必须是绝对路径: ${input}`);
      }
      const info = await this.inspector.inspect(input.trim());
      if (role === "workspace" && info.kind !== "directory") {
        throw new Error(`工作区必须是目录: ${input}`);
      }
      if (role === "writable" && info.kind !== "file" && info.kind !== "directory") {
        throw new Error(`白名单必须是文件或目录: ${input}`);
      }
      const path = normalizeWindowsPath(info.realPath);
      const key = path.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push(path);
      }
    }
    return resolved;
  }
}

export function normalizeWindowsPath(path: string): string {
  const normalized = win32.normalize(path.trim());
  const root = win32.parse(normalized).root;
  return normalized === root ? normalized : normalized.replace(/[\\/]+$/, "");
}

export function isWithinWindowsPath(root: string, candidate: string): boolean {
  const relative = win32.relative(normalizeWindowsPath(root), normalizeWindowsPath(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${win32.sep}`) &&
    !win32.isAbsolute(relative)
  );
}
```

- [ ] **Step 4: 运行目标测试并确认 GREEN**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- workspace-policy.test.ts`

Expected: `workspace-policy.test.ts` 全部通过。

- [ ] **Step 5: 检查任务文件范围**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git diff --check -- plugin/src/services/workspace-policy.ts plugin/tests/workspace-policy.test.ts
```

Expected: 无输出。

### Task 2: 增加设置类型、默认值和旧数据迁移

**Files:**
- Create: `plugin/src/plugin-settings.ts`
- Create: `plugin/tests/plugin-settings.test.ts`
- Modify: `plugin/src/settings.ts`
- Modify: `plugin/src/main.ts`

- [ ] **Step 1: 写设置迁移失败测试**

创建 `plugin/tests/plugin-settings.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { normalizePluginSettings } from "../src/plugin-settings.js";

describe("normalizePluginSettings", () => {
  it("旧设置迁移为两个独立空列表", () => {
    expect(normalizePluginSettings({ codexPath: "codex.cmd", gitPath: "git" })).toEqual({
      codexPath: "codex.cmd",
      gitPath: "git",
      workspaceRoots: [],
      writablePaths: []
    });
  });

  it("每次规范化都返回新的数组", () => {
    const first = normalizePluginSettings(null);
    const second = normalizePluginSettings(null);
    first.workspaceRoots.push("D:\\Repo");
    expect(second.workspaceRoots).toEqual([]);
  });

  it("丢弃数组中的非字符串值", () => {
    expect(normalizePluginSettings({
      workspaceRoots: ["D:\\Repo", 3],
      writablePaths: [null, "D:\\Repo\\Assets"]
    })).toMatchObject({
      workspaceRoots: ["D:\\Repo"],
      writablePaths: ["D:\\Repo\\Assets"]
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- plugin-settings.test.ts`

Expected: FAIL，错误为找不到 `src/plugin-settings.js`。

- [ ] **Step 3: 创建无 Obsidian 依赖的设置模块**

创建 `plugin/src/plugin-settings.ts`：

```ts
import { join } from "node:path";

export interface CodexPluginSettings {
  codexPath: string;
  gitPath: string;
  workspaceRoots: string[];
  writablePaths: string[];
}

export function normalizePluginSettings(value: unknown): CodexPluginSettings {
  const input = isRecord(value) ? value : {};
  return {
    codexPath: typeof input.codexPath === "string"
      ? input.codexPath
      : join(process.env.APPDATA ?? "%APPDATA%", "npm", "codex.cmd"),
    gitPath: typeof input.gitPath === "string" ? input.gitPath : "git",
    workspaceRoots: stringArray(input.workspaceRoots),
    writablePaths: stringArray(input.writablePaths)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

在 `plugin/src/settings.ts` 删除本地设置接口和 `DEFAULT_SETTINGS`，改为导入并重新导出 `CodexPluginSettings`；`plugin/src/main.ts` 的 `onload()` 改为：

```ts
this.settings = normalizePluginSettings(await this.loadData());
```

类字段初始化改为：

```ts
settings: CodexPluginSettings = normalizePluginSettings(null);
```

- [ ] **Step 4: 重跑设置测试和类型检查**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test -- plugin-settings.test.ts
& 'C:\Program Files\nodejs\npm.cmd' run typecheck
```

Expected: 设置测试与类型检查通过。

### Task 3: 让 CodexClient 生成多工作区与白名单权限

**Files:**
- Modify: `plugin/src/codex/codex-client.ts`
- Modify: `plugin/tests/codex-client.test.ts`
- Modify: `plugin/tests/codex-process.integration.test.ts`

- [ ] **Step 1: 写多工作区配置失败测试**

在 `plugin/tests/codex-client.test.ts` 新增用例，并把现有单 Vault 断言保留为回归测试：

```ts
it("把额外工作区和白名单用于线程与每次回合", async () => {
  const rpc = new FakeRpc();
  const client = new CodexClient(rpc, "D:\\Vault", null, {
    workspaceRoots: ["D:\\Vault", "D:\\Repo"],
    writablePaths: ["D:\\Repo\\Assets", "D:\\Repo\\ProjectSettings"]
  });
  await client.initialize();
  await client.startThread();

  expect(rpc.requests.find((request) => request.method === "thread/start")?.params)
    .toMatchObject({
      cwd: "D:\\Vault",
      runtimeWorkspaceRoots: ["D:\\Vault", "D:\\Repo"],
      config: {
        web_search: "disabled",
        permissions: {
          "obsidian-vault": {
            filesystem: {
              ":root": "read",
              "D:\\Repo\\Assets": "write",
              "D:\\Repo\\ProjectSettings": "write"
            },
            network: { enabled: false }
          }
        }
      }
    });

  const turn = client.startTurn("检查两个目录");
  await vi.waitFor(() => expect(rpc.requests).toContainEqual({
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "检查两个目录", text_elements: [] }],
      cwd: "D:\\Vault",
      runtimeWorkspaceRoots: ["D:\\Vault", "D:\\Repo"]
    }
  }));
  rpc.emitNotification({
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } }
  });
  await turn;
});
```

同时为 `resumeThread()` 增加相同的 `runtimeWorkspaceRoots` 和 `filesystem` 断言。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- codex-client.test.ts`

Expected: FAIL，现有构造函数不接受工作区访问参数，或实际线程配置仍只有 Vault。

- [ ] **Step 3: 最小化扩展 CodexClient**

在 `plugin/src/codex/codex-client.ts` 导入 `ResolvedWorkspaceAccess`，保留现有调用兼容性：

```ts
const EMPTY_WORKSPACE_ACCESS: ResolvedWorkspaceAccess = {
  workspaceRoots: [],
  writablePaths: []
};

constructor(
  private readonly rpc: CodexRpc,
  private readonly vaultRoot: string,
  private readonly childProcess: ChildProcessWithoutNullStreams | null = null,
  private readonly workspaceAccess: ResolvedWorkspaceAccess = EMPTY_WORKSPACE_ACCESS
) { /* 保留现有事件注册 */ }
```

让 `fromExecutable` 和 `fromChildProcess` 接受可选 `workspaceAccess` 并传给构造函数。新增两个私有方法：

```ts
private runtimeWorkspaceRoots(): string[] {
  const roots = [this.vaultRoot, ...this.workspaceAccess.workspaceRoots];
  return roots.filter((path, index) =>
    roots.findIndex((candidate) => candidate.toLowerCase() === path.toLowerCase()) === index
  );
}

private filesystemPermissions(): Record<string, "read" | "write"> {
  return Object.fromEntries([
    [":root", "read"],
    ...this.workspaceAccess.writablePaths.map((path) => [path, "write"] as const)
  ]);
}
```

在线程新建、线程恢复和 `turn/start` 中统一调用 `runtimeWorkspaceRoots()`；权限档案的 `filesystem` 改为 `this.filesystemPermissions()`，其他安全字段保持不变。

- [ ] **Step 4: 重跑 CodexClient 测试**

Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- codex-client.test.ts`

Expected: 全部通过，现有审批、回合和单 Vault 测试不回退。

- [ ] **Step 5: 扩展真实进程握手测试**

修改 `plugin/tests/codex-process.integration.test.ts` 中权限档案握手用例，使用测试时已经存在的 Vault 目录作为工作区和白名单，避免给真实测试写入不存在路径：

```ts
const root = resolve(process.cwd(), "..");
const client = CodexClient.fromExecutable(codexPath, root, {
  workspaceRoots: [root],
  writablePaths: [resolve(root, "Codex Results")]
});
```

Run:

```powershell
$env:RUN_CODEX_HANDSHAKE = '1'
$env:CODEX_PATH = "$env:APPDATA\npm\codex.cmd"
& 'C:\Program Files\nodejs\npm.cmd' test -- codex-process.integration.test.ts
Remove-Item Env:RUN_CODEX_HANDSHAKE
Remove-Item Env:CODEX_PATH
```

Expected: 本机 `app-server` 接受含额外根和绝对白名单 `write` 规则的权限档案；若本机缺少精确 `0.147.0`，记录环境阻塞，不改测试预期。

### Task 4: 实现工作区与白名单管理弹窗

**Files:**
- Create: `plugin/src/ui/workspace-modals.ts`
- Modify: `plugin/src/settings.ts`
- Modify: `plugin/styles.css`

- [ ] **Step 1: 扩展设置控制器契约并确认类型检查失败**

在 `plugin/src/settings.ts` 的 `SettingsController` 增加：

```ts
resolveWorkspaceAccess(settings: CodexPluginSettings): Promise<ResolvedWorkspaceAccess>;
```

Run: `& 'C:\Program Files\nodejs\npm.cmd' run typecheck`

Expected: FAIL，`ObsidianCodexCliPlugin` 尚未实现 `resolveWorkspaceAccess`。

- [ ] **Step 2: 创建两个独立管理弹窗**

创建 `plugin/src/ui/workspace-modals.ts`，导出 `WorkspaceRootsModal` 与 `WritablePathsModal`。两个弹窗都：

- 复制传入数组作为草稿，关闭不保存。
- 使用单行绝对路径输入、添加按钮、稳定高度列表、每行移除按钮。
- 每次添加或移除后调用 `validate`，只在成功后更新草稿。
- 捕获错误并使用 `Notice(errorMessage(error))` 显示具体原因。
- 点击保存时调用 `onSave`，成功后关闭。

公共构造参数使用以下类型，避免弹窗直接持有插件实例：

```ts
export interface WorkspaceModalOptions {
  settings: CodexPluginSettings;
  validate(settings: CodexPluginSettings): Promise<ResolvedWorkspaceAccess>;
  save(settings: CodexPluginSettings): Promise<void>;
}
```

`WritablePathsModal.onOpen()` 在列表前创建可见警告：

```ts
this.contentEl.createDiv({
  cls: "codex-permission-warning",
  text: "白名单内允许创建、修改、重命名和删除，执行时不会显示审批弹窗。"
});
```

每个弹窗保存时使用校验返回的真实路径覆盖草稿：

```ts
const resolved = await this.options.validate(nextSettings);
await this.options.save({
  ...nextSettings,
  workspaceRoots: resolved.workspaceRoots,
  writablePaths: resolved.writablePaths
});
```

- [ ] **Step 3: 在插件设置页添加两个入口**

在 `CodexSettingTab.display()` 中增加：

```ts
new Setting(this.containerEl)
  .setName("工作区")
  .setDesc(`${this.controller.settings.workspaceRoots.length} 个额外工作区`)
  .addButton((button) => button.setButtonText("管理工作区").onClick(() => {
    new WorkspaceRootsModal(this.app, modalOptions(this.controller)).open();
  }));

new Setting(this.containerEl)
  .setName("写入白名单")
  .setDesc(`${this.controller.settings.writablePaths.length} 个默认可写路径`)
  .addButton((button) => button.setButtonText("管理白名单").onClick(() => {
    new WritablePathsModal(this.app, modalOptions(this.controller)).open();
  }));
```

`modalOptions()` 每次读取控制器当前设置，调用 `resolveWorkspaceAccess()`，并通过 `updateSettings()` 保存完整设置。

- [ ] **Step 4: 增加管理弹窗样式**

在 `plugin/styles.css` 增加：

```css
.codex-path-list {
  display: grid;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  margin: 12px 0;
}

.codex-path-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.codex-path-value {
  overflow-wrap: anywhere;
}

.codex-permission-warning {
  margin-bottom: 12px;
  color: var(--text-warning);
}
```

- [ ] **Step 5: 运行类型检查和生产构建**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run typecheck
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: 类型检查和构建通过；安装产物包含两个管理按钮、弹窗标题和白名单警告文本。

### Task 5: 把校验后的访问配置接入主插件生命周期

**Files:**
- Modify: `plugin/src/main.ts`
- Modify: `plugin/src/settings.ts`
- Test: `plugin/tests/workspace-policy.test.ts`
- Test: `plugin/tests/codex-client.test.ts`

- [ ] **Step 1: 实现设置控制器的路径解析方法**

在 `ObsidianCodexCliPlugin` 增加单一策略实例：

```ts
private readonly workspacePolicy = new WorkspacePolicy();
```

实现设置控制器方法：

```ts
async resolveWorkspaceAccess(settings: CodexPluginSettings): Promise<ResolvedWorkspaceAccess> {
  return this.workspacePolicy.resolve(settings.workspaceRoots, settings.writablePaths);
}
```

- [ ] **Step 2: 保存前校验并持久化真实路径**

把 `updateSettings()` 的开头改为：

```ts
const resolved = await this.resolveWorkspaceAccess(settings);
this.settings = {
  ...settings,
  workspaceRoots: resolved.workspaceRoots,
  writablePaths: resolved.writablePaths
};
await this.saveData(this.settings);
```

保留后续 `shutdownRuntime()`、Git 服务失效、健康状态清空和视图刷新行为。

- [ ] **Step 3: 启动运行时前复验并传给 CodexClient**

在 `ensureRuntime()` 创建 Codex 客户端前解析当前设置：

```ts
const workspaceAccess = await this.resolveWorkspaceAccess(this.settings);
const codex = CodexClient.fromExecutable(
  this.settings.codexPath,
  this.vaultRoot,
  workspaceAccess
);
```

这样路径在保存后被删除、移动或改成目录联接时，会在启动新运行时前安全失败并显示路径错误。

- [ ] **Step 4: 运行相关回归测试**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test -- workspace-policy.test.ts plugin-settings.test.ts codex-client.test.ts
& 'C:\Program Files\nodejs\npm.cmd' run typecheck
```

Expected: 全部通过；设置变更仍调用现有 `shutdownRuntime()`，聊天和成果存储代码未改变。

### Task 6: 更新说明、完整验证和桌面验收

**Files:**
- Modify: `README.md`
- Modify: `docs/testing/obsidian-codex-cli-acceptance.md`
- Verify: `.obsidian/plugins/obsidian-codex-cli/main.js`

- [ ] **Step 1: 更新用户说明**

在 `README.md` 的“权限审批”“使用说明”“权限与隐私”和“当前限制”中明确：

- 工作区与白名单分别通过插件设置中的独立弹窗管理。
- 工作区用于把多个目录加入同一 Codex 会话。
- 白名单必须位于工作区内，且其中创建、修改、重命名和删除不弹窗。
- 本机其他路径保持只读，未命中白名单的写入仍可逐次审批。
- 工作区外写入也会弹窗，这是保留全盘读取后的已确认边界。

- [ ] **Step 2: 更新验收清单**

在 `docs/testing/obsidian-codex-cli-acceptance.md` 添加未勾选项：

```markdown
- [ ] 工作区和白名单设置默认均为空，旧设置可无损迁移。
- [ ] 新建、恢复和每次回合均使用当前 Vault 与所有额外工作区。
- [ ] 权限档案仅对白名单真实路径授予 `write`。
- [ ] 两个不同目录可在同一会话中读取和检索。
- [ ] 白名单内创建、修改、重命名和删除不显示审批弹窗。
- [ ] 工作区内非白名单写入显示审批弹窗。
- [ ] 工作区外写入显示审批弹窗。
- [ ] 移除白名单后，同一路径写入恢复审批弹窗。
```

只把自动测试实际证明的前三项改为 `[x]`；桌面行为在用户亲自观察前保持 `[ ]`。

- [ ] **Step 3: 运行完整自动验证**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli\plugin'
& 'C:\Program Files\nodejs\npm.cmd' run verify
```

Expected: TypeScript 类型检查、全部 Vitest 测试和生产构建通过；构建更新当前 Vault 的本地插件产物。

- [ ] **Step 4: 检查构建产物包含新权限且保留安全字段**

Run:

```powershell
$bundlePath = 'D:\My_DateBase\Obsidian_CodexCli\.obsidian\plugins\obsidian-codex-cli\main.js'
Select-String -LiteralPath $bundlePath -SimpleMatch 'workspaceRoots'
Select-String -LiteralPath $bundlePath -SimpleMatch 'writablePaths'
Select-String -LiteralPath $bundlePath -SimpleMatch 'approvalPolicy: "on-request"'
Select-String -LiteralPath $bundlePath -SimpleMatch 'web_search: "disabled"'
```

Expected: 四项均有匹配。

- [ ] **Step 5: 检查变更边界**

Run:

```powershell
Set-Location 'D:\My_DateBase\Obsidian_CodexCli'
git diff --check
git status --short
```

Expected: 只有计划列出的源码、测试、样式和文档发生变化；`Codex Results/` 仍是用户已有未跟踪内容，不被修改或暂存；没有 Git 暂存或提交。

- [ ] **Step 6: Obsidian Windows 桌面验收**

重载插件后按顺序验证：

1. 工作区管理中添加 `D:\My_DateBase\Obsidian_CodexCli` 和 `D:\UGit\WuXiaEmprise`。
2. 确认白名单管理拒绝添加不属于上述工作区的路径。
3. 将测试专用子目录加入白名单，分别创建、修改、重命名和删除临时文件，确认不弹窗。
4. 对工作区内非白名单测试文件发起写入，确认显示“允许一次 / 拒绝”。
5. 对工作区外测试文件发起写入，确认显示审批弹窗。
6. 移除测试白名单，重新发起同一路径写入，确认恢复审批。
7. 发起网络访问，确认仍显示审批；读取工作区外文件，确认不显示审批。

只在实际观察符合预期后勾选对应桌面验收项；临时测试目录和文件在用户确认后删除。
