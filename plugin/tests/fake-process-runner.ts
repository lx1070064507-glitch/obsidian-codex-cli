import type { ProcessResult, ProcessRunner } from "../src/platform/process-runner.js";

export class FakeProcessRunner implements ProcessRunner {
  readonly calls: Array<[string, string[], string]> = [];
  private readonly results = new Map<string, ProcessResult>();

  withResult(executable: string, args: string[], result: ProcessResult): this {
    this.results.set(JSON.stringify([executable, args]), result);
    return this;
  }

  async run(executable: string, args: string[], cwd: string): Promise<ProcessResult> {
    this.calls.push([executable, args, cwd]);
    return this.results.get(JSON.stringify([executable, args])) ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}
