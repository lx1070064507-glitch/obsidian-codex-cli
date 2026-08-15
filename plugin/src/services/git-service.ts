import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProcessResult, ProcessRunner } from "../platform/process-runner.js";
import { assertResultPath } from "./path-policy.js";

const STATUS_ARGS = [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
  "-z",
  "--",
  "Codex Results"
];

export interface GitCandidate {
  path: string;
  status: string;
  tracked: boolean;
}

type VaultFileReader = (path: string) => Promise<string>;

export class GitService {
  private readonly baselineDirty = new Set<string>();
  private readonly readVaultFile: VaultFileReader;

  constructor(
    private readonly vaultRoot: string,
    private readonly gitPath: string,
    private readonly runner: ProcessRunner,
    readVaultFile?: VaultFileReader
  ) {
    this.readVaultFile = readVaultFile ?? ((path) => readFile(resolve(vaultRoot, ...path.split("/")), "utf8"));
  }

  async captureBaseline(): Promise<void> {
    this.baselineDirty.clear();
    for (const candidate of await this.listCandidates()) {
      if (candidate.tracked) {
        this.baselineDirty.add(candidate.path);
      }
    }
  }

  async listCandidates(): Promise<GitCandidate[]> {
    const result = await this.runGit(STATUS_ARGS);
    return parseStatus(result.stdout).sort((left, right) => left.path.localeCompare(right.path));
  }

  async preview(paths: string[]): Promise<string> {
    const normalized = validatePaths(paths);
    const candidates = new Map((await this.listCandidates()).map((candidate) => [candidate.path, candidate]));
    const tracked = normalized.filter((path) => candidates.get(path)?.tracked !== false);
    const untracked = normalized.filter((path) => candidates.get(path)?.tracked === false);
    const sections: string[] = [];

    if (tracked.length > 0) {
      const diff = await this.runGit(["diff", "--no-ext-diff", "--", ...tracked]);
      if (diff.stdout.length > 0) {
        sections.push(diff.stdout);
      }
    }
    for (const path of untracked) {
      sections.push(`--- 新增文件: ${path} ---\n${await this.readVaultFile(path)}`);
    }
    return sections.join("\n\n");
  }

  async commit(paths: string[], message: string): Promise<void> {
    if (paths.length === 0) {
      throw new Error("至少选择一个成果文件");
    }
    const normalized = validatePaths(paths);
    const commitMessage = message.trim();
    if (commitMessage.length === 0) {
      throw new Error("提交说明不能为空");
    }
    const dirty = normalized.find((path) => this.baselineDirty.has(path));
    if (dirty !== undefined) {
      throw new Error(`成果已有未提交修改: ${dirty}`);
    }

    await this.runGit(["add", "--", ...normalized]);
    await this.runGit(["commit", "-m", commitMessage, "--", ...normalized]);
  }

  private async runGit(args: string[]): Promise<ProcessResult> {
    const result = await this.runner.run(this.gitPath, args, this.vaultRoot);
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `退出码 ${result.exitCode}`;
      throw new Error(`Git 命令失败: ${detail}`);
    }
    return result;
  }
}

function validatePaths(paths: string[]): string[] {
  return paths.map(assertResultPath);
}

function parseStatus(stdout: string): GitCandidate[] {
  const candidates: GitCandidate[] = [];
  for (const record of stdout.split("\0")) {
    if (record.length < 4 || record[2] !== " ") {
      continue;
    }
    const status = record.slice(0, 2);
    const path = record.slice(3);
    try {
      const normalized = assertResultPath(path);
      candidates.push({ path: normalized, status, tracked: status !== "??" });
    } catch {
      // Git may report nested or non-Markdown files under the directory; they are never candidates.
    }
  }
  return candidates;
}
