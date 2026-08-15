import type { HealthStatus } from "../domain.js";
import type { ProcessResult, ProcessRunner } from "../platform/process-runner.js";

export interface HealthCheckOptions {
  vaultRoot: string;
  codexPath: string;
  gitPath: string;
}

export class HealthCheck {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly platform: NodeJS.Platform | string = process.platform
  ) {}

  async run(options: HealthCheckOptions): Promise<HealthStatus> {
    const [versionResult, loginResult, gitResult] = await Promise.all([
      safeRun(this.runner, options.codexPath, ["--version"], options.vaultRoot),
      safeRun(this.runner, options.codexPath, ["login", "status"], options.vaultRoot),
      safeRun(this.runner, options.gitPath, ["--version"], options.vaultRoot)
    ]);
    const windows = this.platform === "win32";
    const codexFound = succeeded(versionResult);
    const codexVersion = codexFound ? extractCodexVersion(versionResult.stdout) : null;
    const codexCompatible = codexFound && /^codex-cli 0\.147\.0$/m.test(versionResult.stdout);
    const loggedIn = succeeded(loginResult) && /^Logged in\b/im.test(
      `${loginResult.stdout}\n${loginResult.stderr}`
    );
    const gitFound = succeeded(gitResult) && /^git version\b/m.test(gitResult.stdout);
    const repositoryResult = gitFound
      ? await safeRun(this.runner, options.gitPath, ["rev-parse", "--show-toplevel"], options.vaultRoot)
      : null;
    const repositoryRoot = succeeded(repositoryResult) && repositoryResult.stdout.trim().length > 0
      ? repositoryResult.stdout.trim()
      : null;
    const readyToChat = windows && codexCompatible && loggedIn;
    const readyToCommit = readyToChat && gitFound && repositoryRoot !== null;
    const errors: string[] = [];

    if (!windows) {
      errors.push("仅支持 Windows 桌面版");
    }
    if (!codexFound) {
      errors.push("未找到 Codex CLI");
    } else if (!codexCompatible) {
      errors.push("Codex CLI 版本必须为 0.147.0");
    }
    if (!loggedIn) {
      errors.push("Codex 尚未登录");
    }
    if (!gitFound) {
      errors.push("未找到 Git");
    } else if (repositoryRoot === null) {
      errors.push("当前 Vault 不是 Git 仓库");
    }

    return {
      windows,
      codexPath: codexFound ? options.codexPath : null,
      codexVersion,
      codexCompatible,
      loggedIn,
      gitPath: gitFound ? options.gitPath : null,
      repositoryRoot,
      readyToChat,
      readyToCommit,
      errors
    };
  }
}

async function safeRun(
  runner: ProcessRunner,
  executable: string,
  args: string[],
  cwd: string
): Promise<ProcessResult | null> {
  try {
    return await runner.run(executable, args, cwd);
  } catch {
    return null;
  }
}

function succeeded(result: ProcessResult | null): result is ProcessResult {
  return result !== null && result.exitCode === 0;
}

function extractCodexVersion(stdout: string): string | null {
  return /^codex-cli ([^\s]+)$/m.exec(stdout)?.[1] ?? null;
}
