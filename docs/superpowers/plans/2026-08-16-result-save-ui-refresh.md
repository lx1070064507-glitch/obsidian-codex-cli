# Result Save and UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve successfully created results when link insertion fails, report that partial success accurately, and eliminate unnecessary sidebar refresh work.

**Architecture:** `ResultStore` returns a structured outcome so storage truth reaches the UI without exceptions being misinterpreted. UI refresh policy remains inside the existing view module, with pure decisions in `view-model.ts` and scoped refreshes in `ChatView`.

**Tech Stack:** TypeScript 7, Obsidian plugin API, Vitest 4, esbuild

---

Current Vault rules prohibit this runtime session from running `git add`, `git commit`, or `git push`. Commit steps are intentionally omitted.

## File Map

- Modify `plugin/src/domain.ts`: define the result-save outcome shared by storage and controller.
- Modify `plugin/src/services/result-store.ts`: preflight the related note and return full or partial success.
- Modify `plugin/src/chat-controller.ts`: propagate the structured outcome.
- Modify `plugin/src/main.ts`: show success or partial-success notices.
- Modify `plugin/src/ui/view-model.ts`: express periodic refresh and send-button decisions as pure functions.
- Modify `plugin/src/ui/chat-view.ts`: stop idle polling, scope stream refreshes, and avoid full refresh on input.
- Modify `plugin/tests/result-store.test.ts`: cover preflight and partial-success behavior.
- Modify `plugin/tests/chat-controller.test.ts`: cover outcome propagation.
- Modify `plugin/tests/view-model.test.ts`: cover refresh and send-button decisions.

### Task 1: Make Result Saving Report Partial Success

**Files:**
- Modify: `plugin/src/domain.ts`
- Modify: `plugin/src/services/result-store.ts`
- Test: `plugin/tests/result-store.test.ts`

- [ ] **Step 1: Write the related-note preflight test**

Add a test which creates a `MemoryVault` without `项目.md`, calls `store.create(...)`, expects `文件不存在: 项目.md`, and verifies `store.list()` is empty.

```ts
it("关联笔记不可读时不创建成果", async () => {
  const vault = new MemoryVault();
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  await expect(store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "成果"
  })).rejects.toThrow("文件不存在: 项目.md");

  expect(await store.list()).toEqual([]);
});
```

- [ ] **Step 2: Run the preflight test and verify RED**

Run: `npm exec vitest -- run tests/result-store.test.ts`

Expected: FAIL because the current implementation writes the result before reading `项目.md`, so `store.list()` contains an orphan result.

- [ ] **Step 3: Write the link-write partial-success test**

Add a test vault whose `write()` throws only for `项目.md`. The expected return value contains the created result and `linkError: "无法更新关联笔记"`; the result file remains readable.

```ts
class LinkWriteFailingVault extends MemoryVault {
  override async write(path: string, content: string): Promise<void> {
    if (path === "项目.md") {
      throw new Error("无法更新关联笔记");
    }
    await super.write(path, content);
  }
}

it("成果已创建但链接写入失败时返回部分成功", async () => {
  const vault = new LinkWriteFailingVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  const outcome = await store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "成果"
  });

  expect(outcome.linkError).toBe("无法更新关联笔记");
  await expect(vault.read(outcome.result.path)).resolves.toContain("成果");
});
```

- [ ] **Step 4: Run the partial-success test and verify RED**

Run: `npm exec vitest -- run tests/result-store.test.ts`

Expected: FAIL because `create()` currently rejects and returns `ResultNote`, not a structured outcome.

- [ ] **Step 5: Implement the result outcome and preflight**

Add to `domain.ts`:

```ts
export interface SaveResultOutcome {
  result: ResultNote;
  linkError: string | null;
}
```

Change `ResultStore.create()` to read the related note before creating the result, then preserve the result if link insertion fails:

```ts
async create(input: CreateResultInput): Promise<SaveResultOutcome> {
  await this.vault.mkdir(RESULT_DIRECTORY);
  const relatedNote = await this.vault.read(input.relatedNote);
  const createdAt = this.now();
  const path = await this.uniquePath(createdAt.slice(0, 10), input.title);
  const result: ResultNote = { path, createdAt, ...input };
  await this.vault.write(path, serializeResult(result));
  try {
    await this.appendLink(result, relatedNote);
    return { result, linkError: null };
  } catch (error) {
    return { result, linkError: errorMessage(error) };
  }
}
```

Change `appendLink()` to accept the preloaded note and add a local `errorMessage(error: unknown)` helper.

- [ ] **Step 6: Update existing result-store assertions and verify GREEN**

Existing tests should unwrap `.result` before asserting its path or calling `store.read()`.

Run: `npm exec vitest -- run tests/result-store.test.ts`

Expected: all result-store tests PASS.

### Task 2: Propagate and Display the Save Outcome

**Files:**
- Modify: `plugin/src/chat-controller.ts`
- Modify: `plugin/src/main.ts`
- Test: `plugin/tests/chat-controller.test.ts`

- [ ] **Step 1: Write the controller propagation test**

