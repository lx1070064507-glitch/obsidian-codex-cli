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
