import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { CodexClient } from "../src/codex/codex-client.js";
import { NodeProcessRunner } from "../src/platform/process-runner.js";
import { HealthCheck } from "../src/services/health-check.js";

it("通过真实 stdio 子进程完成一个回合", async () => {
  const child = spawn(process.execPath, [fixturePath("fake-app-server.cjs")], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const client = CodexClient.fromChildProcess(child, "D:\\Vault");
  try {
    const initialized = await client.initialize();
    expect(initialized.platformOs).toBe("windows");
    const thread = await client.startThread();
    expect(thread.id).toBe("fake-thread");
    await expect(collectTurn(client, "hello")).resolves.toBe("fake response");
  } finally {
    await closeClient(client, child);
  }
});

it("真实子进程只接受单次允许或拒绝", async () => {
  const child = spawn(process.execPath, [fixturePath("fake-app-server.cjs")], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const client = CodexClient.fromChildProcess(child, "D:\\Vault");
  try {
    await client.initialize();
    await client.startThread();
    client.onApproval(async () => "allowOnce");
    await expect(collectTurn(client, "APPROVAL")).resolves.toBe("fake response");
  } finally {
    await closeClient(client, child);
  }
});

const handshakeTest = process.env.RUN_CODEX_HANDSHAKE === "1" ? it : it.skip;

handshakeTest("与本机 codex.cmd 只完成初始化握手", async () => {
  const codexPath = process.env.CODEX_PATH;
  if (codexPath === undefined || codexPath.length === 0) {
    throw new Error("缺少 CODEX_PATH");
  }
  const client = CodexClient.fromExecutable(codexPath, process.cwd());
  try {
    const initialized = await client.initialize();
    expect(initialized.platformOs).toBe("windows");
  } finally {
    client.close();
  }
}, 10_000);

handshakeTest("本机健康检查识别 Codex 登录、版本和 Git 仓库", async () => {
  const codexPath = process.env.CODEX_PATH;
  if (codexPath === undefined || codexPath.length === 0) {
    throw new Error("缺少 CODEX_PATH");
  }
  const status = await new HealthCheck(new NodeProcessRunner()).run({
    vaultRoot: process.cwd(),
    codexPath,
    gitPath: "git"
  });
  expect(status).toMatchObject({
    windows: true,
    codexVersion: "0.147.0",
    codexCompatible: true,
    loggedIn: true,
    readyToChat: true,
    readyToCommit: true
  });
}, 10_000);

async function collectTurn(client: CodexClient, text: string): Promise<string> {
  let response = "";
  const remove = client.onMessageDelta((delta) => {
    response += delta;
  });
  try {
    await client.startTurn(text);
    return response;
  } finally {
    remove();
  }
}

async function closeClient(
  client: CodexClient,
  child: ReturnType<typeof spawn>
): Promise<void> {
  const exit = child.exitCode === null ? once(child, "exit") : Promise.resolve([]);
  client.close();
  await exit;
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}
