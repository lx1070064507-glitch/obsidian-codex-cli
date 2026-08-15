import { expect, it } from "vitest";

import { ResultStore } from "../src/services/result-store.js";
import { MemoryVault } from "./memory-vault.js";

it("创建独立成果并只在当前笔记追加链接", async () => {
  const vault = new MemoryVault({ "项目.md": "# 项目\n" });
  const store = new ResultStore(vault, () => "2026-08-15T10:00:00.000Z");

  const result = await store.create({
    title: "最终方案",
    sourceChat: "Codex Chats/需求讨论.md",
    relatedNote: "项目.md",
    content: "采用 app-server。"
  });

  expect(result.path).toBe("Codex Results/2026-08-15-最终方案.md");
  expect(await vault.read(result.path)).toContain("采用 app-server。");
  expect(await vault.read("项目.md")).toContain("[[Codex Results/2026-08-15-最终方案|最终方案]]");
  expect(await vault.read("项目.md")).not.toContain("采用 app-server。");
  expect(await store.list()).toEqual([result.path]);
  expect(await store.read(result.path)).toEqual(result);
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

  expect(first.path).toBe("Codex Results/2026-08-15-最终方案-2.md");
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
