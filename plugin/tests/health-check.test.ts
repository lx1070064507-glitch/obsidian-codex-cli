import { describe, expect, it } from "vitest";

import { HealthCheck } from "../src/services/health-check.js";
import { FakeProcessRunner } from "./fake-process-runner.js";

const options = { vaultRoot: "D:\\Vault", codexPath: "codex.cmd", gitPath: "git" };

describe("HealthCheck", () => {
  it("只有 Codex 0.147.0 才允许聊天", async () => {
    const status = await new HealthCheck(readyRunner()).run(options);

    expect(status.readyToChat).toBe(true);
    expect(status.readyToCommit).toBe(true);
    expect(status.codexVersion).toBe("0.147.0");
    expect(status.repositoryRoot).toBe("D:/Vault");
  });

  it("拒绝不兼容的 Codex 版本", async () => {
    const runner = readyRunner().withResult(
      "codex.cmd",
      ["--version"],
      { exitCode: 0, stdout: "codex-cli 0.148.0\n", stderr: "" }
    );

    const status = await new HealthCheck(runner).run(options);

    expect(status.codexCompatible).toBe(false);
    expect(status.readyToChat).toBe(false);
    expect(status.errors).toContain("Codex CLI 版本必须为 0.147.0");
  });

  it("未登录时拒绝聊天", async () => {
    const runner = readyRunner().withResult(
      "codex.cmd",
      ["login", "status"],
      { exitCode: 1, stdout: "Not logged in\n", stderr: "" }
    );

    const status = await new HealthCheck(runner).run(options);

    expect(status.loggedIn).toBe(false);
    expect(status.readyToChat).toBe(false);
  });

  it("Git 缺失不影响聊天但禁止提交", async () => {
    const runner = readyRunner().withResult(
      "git",
      ["--version"],
      { exitCode: 1, stdout: "", stderr: "not found" }
    );

    const status = await new HealthCheck(runner).run(options);

    expect(status.readyToChat).toBe(true);
    expect(status.gitPath).toBeNull();
    expect(status.readyToCommit).toBe(false);
  });

  it("Vault 不是仓库时禁止提交", async () => {
    const runner = readyRunner().withResult(
      "git",
      ["rev-parse", "--show-toplevel"],
      { exitCode: 128, stdout: "", stderr: "not a git repository" }
    );

    const status = await new HealthCheck(runner).run(options);

    expect(status.readyToChat).toBe(true);
    expect(status.repositoryRoot).toBeNull();
    expect(status.readyToCommit).toBe(false);
  });

  it("非 Windows 平台拒绝聊天", async () => {
    const status = await new HealthCheck(readyRunner(), "linux").run(options);

    expect(status.windows).toBe(false);
    expect(status.readyToChat).toBe(false);
  });
});

function readyRunner(): FakeProcessRunner {
  return new FakeProcessRunner()
    .withResult(
      "codex.cmd",
      ["--version"],
      { exitCode: 0, stdout: "codex-cli 0.147.0\n", stderr: "" }
    )
    .withResult(
      "codex.cmd",
      ["login", "status"],
      { exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }
    )
    .withResult(
      "git",
      ["--version"],
      { exitCode: 0, stdout: "git version 2.55.0.windows.1\n", stderr: "" }
    )
    .withResult(
      "git",
      ["rev-parse", "--show-toplevel"],
      { exitCode: 0, stdout: "D:/Vault\n", stderr: "" }
    );
}
