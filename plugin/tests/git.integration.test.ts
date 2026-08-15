import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { NodeProcessRunner } from "../src/platform/process-runner.js";
import { GitService } from "../src/services/git-service.js";

it("真实 Git 仓库只提交用户选择的成果", async () => {
  const root = await mkdtemp(join(tmpdir(), "obsidian-codex-cli-git-"));
  const runner = new NodeProcessRunner();
  try {
    await run(runner, root, ["init"]);
    await run(runner, root, ["config", "user.name", "Obsidian Codex Test"]);
    await run(runner, root, ["config", "user.email", "obsidian-codex@example.invalid"]);
    await writeFile(
      join(root, ".gitignore"),
      "/*\n!/.gitignore\n!/Codex Results/\n!/Codex Results/**\n",
      "utf8"
    );
    await mkdir(join(root, "Codex Chats"), { recursive: true });
    await mkdir(join(root, "Codex Results"), { recursive: true });
    await writeFile(join(root, "Codex Chats", "Local.md"), "local transcript", "utf8");
    await writeFile(join(root, "项目.md"), "personal note", "utf8");
    await run(runner, root, ["add", "--", ".gitignore"]);
    await run(runner, root, ["commit", "-m", "init"]);

    const service = new GitService(root, "git", runner);
    await service.captureBaseline();
    await writeFile(join(root, "Codex Results", "A.md"), "result A", "utf8");
    await writeFile(join(root, "Codex Results", "B.md"), "result B", "utf8");

    const candidates = await service.listCandidates();
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "Codex Results/A.md",
      "Codex Results/B.md"
    ]);
    await service.commit(["Codex Results/B.md"], "docs: add B result");

    const committed = await run(runner, root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    expect(committed.stdout.trim()).toBe("Codex Results/B.md");
    const status = await run(runner, root, ["status", "--porcelain=v1"]);
    expect(status.stdout).toContain("?? \"Codex Results/A.md\"");
    expect(status.stdout).not.toContain("Codex Chats");
    expect(status.stdout).not.toContain("项目.md");
    await expect(run(runner, root, ["check-ignore", "Codex Chats/Local.md", "项目.md"])).resolves.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

async function run(runner: NodeProcessRunner, cwd: string, args: string[]) {
  const result = await runner.run("git", args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args[0]} failed`);
  }
  return result;
}
