export const SPREADSHEET_EXTENSIONS = [
  "xlsx",
  "xls",
  "xlsm",
  "xlsb",
  "xltx",
  "xltm",
  "csv",
  "tsv"
] as const;

export interface ElectronShell {
  openPath(path: string): Promise<string>;
}

export async function openWithDefaultApp(
  path: string,
  shell: ElectronShell = loadElectronShell()
): Promise<void> {
  const error = await shell.openPath(path);
  if (error.length > 0) {
    throw new Error(`无法使用系统默认应用打开文件: ${error}`);
  }
}

function loadElectronShell(): ElectronShell {
  const desktopWindow = window as Window & {
    require?: (id: string) => { shell?: ElectronShell };
  };
  const electron = desktopWindow.require?.("electron");
  const shell = electron?.shell;
  if (shell === undefined) {
    throw new Error("当前环境无法调用系统默认应用");
  }
  return shell;
}
