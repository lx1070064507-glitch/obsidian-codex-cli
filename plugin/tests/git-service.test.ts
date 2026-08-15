import { describe, expect, it } from "vitest";

import { GitService } from "../src/services/git-service.js";
import { FakeProcessRunner } from "./fake-process-runner.js";

describe("GitService", () => {
  it("只暂存用户选择的成果", async () => {
    const runner = new FakeProcessRunner().withResult(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", "Codex Results"],
      { exitCode: 0, stdout: "?? Codex Results/A.md\0?? Codex Results/B.md\0", stderr: "" }
    );
    const service = new GitService("D:\\Vault", "git", runner);
    const candidates = await service.listCandidates();

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "Codex Results/A.md",
      "Codex Results/B.md"
    ]);

    await service.commit(["Codex Results/B.md"], "docs: add B result");

    expect(runner.calls).toContainEqual([
      "git",
      ["add", "--", "Codex Results/B.md"],
      "D:\\Vault"
    ]);
    expect(runner.calls).toContainEqual([
      "git",
      ["commit", "-m", "docs: add B result", "--", "Codex Results/B.md"],
      "D:\\Vault"
    ]);
    expect(runner.calls).not.toContainEqual([
      "git",
      ["add", "--", "Codex Results/A.md"],
      "D:\\Vault"
    ]);
  });

  it("拒绝临时会话路径", async () => {
    const service = new GitService("D:\\Vault", "git", new FakeProcessRunner());
    await expect(service.commit(["Codex Chats/A.md"], "bad")).rejects.toThrow("成果目录");
  });

  it("候选成果启动前已有修改时阻止自动提交", async () => {
    const runner = new FakeProcessRunner().withResult(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", "Codex Results"],
      { exitCode: 0, stdout: " M Codex Results/Old.md\0", stderr: "" }
    );
    const service = new GitService("D:\\Vault", "git", runner);
    await service.captureBaseline();

    await expect(
      service.commit(["Codex Results/Old.md"], "docs: update result")
    ).rejects.toThrow("已有未提交修改");
  });

  it("拒绝空文件列表和空提交说明", async () => {
    const service = new GitService("D:\\Vault", "git", new FakeProcessRunner());
    await expect(service.commit([], "docs: empty")).rejects.toThrow("至少选择");
    await expect(service.commit(["Codex Results/A.md"], "  ")).rejects.toThrow("提交说明");
  });

  it("预览已跟踪差异和未跟踪成果全文", async () => {
    const runner = new FakeProcessRunner()
      .withResult(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", "Codex Results"],
        {
          exitCode: 0,
          stdout: " M Codex Results/Tracked.md\0?? Codex Results/New.md\0",
          stderr: ""
        }
      )
      .withResult(
        "git",
        ["diff", "--no-ext-diff", "--", "Codex Results/Tracked.md"],
        { exitCode: 0, stdout: "tracked diff", stderr: "" }
      );
    const service = new GitService("D:\\Vault", "git", runner, async (path) => `full:${path}`);

    const preview = await service.preview([
      "Codex Results/Tracked.md",
      "Codex Results/New.md"
    ]);

    expect(preview).toContain("tracked diff");
    expect(preview).toContain("full:Codex Results/New.md");
  });
});
