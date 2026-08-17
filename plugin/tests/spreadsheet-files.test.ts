import { describe, expect, it, vi } from "vitest";

import {
  SPREADSHEET_EXTENSIONS,
  openWithDefaultApp
} from "../src/services/spreadsheet-files.js";

describe("spreadsheet files", () => {
  it("注册常用 Excel 和表格扩展名", () => {
    expect(SPREADSHEET_EXTENSIONS).toEqual([
      "xlsx", "xls", "xlsm", "xlsb", "xltx", "xltm", "csv", "tsv"
    ]);
  });

  it("调用 Electron shell 并将错误文本转成异常", async () => {
    const success = { openPath: vi.fn().mockResolvedValue("") };
    await expect(openWithDefaultApp("D:\\Vault\\Book.xlsx", success))
      .resolves.toBeUndefined();
    expect(success.openPath).toHaveBeenCalledWith("D:\\Vault\\Book.xlsx");

    const failure = { openPath: vi.fn().mockResolvedValue("没有关联的应用") };
    await expect(openWithDefaultApp("D:\\Vault\\Book.xlsx", failure))
      .rejects.toThrow("没有关联的应用");
  });
});
