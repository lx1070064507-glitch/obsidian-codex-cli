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
  it("解析、规范化并去重工作区和白名单", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\Repo", "D:\\Repo\\.", "directory")
      .add("d:\\repo\\", "D:\\Repo", "directory")
      .add("D:\\Repo\\Assets", "D:\\Repo\\Assets\\..\\Assets", "directory");

    await expect(new WorkspacePolicy(inspector).resolve(
      ["D:\\Repo", "d:\\repo\\"],
      ["D:\\Repo\\Assets"]
    )).resolves.toEqual({
      workspaceRoots: ["D:\\Repo"],
      writablePaths: ["D:\\Repo\\Assets"]
    });
  });

  it("允许白名单使用工作区根目录本身", async () => {
    const inspector = new FakePathInspector()
      .add("D:\\Repo", "D:\\Repo", "directory");

    await expect(new WorkspacePolicy(inspector).resolve(
      ["D:\\Repo"],
      ["D:\\Repo"]
    )).resolves.toEqual({
      workspaceRoots: ["D:\\Repo"],
      writablePaths: ["D:\\Repo"]
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
