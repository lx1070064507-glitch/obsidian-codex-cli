import { describe, expect, it } from "vitest";

import {
  parseFileChangePatchUpdated,
  summarizeFileChanges,
} from "../src/codex/file-change-detail.js";

describe("文件变更详情", () => {
  it("严格解析合法通知并拒绝异常通知", () => {
    const value = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      changes: [{ path: "src/a.ts", kind: { type: "add" }, diff: "+a\n" }],
    };

    expect(parseFileChangePatchUpdated(value)).toEqual(value);
    expect(parseFileChangePatchUpdated({ ...value, threadId: 1 })).toBeNull();
    expect(parseFileChangePatchUpdated({ ...value, changes: [{}] })).toBeNull();
    expect(parseFileChangePatchUpdated({ ...value, changes: "bad" })).toBeNull();
    expect(parseFileChangePatchUpdated({ ...value, changes: [{ ...value.changes[0], kind: { type: "update" } }] })).toBeNull();
  });

  it("汇总新增、修改、删除及 unified diff 行数", () => {
    const result = summarizeFileChanges([
      { path: "new.txt", kind: { type: "add" }, diff: "+++ b/new.txt\n+one\n+two\n" },
      { path: "edit.txt", kind: { type: "update", move_path: null }, diff: "--- a/edit.txt\n+++ b/edit.txt\n-old\n+new\n" },
      { path: "gone.txt", kind: { type: "delete" }, diff: "--- a/gone.txt\n-old\n" },
    ], "C:\\Vault");

    expect(result.summary).toBe([
      "新增 C:\\Vault\\new.txt（+2 / -0）",
      "修改 C:\\Vault\\edit.txt（+1 / -1）",
      "删除 C:\\Vault\\gone.txt（+0 / -1）",
    ].join("\n"));
    expect(result.diff).toBe("### 新增 C:\\Vault\\new.txt\n\n+++ b/new.txt\n+one\n+two\n\n\n### 修改 C:\\Vault\\edit.txt\n\n--- a/edit.txt\n+++ b/edit.txt\n-old\n+new\n\n\n### 删除 C:\\Vault\\gone.txt\n\n--- a/gone.txt\n-old\n");
  });

  it("使用移动目标，并规范化相对和绝对路径", () => {
    const result = summarizeFileChanges([
      { path: "old/name.txt", kind: { type: "update", move_path: "new/name.txt" }, diff: "-old\n+new\n" },
      { path: "C:\\Vault\\already.txt", kind: { type: "update", move_path: null }, diff: "" },
    ], "C:\\Vault");

    expect(result.summary).toBe([
      "移动 C:\\Vault\\old\\name.txt -> C:\\Vault\\new\\name.txt（+1 / -1）",
      "修改 C:\\Vault\\already.txt（+0 / -0）",
    ].join("\n"));
    expect(result.diff).toBe("### 移动 C:\\Vault\\old\\name.txt -> C:\\Vault\\new\\name.txt\n\n-old\n+new\n");
  });

  it("空 changes 返回无详细差异", () => {
    expect(summarizeFileChanges([], "C:\\Vault")).toEqual({ summary: "暂无详细差异", diff: null });
  });
});
