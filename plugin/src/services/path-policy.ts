const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function normalizeVaultPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");

  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error("非法路径");
  }

  return normalized;
}

export function assertResultPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  const segments = normalized.split("/");

  if (segments.length !== 2 || segments[0] !== "Codex Results" || !segments[1]?.endsWith(".md")) {
    throw new Error("路径必须位于成果目录 Codex Results/ 且为 Markdown 文件");
  }

  return normalized;
}

export function sanitizeFileStem(stem: string): string {
  const sanitized = stem
    .replace(WINDOWS_FORBIDDEN_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(sanitized)
    ? `${sanitized}-`
    : sanitized;
}
