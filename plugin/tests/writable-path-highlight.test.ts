import { describe, expect, it } from "vitest";

import {
  isWritableVaultPath,
  toVaultHighlightRule
} from "../src/services/writable-path-highlight.js";

describe("writable path highlight", () => {
  it("目录规则匹配自身和所有子项", () => {
    const rule = toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault\\Tools\\xlsx",
      kind: "directory"
    });
    expect(rule).toEqual({ path: "Tools/xlsx", kind: "directory" });
    expect(isWritableVaultPath("Tools/xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Tools/xlsx/Activity.xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Tools/xlsx-old/Activity.xlsx", [rule!])).toBe(false);
  });

  it("文件规则只匹配文件本身且忽略大小写", () => {
    const rule = toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault\\Guide.xlsx",
      kind: "file"
    });
    expect(isWritableVaultPath("guide.xlsx", [rule!])).toBe(true);
    expect(isWritableVaultPath("Guide.xlsx/child", [rule!])).toBe(false);
  });

  it("Vault 根目录规则匹配全部文件树路径", () => {
    const rule = toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault",
      kind: "directory"
    });
    expect(rule).toEqual({ path: "", kind: "directory" });
    expect(isWritableVaultPath("any/deep/file.txt", [rule!])).toBe(true);
  });

  it("忽略当前 Vault 之外的白名单和其他文件类型", () => {
    expect(toVaultHighlightRule("D:\\Vault", {
      realPath: "E:\\Repo\\Assets",
      kind: "directory"
    })).toBeNull();
    expect(toVaultHighlightRule("D:\\Vault", {
      realPath: "D:\\Vault\\pipe",
      kind: "other"
    })).toBeNull();
  });
});
