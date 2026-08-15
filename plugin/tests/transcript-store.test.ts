import { expect, it } from "vitest";

import { TranscriptStore } from "../src/services/transcript-store.js";
import { MemoryVault } from "./memory-vault.js";

it("把完整会话写入 Codex Chats", async () => {
  const vault = new MemoryVault();
  const store = new TranscriptStore(vault, () => "2026-08-15T10:00:00.000Z");
  const session = await store.create("需求讨论", "项目.md");
  session.entries.push({
    id: "u1",
    role: "user",
    content: "分析方案",
    createdAt: "2026-08-15T10:00:00.000Z"
  });

  await store.save(session);

  expect(session.transcriptPath).toMatch(/^Codex Chats\//);
  expect(await vault.read(session.transcriptPath)).toContain("分析方案");
  expect(await vault.read(session.transcriptPath)).toContain("## 用户");
});

it("完整恢复已保存的会话", async () => {
  const vault = new MemoryVault();
  const store = new TranscriptStore(vault, () => "2026-08-15T10:00:00.000Z");
  const session = await store.create("恢复测试", "项目.md");
  session.codexThreadId = "thread-1";
  session.entries.push({
    id: "a1",
    role: "assistant",
    content: "包含 ## 标题的回复",
    createdAt: "2026-08-15T10:01:00.000Z"
  });
  await store.save(session);

  const restored = await store.load(session.transcriptPath);

  expect(restored).toEqual(session);
  expect(await store.list()).toEqual([session.transcriptPath]);
});
