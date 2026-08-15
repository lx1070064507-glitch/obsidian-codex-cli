import { expect, it } from "vitest";

import { ResultStore } from "../src/services/result-store.js";
import { MemoryVault } from "./memory-vault.js";

class LinkWriteFailingVault extends MemoryVault {
  override async write(path: string, content: string): Promise<void> {
    if (path === "项目.md") {
      throw new Error("无法更新关联笔记");
    }
    await super.write(path, content);
  }
}

class ConcurrentNoteUpdateVault extends MemoryVault {
  override async write(path: string, content: string): Promise<void> {
    await super.write(path, content);
    if (path.startsWith("Codex Results/")) {
      await super.write("项目.md", "# 项目\n\n并发更新\n");
    }
  }
}

it("创建独立成果并只在当前笔记追加链接", async () => {
  const vault = new MemoryVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  const outcome = await store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "采用 app-server。"
  });

  expect(outcome.result.path).toBe("Codex Results/2026-08-15-最终方案.md");
  expect(await vault.read(outcome.result.path)).toContain("采用 app-server。");
  expect(await vault.read("项目.md")).toContain("[[Codex Results/2026-08-15-最终方案|最终方案]]");
  expect(await vault.read("项目.md")).not.toContain("采用 app-server。");
  expect(outcome.linkError).toBeNull();
  expect(await store.list()).toEqual([outcome.result.path]);
  expect(await store.read(outcome.result.path)).toEqual(outcome.result);
});

it("关联笔记不可读时不创建成果", async () => {
  const vault = new MemoryVault();
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  await expect(store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "采用 app-server。"
  })).rejects.toThrow("文件不存在: 项目.md");

  expect(await store.list()).toEqual([]);
});

it("成果已创建但链接写入失败时返回部分成功", async () => {
  const vault = new LinkWriteFailingVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  const outcome = await store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "采用 app-server。"
  });

  expect(outcome.result.path).toBe("Codex Results/2026-08-15-最终方案.md");
  expect(outcome.linkError).toBe("无法更新关联笔记");
  expect(await vault.read(outcome.result.path)).toContain("采用 app-server。");
});

it("追加成果链接时保留关联笔记的并发更新", async () => {
  const vault = new ConcurrentNoteUpdateVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  const outcome = await store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "采用 app-server。"
  });

  const note = await vault.read("项目.md");
  expect(note).toContain("并发更新");
  expect(note).toContain("[[Codex Results/2026-08-15-最终方案|最终方案]]");
  expect(outcome.linkError).toBeNull();
});

it("使用不冲突的成果路径并且不重复追加链接", async () => {
  const vault = new MemoryVault({
    "项目.md": "# 项目\n",
    "Codex Results/2026-08-15-最终方案.md": "旧成果"
  });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");
  const input = {
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "新成果"
  };

  const first = await store.create(input);
  await store.create({ ...input, content: "更新成果" });

  expect(first.result.path).toBe("Codex Results/2026-08-15-最终方案-2.md");
  const note = await vault.read("项目.md");
  expect(note.match(/\[\[Codex Results\/2026-08-15-最终方案-2\|最终方案\]\]/g)).toHaveLength(1);
});

it("净化成果链接别名中的 Windows 和 Wikilink 禁止字符", async () => {
  const vault = new MemoryVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  await store.create({
    title: "AUX|方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "成果"
  });

  expect(await vault.read("项目.md")).toContain("|AUX-方案]]");
});