Change `FakeResultStore` to return a configurable `SaveResultOutcome`, configure `linkError: "无法更新关联笔记"`, and assert `controller.saveResult()` returns the same outcome.

```ts
const outcome = await controller.saveResult(reply!.id, "最终方案", "编辑后的成果");
expect(outcome.linkError).toBe("无法更新关联笔记");
expect(outcome.result.path).toBe("Codex Results/2026-08-15-最终方案.md");
```

- [ ] **Step 2: Run the controller test and verify RED**

Run: `npm exec vitest -- run tests/chat-controller.test.ts`

Expected: FAIL because `ResultStorePort` and `ChatController.saveResult()` still return `ResultNote`.

- [ ] **Step 3: Implement outcome propagation**

Import `SaveResultOutcome` in `chat-controller.ts`, update `ResultStorePort.create()` and `ChatController.saveResult()` to return `Promise<SaveResultOutcome>` without changing their other behavior.

Update `main.ts`:

```ts
const outcome = await this.controller.saveResult(entryId, title, content);
if (outcome.linkError === null) {
  new Notice("成果已保存");
} else {
  new Notice(`成果已保存至 ${outcome.result.path}，但关联笔记链接写入失败：${outcome.linkError}`);
}
return outcome.result;
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm exec vitest -- run tests/result-store.test.ts tests/chat-controller.test.ts`

Expected: both test files PASS.

### Task 3: Define the Sidebar Refresh Policy

**Files:**
- Modify: `plugin/src/ui/view-model.ts`
- Test: `plugin/tests/view-model.test.ts`

- [ ] **Step 1: Write refresh-policy tests**

Add tests for a pure `periodicRefreshScope(running)` function:

```ts
expect(periodicRefreshScope(false)).toBeNull();
expect(periodicRefreshScope(true)).toBe("conversation");
```

Add `hasInput` to `ControlStateInput` and verify blank input disables sending while nonblank input enables it when health and note state allow sending.

```ts
expect(deriveControls({
  healthReady: true,
  hasActiveNote: true,
  hasInput: false,
  running: false
}).canSend).toBe(false);
```

- [ ] **Step 2: Run view-model tests and verify RED**

Run: `npm exec vitest -- run tests/view-model.test.ts`

Expected: FAIL because `periodicRefreshScope` and `hasInput` do not exist.

- [ ] **Step 3: Implement the pure policy**

Add:

```ts
export type RefreshScope = "full" | "conversation";

export function periodicRefreshScope(running: boolean): RefreshScope | null {
  return running ? "conversation" : null;
}
```

Add `hasInput: boolean` to `ControlStateInput` and calculate `canSend` as `ready && input.hasInput && !input.running`.

- [ ] **Step 4: Update existing control fixtures and verify GREEN**

Set `hasInput: true` in existing cases that expect `canSend: true`; use the appropriate value in running and unhealthy cases.

Run: `npm exec vitest -- run tests/view-model.test.ts`

Expected: all view-model tests PASS.

### Task 4: Apply Scoped Refreshing in ChatView

**Files:**
- Modify: `plugin/src/ui/chat-view.ts`

- [ ] **Step 1: Use the tested periodic policy**

Import `periodicRefreshScope` and `RefreshScope`. Replace unconditional interval refresh with:

```ts
this.registerInterval(window.setInterval(() => {
  const scope = periodicRefreshScope(this.plugin.isRunning);
  if (scope !== null) {
    void this.refresh(scope);
  }
}, 200));
```

- [ ] **Step 2: Scope refresh work**

Change `refresh()` to `refresh(scope: RefreshScope = "full")`, include `hasInput` when deriving controls, and only call `renderResults()` when `scope === "full"`.

```ts
const controls = deriveControls({
  healthReady: this.plugin.healthStatus?.readyToChat === true,
  hasActiveNote: activeFile?.extension === "md",
  hasInput: this.inputEl?.value.trim().length !== 0,
  running: this.plugin.isRunning
});

if (scope === "full") {
  await this.renderResults();
}
```

- [ ] **Step 3: Stop input events from triggering full refreshes**

Extract the control-only portion of `refresh()` into `updateControls()`. Make the input listener call only `updateControls()`:

```ts
input.addEventListener("input", () => this.updateControls());
```

`refresh()` calls `updateControls()` before rendering messages. The helper updates status, send, and stop controls without reading results or rebuilding messages.

- [ ] **Step 4: Run type checking and focused UI tests**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm exec vitest -- run tests/view-model.test.ts`

Expected: all view-model tests PASS.

### Task 5: Full Verification

**Files:**
- Verify all modified source, tests, design, and plan files.

- [ ] **Step 1: Run the complete verification script**

Run: `npm run verify`

Expected: TypeScript type checking passes, every Vitest test passes, and the production esbuild completes successfully.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the approved source, test, design, plan, and generated ignored build-output changes are present; no unrelated tracked files are modified.

- [ ] **Step 3: Check requirements against the design**

Confirm: preflight prevents orphan results for missing notes; link-write failure returns partial success and closes the modal; idle polling does no refresh; streaming refresh skips results; input only updates controls; no rollback, event bus, path, or Git behavior was added.
