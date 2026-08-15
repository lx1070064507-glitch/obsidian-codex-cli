import { spawn } from "node:child_process";

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
      const child = spawn(executable, args, {
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
