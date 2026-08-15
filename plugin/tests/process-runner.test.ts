import { describe, expect, it } from "vitest";

import { buildWindowsSandboxEnvironment } from "../src/platform/process-runner.js";

describe("buildWindowsSandboxEnvironment", () => {
  it("移除 WindowsApps 命令别名并优先使用系统 PowerShell", () => {
    const environment = {
      Path: [
        "C:\\Tools",
        "C:\\Users\\Tester\\AppData\\Local\\Microsoft\\WindowsApps",
        "D:\\Bin"
      ].join(";"),
      SystemRoot: "C:\\Windows"
    };

    expect(buildWindowsSandboxEnvironment(environment)).toEqual({
      Path: [
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        "C:\\Tools",
        "D:\\Bin"
      ].join(";"),
      SystemRoot: "C:\\Windows"
    });
    expect(environment.Path).toContain("WindowsApps");
  });

  it("兼容大写 PATH 和末尾分隔符", () => {
    const environment = {
      PATH: "C:\\Users\\Tester\\AppData\\Local\\Microsoft\\WindowsApps\\;C:\\Tools",
      SYSTEMROOT: "D:\\Windows"
    };

    expect(buildWindowsSandboxEnvironment(environment).PATH).toBe(
      "D:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Tools"
    );
  });
});
