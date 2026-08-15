import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(executable: string, args: string[], cwd: string): Promise<ProcessResult>;
}

export class NodeProcessRunner implements ProcessRunner {
  async run(executable: string, args: string[], cwd: string): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(resolveWindowsExecutable(executable, cwd), args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      });
    });
  }
}

export function resolveWindowsExecutable(executable: string, cwd: string): string {
  if (process.platform !== "win32" || extname(executable).toLowerCase() !== ".cmd") {
    return executable;
  }
  const commandPath = resolveCommandPath(executable, cwd);
  if (basename(commandPath).toLowerCase() !== "codex.cmd") {
    throw new Error("仅支持无 shell 启动 codex.cmd");
  }
  if (!existsSync(commandPath)) {
    throw new Error(`未找到 codex.cmd: ${commandPath}`);
  }
  if (process.arch !== "x64" && process.arch !== "arm64") {
    throw new Error(`不支持的 Windows 架构: ${process.arch}`);
  }
  const platformPackage = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const nativeExecutable = join(
    dirname(commandPath),
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    platformPackage,
    "vendor",
    target,
    "bin",
    "codex.exe"
  );
  if (!existsSync(nativeExecutable)) {
    throw new Error(`未找到 codex.cmd 对应的原生可执行文件: ${nativeExecutable}`);
  }
  return nativeExecutable;
}

export function buildWindowsSandboxEnvironment(
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows";
  const powershellDirectory = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
  const pathEntries = (environment[pathKey] ?? "")
    .split(";")
    .filter((entry) => entry.length > 0 && !isWindowsAppsAliasDirectory(entry));

  return {
    ...environment,
    [pathKey]: [powershellDirectory, ...pathEntries].join(";")
  };
}

function isWindowsAppsAliasDirectory(pathEntry: string): boolean {
  const normalized = pathEntry
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/[\\/]+$/, "")
    .replaceAll("/", "\\")
    .toLowerCase();
  return normalized.endsWith("\\appdata\\local\\microsoft\\windowsapps");
}

function resolveCommandPath(executable: string, cwd: string): string {
  if (isAbsolute(executable)) {
    return executable;
  }
  if (executable.includes("/") || executable.includes("\\")) {
    return resolve(cwd, executable);
  }
  for (const directory of (process.env.PATH ?? "").split(";")) {
    const candidate = join(directory, executable);
    if (directory.length > 0 && existsSync(candidate)) {
      return candidate;
    }
  }
  return resolve(cwd, executable);
}
